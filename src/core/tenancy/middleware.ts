/**
 * Tenancy middleware module.
 *
 * The actual tenant-scoping logic now lives in `@/lib/db.ts` as a Proxy
 * that dispatches to per-tenant extended Prisma clients. This file is
 * kept as a documentation entry point — see the link below.
 *
 * See: src/lib/db.ts (createDbProxy, getScopedClient, injectTenant)
 * See: src/core/tenancy/context.ts (AsyncLocalStorage context)
 *
 * The design rationale (why closure-captured tenantId vs AsyncLocalStorage
 * inside $extends) is documented in src/lib/db.ts.
 */

// Re-export the context helpers for convenience — service code imports
// from here OR from @/core/tenancy/context directly.
export {
  getTenantContext,
  requireTenantContext,
  runInTenantContext,
  TenantContextError,
  type TenantContextValue,
} from './context'
