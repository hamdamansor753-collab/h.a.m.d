/**
 * Inventory module — Product service.
 *
 * CRUD for products. Per /upload/03-architecture-decisions.md Decision 3:
 * services are the ONLY entry point to the database. API routes must not
 * call Prisma directly.
 *
 * Product.costPrice is a weighted-average cost updated ONLY by the
 * stock-movement service on RECEIPT movements. This service never touches
 * costPrice directly.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import type { Product } from '@prisma/client'

export interface ProductWithStock extends Product {
  stockLevels: Array<{
    id: string
    warehouseId: string
    quantity: string
    warehouse: { id: string; nameKey: string }
  }>
}

/**
 * List all products for the current tenant, with their stock levels.
 * Permission: inventory:read.
 */
export async function listProducts(): Promise<ProductWithStock[]> {
  requirePermission('inventory:read')
  return db.product.findMany({
    orderBy: { sku: 'asc' },
    include: {
      stockLevels: {
        include: { warehouse: { select: { id: true, nameKey: true } } },
      },
    },
  })
}

/**
 * Get a single product by ID (scoped to current tenant).
 * Permission: inventory:read.
 */
export async function getProduct(id: string): Promise<Product | null> {
  requirePermission('inventory:read')
  return db.product.findUnique({ where: { id } })
}

/**
 * Create a new product. costPrice starts at 0 — it's updated by the
 * stock-movement service when stock is received.
 * Permission: inventory:adjust (creating a product is an inventory
 * management action).
 */
export async function createProduct(input: {
  sku: string
  nameKey: string
  sellPrice: number
}): Promise<Product> {
  requirePermission('inventory:adjust')
  return db.product.create({
    data: {
      sku: input.sku,
      nameKey: input.nameKey,
      sellPrice: input.sellPrice,
      costPrice: 0, // starts at 0; updated on first receipt
    },
  })
}
