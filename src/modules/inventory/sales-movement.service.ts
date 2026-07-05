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

async function resolveSaleAccounts(
  client: Prisma.TransactionClient | typeof db = db,
  tenantId?: string
) {
  const where = (nameKey: string) => tenantId ? { nameKey, tenantId } : { nameKey }
  const [inventory, cogs] = await Promise.all([
    (client as typeof db).account.findFirst({ where: where(INVENTORY_NAME_KEY) }),
    (client as typeof db).account.findFirst({ where: where(COGS_NAME_KEY) }),
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
 * Phase 3 atomicity fix: optional `tx` parameter. When provided:
 *  - Skips permission check (caller — e.g. posSale — handles permissions)
 *  - Uses tx for all reads + writes (with explicit tenantId)
 *  - Does NOT start its own $transaction — runs inside the caller's tx
 * When not provided: standalone behavior (permission check + own $transaction)
 *
 * Throws InsufficientStockError if the requested quantity exceeds
 * available stock — StockLevel is NOT changed in this case. When inside
 * a transaction, this throw causes the entire transaction to roll back.
 */
export async function recordSale(
  input: {
    productId: string
    warehouseId: string
    quantity: number
    sourceRefId: string
  },
  tx?: Prisma.TransactionClient
): Promise<SaleResult> {
  if (!tx) requirePermission('inventory:adjust')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  if (input.quantity <= 0) {
    throw new Error('Sale quantity must be positive')
  }

  const client = tx ?? db

  // 1. Fetch the product to get the current costPrice (explicit tenantId for tx)
  const product = await (client as typeof db).product.findFirst({
    where: { id: input.productId, tenantId: ctx.tenantId },
    select: { id: true, costPrice: true, nameKey: true },
  })
  if (!product) {
    throw new InventoryConfigError(`Product ${input.productId} not found`)
  }

  const unitCost = Number(product.costPrice)
  const cogsAmount = Math.round(unitCost * input.quantity * 100) / 100

  // 2. Resolve COGS + Inventory accounts (pass client + tenantId for tx)
  const { inventory: inventoryAccount, cogs: cogsAccount } = await resolveSaleAccounts(client, ctx.tenantId)

  // 3. Record movement + create COGS JE.
  //    When tx is provided: use it directly (we're inside the caller's tx).
  //    When tx is NOT provided: start our own $transaction.
  //    recordMovement already accepts tx? — it checks sufficient stock
  //    INSIDE the transaction, so a failure rolls back everything.
  const doSale = async (c: Prisma.TransactionClient): Promise<{ movement: StockMovement; journalEntryId: string }> => {
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
      c
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
    const je = await createJournalEntryOn(c, jeInput)

    // Link the movement to the JE
    await c.stockMovement.update({
      where: { id: movement.id },
      data: { journalEntryId: je.id },
    })

    return { movement, journalEntryId: je.id }
  }

  const result = tx ? await doSale(tx) : await db.$transaction(doSale)

  return {
    movement: result.movement,
    journalEntryId: result.journalEntryId,
    unitCost,
    cogsAmount,
  }
}
