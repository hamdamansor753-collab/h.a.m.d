/**
 * Manufacturing module — BOM + Production Order service.
 *
 * Per /upload/manufacturing.md + fix request:
 *  - BOM: define what raw materials make up a finished product
 *  - ProductionOrder: consume raw materials → produce finished product
 *  - completeProductionOrder: ATOMIC transaction (same pattern as posSale)
 *    1. Pre-check ALL components have sufficient stock
 *    2. Consume each raw material via recordMovement (reuses Phase 2/6)
 *    3. Output finished product via recordMovement (PRODUCTION_OUTPUT)
 *    4. Calculate material + labor cost, update finishedProduct.costPrice (weighted avg)
 *    5. Create balanced JE with SEPARATE accounts:
 *       Debit:  finishedGoodsInventory = totalCost
 *       Credit: rawMaterialsInventory  = totalMaterialCost
 *       Credit: directLabor            = totalLaborCost (if > 0)
 *    6. Update ProductionOrder status to COMPLETED
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import { recordMovement, getStockLevel, computeWeightedAverageCost } from '@/modules/inventory/stock-movement.service'
import { createJournalEntryOn, type JournalEntryInput } from '@/core/ledger/journal-entry.service'
import { InsufficientStockError } from '@/lib/api'
import type { Prisma } from '@prisma/client'

// ---------- Account nameKeys (separate accounts per fix request) ----------
const FINISHED_GOODS_NAME_KEY = 'account.finishedGoods'
const RAW_MATERIALS_NAME_KEY = 'account.rawMaterials'
const DIRECT_LABOR_NAME_KEY = 'account.directLabor'

// ---------- BOM CRUD ----------

export interface BOMWithComponents {
  id: string
  finishedProductId: string
  laborCostPerUnit: string
  components: Array<{
    id: string
    rawMaterialProductId: string
    quantityPerUnit: string
    rawMaterial: { id: string; sku: string; nameKey: string }
  }>
  finishedProduct: { id: string; sku: string; nameKey: string }
}

export async function listBOMs(): Promise<BOMWithComponents[]> {
  requirePermission('manufacturing:read')
  return db.billOfMaterials.findMany({
    include: {
      components: { include: { rawMaterial: { select: { id: true, sku: true, nameKey: true } } } },
      finishedProduct: { select: { id: true, sku: true, nameKey: true } },
    },
  })
}

export async function createBOM(input: {
  finishedProductId: string
  laborCostPerUnit?: number
  components: Array<{ rawMaterialProductId: string; quantityPerUnit: number }>
}): Promise<BOMWithComponents> {
  requirePermission('manufacturing:manage')
  return db.billOfMaterials.create({
    data: {
      finishedProductId: input.finishedProductId,
      laborCostPerUnit: input.laborCostPerUnit ?? 0,
      components: { create: input.components.map(c => ({ rawMaterialProductId: c.rawMaterialProductId, quantityPerUnit: c.quantityPerUnit })) },
    },
    include: {
      components: { include: { rawMaterial: { select: { id: true, sku: true, nameKey: true } } } },
      finishedProduct: { select: { id: true, sku: true, nameKey: true } },
    },
  })
}

// ---------- Production Order CRUD ----------

export async function listProductionOrders() {
  requirePermission('manufacturing:read')
  return db.productionOrder.findMany({ orderBy: { createdAt: 'desc' } })
}

export async function createProductionOrder(input: { finishedProductId: string; quantity: number; warehouseId: string }) {
  requirePermission('production:run')
  return db.productionOrder.create({
    data: { finishedProductId: input.finishedProductId, quantity: input.quantity, warehouseId: input.warehouseId, status: 'DRAFT' },
    select: { id: true, status: true },
  })
}

// ---------- Complete Production Order (atomic) ----------

export async function completeProductionOrder(id: string): Promise<{
  productionOrderId: string
  journalEntryId: string
  totalMaterialCost: number
  totalLaborCost: number
  totalCost: number
}> {
  requirePermission('production:run')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  // 1. Fetch the production order
  const order = await db.productionOrder.findUnique({ where: { id } })
  if (!order) throw new Error('Production order not found')
  if (order.status !== 'DRAFT') throw new Error(`Cannot complete order in status ${order.status}`)

  // 2. Fetch the BOM
  const bom = await db.billOfMaterials.findFirst({
    where: { finishedProductId: order.finishedProductId },
    include: { components: true },
  })
  if (!bom) throw new Error('No BOM found for this product')

  const productionQty = Number(order.quantity)

  // 3. Pre-check ALL components have sufficient stock
  for (const component of bom.components) {
    const requiredQty = Number(component.quantityPerUnit) * productionQty
    const available = await getStockLevel(component.rawMaterialProductId, order.warehouseId)
    if (available < requiredQty) {
      throw new InsufficientStockError(component.rawMaterialProductId, order.warehouseId, requiredQty, available)
    }
  }

  // 4. Resolve the SEPARATE inventory accounts (per fix request)
  const [finishedGoodsAcc, rawMaterialsAcc] = await Promise.all([
    db.account.findFirst({ where: { nameKey: FINISHED_GOODS_NAME_KEY } }),
    db.account.findFirst({ where: { nameKey: RAW_MATERIALS_NAME_KEY } }),
  ])
  if (!finishedGoodsAcc) throw new Error(`Account ${FINISHED_GOODS_NAME_KEY} not found — run seed`)
  if (!rawMaterialsAcc) throw new Error(`Account ${RAW_MATERIALS_NAME_KEY} not found — run seed`)

  // Resolve direct labor account (optional — if labor cost is 0, not needed)
  let laborAcc = null
  if (Number(bom.laborCostPerUnit) > 0) {
    laborAcc = await db.account.findFirst({ where: { nameKey: DIRECT_LABOR_NAME_KEY } })
    if (!laborAcc) throw new Error(`Account ${DIRECT_LABOR_NAME_KEY} not found — run seed`)
  }

  // 5. ATOMIC transaction
  const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    let totalMaterialCost = 0

    // 5a. Consume each raw material
    for (const component of bom.components) {
      const requiredQty = Number(component.quantityPerUnit) * productionQty
      const rawMaterial = await tx.product.findFirst({
        where: { id: component.rawMaterialProductId, tenantId: ctx.tenantId },
        select: { id: true, costPrice: true },
      })
      if (!rawMaterial) throw new Error(`Raw material ${component.rawMaterialProductId} not found`)

      const unitCost = Number(rawMaterial.costPrice)
      totalMaterialCost += unitCost * requiredQty

      await recordMovement({
        productId: component.rawMaterialProductId,
        warehouseId: order.warehouseId,
        type: 'PRODUCTION_CONSUME',
        quantity: requiredQty,
        unitCost,
        sourceModule: 'manufacturing',
        sourceRefId: order.id,
      }, tx)
    }

    // 5b. Calculate labor cost
    const totalLaborCost = Number(bom.laborCostPerUnit) * productionQty
    const totalCost = totalMaterialCost + totalLaborCost
    const unitCostOfOutput = totalCost / productionQty

    // 5c. Output the finished product
    await recordMovement({
      productId: order.finishedProductId,
      warehouseId: order.warehouseId,
      type: 'PRODUCTION_OUTPUT',
      quantity: productionQty,
      unitCost: unitCostOfOutput,
      sourceModule: 'manufacturing',
      sourceRefId: order.id,
    }, tx)

    // 5d. Update finishedProduct.costPrice (weighted average)
    const finishedProduct = await tx.product.findFirst({
      where: { id: order.finishedProductId, tenantId: ctx.tenantId },
      select: { id: true, costPrice: true },
    })
    if (!finishedProduct) throw new Error('Finished product not found')

    const currentStockAgg = await tx.stockLevel.aggregate({
      where: { productId: order.finishedProductId },
      _sum: { quantity: true },
    })
    const currentStock = currentStockAgg._sum.quantity ? Number(currentStockAgg._sum.quantity) : 0
    const previousStock = currentStock - productionQty
    const previousCost = Number(finishedProduct.costPrice)
    const newCostPrice = computeWeightedAverageCost(previousStock, previousCost, productionQty, unitCostOfOutput)

    await tx.product.update({
      where: { id: order.finishedProductId, tenantId: ctx.tenantId },
      data: { costPrice: newCostPrice },
    })

    // 5e. Create balanced JE with SEPARATE accounts (per fix request)
    // Debit:  Finished Goods Inventory = totalCost
    // Credit: Raw Materials Inventory  = totalMaterialCost
    // Credit: Direct Labor              = totalLaborCost (if > 0)
    const jeLines: Array<{ accountId: string; debit: number; credit: number }> = [
      { accountId: finishedGoodsAcc.id, debit: totalCost, credit: 0 },
      { accountId: rawMaterialsAcc.id, debit: 0, credit: totalMaterialCost },
    ]
    if (totalLaborCost > 0 && laborAcc) {
      jeLines.push({ accountId: laborAcc.id, debit: 0, credit: totalLaborCost })
    }

    const jeInput: JournalEntryInput = {
      date: new Date(),
      description: `Production Order — ${productionQty} units`,
      sourceModule: 'manufacturing',
      sourceRefId: order.id,
      lines: jeLines,
    }
    const je = await createJournalEntryOn(tx, jeInput)

    // 5f. Update production order status
    await tx.productionOrder.update({
      where: { id, tenantId: ctx.tenantId },
      data: { status: 'COMPLETED', totalMaterialCost, totalLaborCost, journalEntryId: je.id },
    })

    return {
      productionOrderId: id,
      journalEntryId: je.id,
      totalMaterialCost: Math.round(totalMaterialCost * 100) / 100,
      totalLaborCost: Math.round(totalLaborCost * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
    }
  })

  return result
}
