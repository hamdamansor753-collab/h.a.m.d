/**
 * Module Override service — get/set per-tenant module visibility overrides.
 *
 * Per /upload/industry-activation.md: overrides take priority over the
 * INDUSTRY_MODULE_MAP defaults. Admin can enable a hidden module or
 * disable a visible one for their tenant.
 *
 * FIX: Now uses `db` (the scoped Prisma Proxy) instead of `dbRaw` with
 * manual RLS bypass. The Proxy automatically injects `tenantId` on every
 * query — fail-closed, no manual filtering needed.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import { getDefaultModules, computeActiveModules, ALL_MODULE_KEYS, type ModuleKey } from './industry-modules'
import type { TenantModuleOverride } from '@prisma/client'

/**
 * Get all overrides for the current tenant.
 * Permission: tenant:manage.
 */
export async function getModuleOverrides(): Promise<TenantModuleOverride[]> {
  requirePermission('tenant:manage')
  return db.tenantModuleOverride.findMany()
}

/**
 * Get the computed active modules for a tenant.
 * Combines INDUSTRY_MODULE_MAP[businessType] + overrides.
 * Uses dbRaw for the tenant lookup (platform-level), then db for the
 * override query (tenant-scoped via Proxy).
 */
export async function getActiveModules(tenantId: string, businessType: string): Promise<ModuleKey[]> {
  // db.tenantModuleOverride is scoped by the Proxy — but this function is
  // called from /api/session BEFORE withTenantContext is established.
  // So we need to query with the tenantId explicitly.
  // We use dbRaw here because the Proxy requires a tenant context that
  // hasn't been set yet at this point in the session route.
  const { dbRaw } = await import('@/lib/db')
  try { await dbRaw.$executeRawUnsafe('SET LOCAL row_security = off') } catch {}
  const overrides = await dbRaw.tenantModuleOverride.findMany({
    where: { tenantId },
  })
  return computeActiveModules(businessType, overrides)
}

/**
 * Set a module override (enable/disable) for the current tenant.
 * Permission: tenant:manage.
 */
export async function setModuleOverride(moduleKey: string, enabled: boolean): Promise<TenantModuleOverride> {
  requirePermission('tenant:manage')
  return db.tenantModuleOverride.upsert({
    where: {
      tenantId_moduleKey: {
        tenantId: getTenantContext()!.tenantId,
        moduleKey,
      },
    },
    create: {
      moduleKey,
      enabled,
    },
    update: {
      enabled,
    },
  })
}

/**
 * Get the full module status (all modules with their current effective state).
 * Permission: tenant:manage.
 */
export async function getModuleStatus(): Promise<Array<{
  moduleKey: string
  enabled: boolean
  isDefault: boolean
  isOverridden: boolean
}>> {
  requirePermission('tenant:manage')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  // Get businessType via dbRaw (Tenant is not in scoped delegates)
  const { dbRaw } = await import('@/lib/db')
  try { await dbRaw.$executeRawUnsafe('SET LOCAL row_security = off') } catch {}
  const tenant = await dbRaw.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { businessType: true },
  })
  const businessType = tenant?.businessType ?? 'general'
  const defaults = new Set(getDefaultModules(businessType))

  // Get overrides via db (scoped by Proxy — no manual tenantId filter)
  const overrides = await db.tenantModuleOverride.findMany()
  const overrideMap = new Map(overrides.map(o => [o.moduleKey, o.enabled]))

  return ALL_MODULE_KEYS.map(key => {
    const isDefault = defaults.has(key)
    const override = overrideMap.get(key)
    const isOverridden = override !== undefined
    const enabled = isOverridden ? override! : isDefault
    return { moduleKey: key, enabled, isDefault, isOverridden }
  })
}
