/**
 * Server-side helpers for extracting the session and building a tenant
 * context for the duration of a request.
 */
import { getServerSession, type Session } from 'next-auth'
import { authOptions } from './options'
import { runInTenantContext, type TenantContextValue } from '@/core/tenancy/context'
import { dbRaw } from '@/lib/db'
import { getSubscription, requireActiveSubscription } from '@/modules/saas/subscription.service'

export async function getSession(): Promise<Session | null> {
  return getServerSession(authOptions)
}

/**
 * Run a handler inside a tenant context derived from the authenticated
 * session. Returns null if not authenticated (so the route handler can
 * respond with 401).
 *
 * On PostgreSQL with RLS enabled, this also sets the session variable
 * `app.current_tenant_id` so the database RLS policies can filter rows.
 * This is the SECOND layer of defense (the first is the Prisma Proxy).
 *
 * Phase 8: also enforces subscription status centrally. SUSPENDED allows
 * GET but rejects writes (402). CANCELLED rejects everything.
 *
 * Usage in an API route:
 *   return withTenantContext(async (ctx) => { ... }, 'POST')
 */
export async function withTenantContext<T>(
  fn: (ctx: TenantContextValue) => Promise<T>,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET'
): Promise<T | { status: 401 } | { status: 402 }> {
  const session = await getSession()
  if (!session?.user) {
    return { status: 401 as const }
  }
  const ctx: TenantContextValue = {
    tenantId: session.user.tenantId,
    userId: session.user.id,
    roleKeys: session.user.roleKeys,
    permissionKeys: session.user.permissionKeys,
    locale: session.user.locale,
  }
  return runInTenantContext(ctx, async () => {
    // Set the PostgreSQL session variable for RLS.
    try {
      await dbRaw.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${ctx.tenantId}'`)
    } catch {
      // SQLite doesn't support SET LOCAL — ignore.
    }

    // Phase 8: Central subscription enforcement.
    // Called ONCE here — no other service needs to check subscription state.
    // If the subscription is SUSPENDED and the method is a write, this throws
    // SubscriptionSuspendedError → caught by the route's catch → 402 response.
    const subscription = await getSubscription(ctx.tenantId)
    requireActiveSubscription(subscription, method)

    return fn(ctx)
  })
}
