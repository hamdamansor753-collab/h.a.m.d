/**
 * Tenancy context — AsyncLocalStorage carrier for the active tenant/user/roles.
 *
 * The context is set per-request by `runInTenantContext` (called from
 * `withTenantContext` in the auth layer). The Prisma client Proxy in
 * `@/lib/db` reads this context to dispatch tenant-scoped queries to the
 * correct per-tenant extended client.
 *
 * NOTE: We use AsyncLocalStorage to make the tenant available to the Proxy's
 * dispatch logic (which runs in the CALLER's async context). The per-tenant
 * Prisma `$extends` query handlers capture tenantId in a closure instead,
 * because Prisma 6's $extends handlers run in a separate async context that
 * ALS does not propagate into. See `@/lib/db.ts` for the full explanation.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface TenantContextValue {
  tenantId: string
  userId: string
  roleKeys: string[]
  permissionKeys: string[]
  locale: string
}

const noopContext: TenantContextValue | null = null

// CRITICAL: store the AsyncLocalStorage on globalThis to guarantee a single
// instance across all module chunks. Next.js / turbopack may otherwise
// duplicate this module, giving the route handler and the db Proxy
// different ALS instances — which would cause getTenantContext() to return
// null inside the Proxy even though the context was set by the route.
const g = globalThis as unknown as { __hamdTenantContextStorage?: AsyncLocalStorage<TenantContextValue | null> }
export const tenantContextStorage: AsyncLocalStorage<TenantContextValue | null> =
  g.__hamdTenantContextStorage ?? (g.__hamdTenantContextStorage = new AsyncLocalStorage<TenantContextValue | null>())

export function getTenantContext(): TenantContextValue | null {
  const ctx = tenantContextStorage.getStore()
  return ctx ?? null
}

export function runInTenantContext<T>(ctx: TenantContextValue, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run(ctx, fn)
}

export function requireTenantContext(): TenantContextValue {
  const ctx = getTenantContext()
  if (!ctx) {
    throw new TenantContextError(
      'TENANT_CONTEXT_REQUIRED',
      'No tenant context active. This operation must run inside a tenant-scoped request.'
    )
  }
  return ctx
}

export class TenantContextError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'TenantContextError'
  }
}
