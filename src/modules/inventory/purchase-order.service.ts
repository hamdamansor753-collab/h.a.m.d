/**
 * Inventory module — PurchaseOrder service.
 *
 * Per /upload/inventory.md:
 *  - CRUD for DRAFT purchase orders
 *  - receivePurchaseOrder: for each line, create StockMovement(RECEIPT) +
 *    update StockLevel + update Product.costPrice (weighted average), then
 *    create ONE balanced JournalEntry (Debit Inventory, Credit AP) for the
 *    whole order. All atomic in a single db.$transaction.
 *
 * The receive operation reuses:
 *  - recordMovement() from stock-movement.service (the ONLY StockLevel writer)
 *  - createJournalEntryOn() from journal-entry.service (the ONLY JE writer
 *    inside a transaction)
 *
 * Per the Phase 1 hard rule: every operation inside db.$transaction() MUST
 * include tenantId explicitly in where/data — the tx client has no tenant
 * middleware.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import {
  recordMovement,
  linkMovementToJournalEntry,
  computeWeightedAverageCost,
} from './stock-movement.service'
import { createJournalEntryOn, type JournalEntryInput } from '@/core/ledger/journal-entry.service'
import { PurchaseOrderStateError, InventoryConfigError } from '@/lib/api'
import type { PurchaseOrder, PurchaseOrderLine, Prisma } from '@prisma/client'

// ---------- Types ----------

export interface PurchaseOrderWithLines extends PurchaseOrder {
  lines: PurchaseOrderLine[]
}

// ---------- Account resolution ----------
//
// Receiving a PO needs 2 ledger accounts:
//   1. Inventory — ASSET — debited for the total cost
//   2. Accounts Payable (AP) — LIABILITY — credited for the total cost
//
// Resolved by nameKey convention (seed creates one per tenant).

const INVENTORY_NAME_KEY = 'account.inventory'
const AP_NAME_KEY = 'account.payable'

async function resolveReceivingAccounts() {
  const [inventory, ap] = await Promise.all([
    db.account.findFirst({ where: { nameKey: INVENTORY_NAME_KEY } }),
    db.account.findFirst({ where: { nameKey: AP_NAME_KEY } }),
  ])
  if (!inventory || !ap) {
    throw new InventoryConfigError(
      'Missing required inventory accounts. Ensure the seed created accounts with nameKeys: ' +
        `${INVENTORY_NAME_KEY}, ${AP_NAME_KEY}`
    )
  }
  return { inventory, ap }
}

// ---------- Sequential numbering ----------

async function nextPurchaseOrderNumber(): Promise<string> {
  const count = await db.purchaseOrder.count()
  const n = count + 1
  return `PO-${String(n).padStart(4, '0')}`
}

// ---------- CRUD: DRAFT ----------

/**
 * List all purchase orders for the current tenant.
 * Permission: inventory:read.
 */
export async function listPurchaseOrders(): Promise<PurchaseOrderWithLines[]> {
  requirePermission('inventory:read')
  return db.purchaseOrder.findMany({
    orderBy: { createdAt: 'desc' },
    include: { lines: true },
  })
}

/**
 * Get a single purchase order by ID (scoped to current tenant).
 * Permission: inventory:read.
 */
export async function getPurchaseOrder(id: string): Promise<PurchaseOrderWithLines | null> {
  requirePermission('inventory:read')
  return db.purchaseOrder.findUnique({
    where: { id },
    include: { lines: true },
  })
}

/**
 * Create a new DRAFT purchase order.
 * Permission: purchase:create.
 */
export async function createPurchaseOrder(input: {
  supplierName: string
  date: Date
  lines: Array<{
    productId: string
    quantity: number
    unitCost: number
    warehouseId: string
  }>
}): Promise<PurchaseOrderWithLines> {
  requirePermission('purchase:create')
  if (input.lines.length === 0) {
    throw new PurchaseOrderStateError('NOT_DRAFT', 'A purchase order needs at least 1 line')
  }
  const number = await nextPurchaseOrderNumber()
  return db.purchaseOrder.create({
    data: {
      number,
      supplierName: input.supplierName,
      date: input.date,
      status: 'DRAFT',
      lines: {
        create: input.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          warehouseId: l.warehouseId,
        })),
      },
    },
    include: { lines: true },
  })
}

// ---------- Receiving ----------

/**
 * Receive a DRAFT purchase order: create stock movements, update cost prices,
 * create a balanced JE, and mark the PO as RECEIVED — all atomically.
 *
 * Steps:
 *  1. Verify DRAFT status.
 *  2. Resolve Inventory (ASSET) + AP (LIABILITY) accounts.
 *  3. In a single db.$transaction:
 *     a. For each line:
 *        - Record StockMovement(RECEIPT) via recordMovement(tx) — this also
 *          upserts StockLevel (+= quantity).
 *        - Compute new weighted-average costPrice for the product.
 *        - Update Product.costPrice.
 *     b. Create ONE balanced JournalEntry:
 *          Debit  Inventory = sum(line.quantity × line.unitCost)
 *          Credit AP        = same total
 *     c. Link each StockMovement to the JournalEntry.
 *     d. Update PurchaseOrder.status = RECEIVED + journalEntryId.
 *
 * Permission: purchase:receive.
 */
export async function receivePurchaseOrder(
  id: string
): Promise<{ purchaseOrder: PurchaseOrderWithLines; journalEntryId: string; totalCost: number }> {
  requirePermission('purchase:receive')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  // 1. Fetch + verify DRAFT
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: { lines: true },
  })
  if (!po) throw new PurchaseOrderStateError('NOT_DRAFT', 'Purchase order not found')
  if (po.status !== 'DRAFT') {
    throw new PurchaseOrderStateError('NOT_DRAFT', `Cannot receive PO in status ${po.status}`)
  }
  if (po.lines.length === 0) {
    throw new PurchaseOrderStateError('NOT_DRAFT', 'Cannot receive PO with no lines')
  }

  // 2. Resolve accounts
  const { inventory: inventoryAccount, ap: apAccount } = await resolveReceivingAccounts()

  // 3. Atomic transaction
  const result = await db.$transaction(async (tx) => {
    const movementIds: string[] = []
    let totalCost = 0

    // a. Process each line
    for (const line of po.lines) {
      const qty = Number(line.quantity)
      const unitCost = Number(line.unitCost)
      const lineTotal = qty * unitCost
      totalCost += lineTotal

      // Fetch current product costPrice + total stock across all warehouses
      // (for weighted-average calculation). Use tx with explicit tenantId.
      const product = await tx.product.findFirst({
        where: { id: line.productId, tenantId: ctx.tenantId },
        select: { id: true, costPrice: true },
      })
      if (!product) {
        throw new PurchaseOrderStateError('NOT_DRAFT', `Product ${line.productId} not found`)
      }

      // Get current total stock for this product (across all warehouses)
      // to compute the weighted average. Use aggregate on stockLevel.
      const stockAgg = await tx.stockLevel.aggregate({
        where: { productId: line.productId },
        _sum: { quantity: true },
      })
      const currentQty = stockAgg._sum.quantity ? Number(stockAgg._sum.quantity) : 0
      const currentCost = Number(product.costPrice)

      // Record the stock movement (also updates StockLevel)
      const movement = await recordMovement(
        {
          productId: line.productId,
          warehouseId: line.warehouseId,
          type: 'RECEIPT',
          quantity: qty,
          unitCost,
          sourceModule: 'purchase',
          sourceRefId: po.id,
        },
        tx
      )
      movementIds.push(movement.id)

      // Compute + apply new weighted-average costPrice
      const newCostPrice = computeWeightedAverageCost(currentQty, currentCost, qty, unitCost)
      await tx.product.update({
        where: { id: line.productId, tenantId: ctx.tenantId },
        data: { costPrice: newCostPrice },
      })
    }

    // b. Create the balanced JournalEntry (Debit Inventory, Credit AP)
    const jeInput: JournalEntryInput = {
      date: po.date,
      description: `PO ${po.number} — ${po.supplierName} (inventory receipt)`,
      sourceModule: 'inventory',
      sourceRefId: po.id,
      lines: [
        { accountId: inventoryAccount.id, debit: totalCost, credit: 0 },
        { accountId: apAccount.id, debit: 0, credit: totalCost },
      ],
    }
    const je = await createJournalEntryOn(tx, jeInput)

    // c. Link all movements to the JE
    for (const movementId of movementIds) {
      await tx.stockMovement.update({
        where: { id: movementId },
        data: { journalEntryId: je.id },
      })
    }

    // d. Update PO status
    const updated = await tx.purchaseOrder.update({
      where: { id, tenantId: ctx.tenantId },
      data: {
        status: 'RECEIVED',
        journalEntryId: je.id,
      },
      include: { lines: true },
    })

    return { purchaseOrder: updated, journalEntryId: je.id, totalCost }
  })

  return result
}
