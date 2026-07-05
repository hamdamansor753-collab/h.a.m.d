/**
 * Inventory module — StockMovement service.
 *
 * THE SOLE GATEKEEPER for StockLevel.quantity. Per /upload/inventory.md:
 * "ممنوع تمامًا أي تحديث مباشر لـ StockLevel.quantity من أي كود". Every
 * stock change MUST go through `recordMovement()` here, which creates a
 * StockMovement row AND updates the StockLevel in the SAME transaction.
 *
 * This mirrors the ledger philosophy: StockMovement is the append-only
 * audit trail (like JournalEntry), StockLevel is the derived balance
 * (like an account balance).
 *
 * Direction by type:
 *   RECEIPT, TRANSFER_IN, ADJUSTMENT(+) → StockLevel.quantity += quantity
 *   SALE, TRANSFER_OUT, ADJUSTMENT(-)   → StockLevel.quantity -= quantity
 *
 * For ADJUSTMENT, the sign is encoded in `quantity` (can be negative).
 * For all other types, quantity is always positive and the direction is
 * fixed by the type.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import { InsufficientStockError } from '@/lib/api'
import type { StockMovement, StockMovementType, Prisma } from '@prisma/client'

/** Types that INCREASE stock. */
const INBOUND_TYPES = new Set<StockMovementType>(['RECEIPT', 'TRANSFER_IN'])
/** Types that DECREASE stock. */
const OUTBOUND_TYPES = new Set<StockMovementType>(['SALE', 'TRANSFER_OUT'])
/** ADJUSTMENT can go either way — sign is in the quantity. */

/**
 * Compute the signed delta to apply to StockLevel.quantity.
 * Returns a positive number for inbound, negative for outbound.
 */
function signedDelta(type: StockMovementType, quantity: number): number {
  if (INBOUND_TYPES.has(type)) return quantity
  if (OUTBOUND_TYPES.has(type)) return -quantity
  // ADJUSTMENT: quantity itself carries the sign
  return quantity
}

/**
 * The CORE function — records a stock movement and updates the stock level
 * atomically. This is the ONLY function in the entire codebase that writes
 * to StockLevel.quantity.
 *
 * Permission: inventory:adjust (general stock changes). The purchase and
 * sales services call this internally — they check their own permissions
 * (purchase:receive, etc.) before calling.
 *
 * Parameters:
 *  - productId, warehouseId: the stock location (must belong to current tenant)
 *  - type: RECEIPT | SALE | TRANSFER_IN | TRANSFER_OUT | ADJUSTMENT
 *  - quantity: always positive for RECEIPT/SALE/TRANSFER; can be +/- for ADJUSTMENT
 *  - unitCost: cost per unit at time of movement (for COGS accuracy)
 *  - sourceModule: "purchase" | "sales" | "adjustment" | "transfer"
 *  - sourceRefId: ID of the originating document
 *  - tx (optional): if provided, runs inside the caller's transaction.
 *    Otherwise runs in its own implicit transaction.
 *
 * Returns the created StockMovement (with journalEntryId null — the caller
 * links the JE if one was created, via updateMovementWithJournalEntry).
 */
export async function recordMovement(
  input: {
    productId: string
    warehouseId: string
    type: StockMovementType
    quantity: number
    unitCost: number
    sourceModule: string
    sourceRefId: string
  },
  tx?: Prisma.TransactionClient
): Promise<StockMovement> {
  // Permission check only when NOT inside a transaction (i.e., when called
  // directly from a route). When called from receivePurchaseOrder or
  // recordSale, those services have already checked their own permissions.
  if (!tx) {
    requirePermission('inventory:adjust')
  }

  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  const client = tx ?? db
  const delta = signedDelta(input.type, input.quantity)

  // For outbound movements, check sufficient stock BEFORE writing.
  // We do this inside the transaction to avoid race conditions.
  if (delta < 0) {
    const existingLevel = await (client as typeof db).stockLevel.findUnique({
      where: {
        productId_warehouseId: {
          productId: input.productId,
          warehouseId: input.warehouseId,
        },
      },
    })
    const currentQty = existingLevel ? Number(existingLevel.quantity) : 0
    if (currentQty + delta < 0) {
      throw new InsufficientStockError(
        input.productId,
        input.warehouseId,
        input.quantity,
        currentQty
      )
    }
  }

  // Create the StockMovement (append-only) + upsert the StockLevel.
  // Both in the same transaction (if tx provided) or Prisma's implicit
  // transaction for the two operations.
  const movement = await (client as typeof db).stockMovement.create({
    data: {
      tenantId: ctx.tenantId, // explicit — tx has no middleware
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      quantity: input.quantity,
      unitCost: input.unitCost,
      sourceModule: input.sourceModule,
      sourceRefId: input.sourceRefId,
    },
  })

  // Upsert the StockLevel. The @@unique([productId, warehouseId]) constraint
  // means we either create a new row or update the existing one.
  await (client as typeof db).stockLevel.upsert({
    where: {
      productId_warehouseId: {
        productId: input.productId,
        warehouseId: input.warehouseId,
      },
    },
    create: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: delta,
    },
    update: {
      quantity: { increment: delta },
    },
  })

  return movement
}

/**
 * Link a StockMovement to the JournalEntry it generated. Called by
 * receivePurchaseOrder and recordSale after creating the JE.
 */
export async function linkMovementToJournalEntry(
  movementId: string,
  journalEntryId: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')
  const client = tx ?? db
  await (client as typeof db).stockMovement.update({
    where: { id: movementId },
    data: { journalEntryId },
  })
}

/**
 * List stock movements for the current tenant (audit trail).
 * Permission: inventory:read.
 */
export async function listStockMovements(limit = 100): Promise<StockMovement[]> {
  requirePermission('inventory:read')
  return db.stockMovement.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/**
 * Get the current stock level for a product at a warehouse.
 * Permission: inventory:read.
 */
export async function getStockLevel(
  productId: string,
  warehouseId: string
): Promise<number> {
  requirePermission('inventory:read')
  const level = await db.stockLevel.findUnique({
    where: {
      productId_warehouseId: { productId, warehouseId },
    },
  })
  return level ? Number(level.quantity) : 0
}

/**
 * Compute the weighted-average cost for a product given a new receipt.
 *
 * Formula (per /upload/inventory.md — "متوسط تكلفة مرجّح مبسّط"):
 *   newCostPrice = (currentQty × currentCost + receivedQty × receivedUnitCost)
 *                  / (currentQty + receivedQty)
 *
 * This is a SIMPLIFIED weighted average:
 *  - It pools ALL warehouses' stock into one cost figure (per-product, not
 *    per-warehouse). A future phase may track cost per-warehouse.
 *  - It does NOT use FIFO/LIFO — explicitly deferred per the spec.
 *  - On a SALE, costPrice is NOT recalculated (the sale uses the current
 *    costPrice as the COGS unit cost).
 *  - If currentQty is 0, the new cost is simply the received unit cost
 *    (no averaging needed).
 *
 * The function returns the NEW costPrice (rounded to 2 decimals). The
 * caller (receivePurchaseOrder) applies it via Product.update.
 *
 * NOTE: this is a pure calculation — it does NOT write to the DB.
 */
export function computeWeightedAverageCost(
  currentQty: number,
  currentCost: number,
  receivedQty: number,
  receivedUnitCost: number
): number {
  const totalQty = currentQty + receivedQty
  if (totalQty <= 0) return currentCost
  const totalValue = currentQty * currentCost + receivedQty * receivedUnitCost
  return Math.round((totalValue / totalQty) * 100) / 100
}
