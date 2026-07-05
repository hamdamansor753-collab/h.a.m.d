/**
 * Inventory module — Warehouse service.
 *
 * CRUD for warehouses. Multi-warehouse support per tenant.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import type { Warehouse } from '@prisma/client'

export interface WarehouseWithStock extends Warehouse {
  _count?: { stockLevels: number }
}

/**
 * List all warehouses for the current tenant.
 * Permission: inventory:read.
 */
export async function listWarehouses(): Promise<Warehouse[]> {
  requirePermission('inventory:read')
  return db.warehouse.findMany({ orderBy: { createdAt: 'asc' } })
}

/**
 * Get a single warehouse by ID (scoped to current tenant).
 * Permission: inventory:read.
 */
export async function getWarehouse(id: string): Promise<Warehouse | null> {
  requirePermission('inventory:read')
  return db.warehouse.findUnique({ where: { id } })
}

/**
 * Create a new warehouse.
 * Permission: inventory:adjust.
 */
export async function createWarehouse(input: {
  nameKey: string
  isDefault?: boolean
}): Promise<Warehouse> {
  requirePermission('inventory:adjust')
  // If this warehouse is set as default, unset any existing default first.
  if (input.isDefault) {
    await db.warehouse.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    })
  }
  return db.warehouse.create({
    data: {
      nameKey: input.nameKey,
      isDefault: input.isDefault ?? false,
    },
  })
}

/**
 * Get the default warehouse for the current tenant. Falls back to the
 * first warehouse if none is marked as default.
 * Permission: inventory:read.
 */
export async function getDefaultWarehouse(): Promise<Warehouse | null> {
  requirePermission('inventory:read')
  const def = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (def) return def
  return db.warehouse.findFirst({ orderBy: { createdAt: 'asc' } })
}
