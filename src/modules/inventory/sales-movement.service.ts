/**
 * Inventory module — Sales movement service.
 *
 * `recordSale` is the service that POS/Sales modules will call when a sale
 * happens. It:
 *  1. Rejects if the requested quantity exceeds available stock (no negative
 *     stock allowed — backorder is a future feature).
 *  2. Creates a StockMovement(SALE) + updates StockLevel (via recordMovement).
 *  3. Creates a COGS JournalEntry:
 *       Debit  COGS (EXPENSE) = quantity × unitCost (the CURRENT costPrice,
 *              NOT the sell price — this is the cost of goods sold)
 *       Credit Inventory (ASSET) = same amount
 *
 * The unit cost for COGS is the product's current weighted-average costPrice
 * at the time of sale. This is NOT recalculated by the sale — only receipts
 * update costPrice.
 *
 * NOTE: This service does NOT record the revenue side of the sale (debit
 * Cash/AR, credit Revenue). That's the invoice service's job (Phase 1).
 * This service handles ONLY the inventory/COGS side. A future integrated
 * sale flow will call both: recordSale() for COGS + createInvoice() for
 * the revenue + tax.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import { recordMovement } from './stock-movement.service'
import { createJournalEntryOn, type JournalEntryInput } from '@/core/ledger/journal-entry.service'
import { InventoryConfigError, InsufficientStockError } from '@/lib/api'
import type { StockMovement, Prisma } from '@prisma/client'

// ---------- Account resolution ----------

const INVENTORY_NAME_KEY = 'account.inventory'
const COGS_NAME_KEY = 'account.cogs'

async function resolveSaleAccounts() {
  const [inventory, cogs] = await Promise.all([
    db.account.findFirst({ where: { nameKey: INVENTORY_NAME_KEY } }),
    db.account.findFirst({ where: { nameKey: COGS_NAME_KEY } }),
  ])
  if (!inventory || !cogs) {
    throw new InventoryConfigError(
      'Missing required sale accounts. Ensure the seed created accounts with nameKeys: ' +
        `${INVENTORY_NAME_KEY}, ${COGS_NAME_KEY}`
    )
  }
  return { inventory, cogs }
}

// ---------- recordSale ----------

export interface SaleResult {
  movement: StockMovement
  journalEntryId: string
  unitCost: number
  cogsAmount: number
}

/**
 * Record a sale: decrease stock + create COGS journal entry.
 *
 * Parameters:
 *  - productId, warehouseId: the stock location
 *  - quantity: units sold (must be > 0)
 *  - sourceRefId: ID of the originating sale document (invoice ID, POS tx ID)
 *
 * Permission: inventory:adjust (a sale adjusts inventory). The revenue
 * side is handled by the invoice service with its own permission.
 *
 * Throws InsufficientStockError if the requested quantity exceeds
 * available stock — StockLevel is NOT changed in this case.
 */
export async function recordSale(input: {
  productId: string
  warehouseId: string
  quantity: number
  sourceRefId: string
}): Promise<SaleResult> {
  requirePermission('inventory:adjust')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  if (input.quantity <= 0) {
    throw new Error('Sale quantity must be positive')
  }

  // 1. Fetch the product to get the current costPrice (used for COGS)
  const product = await db.product.findUnique({
    where: { id: input.productId },
    select: { id: true, costPrice: true, nameKey: true },
  })
  if (!product) {
    throw new InventoryConfigError(`Product ${input.productId} not found`)
  }

  const unitCost = Number(product.costPrice)
  const cogsAmount = Math.round(unitCost * input.quantity * 100) / 100

  // 2. Resolve COGS + Inventory accounts
  const { inventory: inventoryAccount, cogs: cogsAccount } = await resolveSaleAccounts()

  // 3. Atomic: record movement + create COGS JE
  const result = await db.$transaction(async (tx) => {
    // recordMovement checks sufficient stock INSIDE the transaction (avoids
    // race conditions). If insufficient, it throws InsufficientStockError
    // and the transaction rolls back — StockLevel is unchanged.
    const movement = await recordMovement(
      {
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: 'SALE',
        quantity: input.quantity,
        unitCost,
        sourceModule: 'sales',
        sourceRefId: input.sourceRefId,
      },
      tx
    )

    // Create the COGS JournalEntry
    const jeInput: JournalEntryInput = {
      date: new Date(),
      description: `COGS — Sale ${input.sourceRefId} (${product.nameKey})`,
      sourceModule: 'inventory',
      sourceRefId: input.sourceRefId,
      lines: [
        { accountId: cogsAccount.id, debit: cogsAmount, credit: 0 },
        { accountId: inventoryAccount.id, debit: 0, credit: cogsAmount },
      ],
    }
    const je = await createJournalEntryOn(tx, jeInput)

    // Link the movement to the JE
    await tx.stockMovement.update({
      where: { id: movement.id },
      data: { journalEntryId: je.id },
    })

    return { movement, journalEntryId: je.id }
  })

  return {
    movement: result.movement,
    journalEntryId: result.journalEntryId,
    unitCost,
    cogsAmount,
  }
}
