/**
 * Server-side helpers for extracting the session and building a tenant
 * context for the duration of a request.
 */
import { getServerSession, type Session } from 'next-auth'
import { authOptions } from './options'
import { runInTenantContext, type TenantContextValue } from '@/core/tenancy/context'
import {
  getSubscription,
  requireActiveSubscription,
  type HttpMethod,
} from '@/modules/billing/subscription.service'

export async function getSession(): Promise<Session | null> {
  return getServerSession(authOptions)
}

/**
 * Run a handler inside a tenant context derived from the authenticated
 * session. Returns `{ status: 401 }` if not authenticated (so the route
 * handler can respond with 401).
 *
 * Phase 8 — central subscription enforcement (per /upload/saas-billing.md
 * §"نقطة تنفيذ واحدة، نفس فلسفة RLS"): `requireActiveSubscription` is
 * called HERE, once, for every authenticated request. No other service
 * re-checks subscription state. This mirrors the Phase 0 decision to
 * enforce tenant isolation in a single Prisma Proxy rather than every
 * service.
 *
 * State matrix (see subscription.service.ts for the full table):
 *   TRIALING / ACTIVE / PAST_DUE → proceed (PAST_DUE shows a UI warning)
 *   SUSPENDED + GET              → proceed (read-only; data is customer's)
 *   SUSPENDED + write            → throws SubscriptionSuspendedError → 402
 *   CANCELLED (any method)       → throws SubscriptionSuspendedError → 402
 *
 * The thrown `SubscriptionSuspendedError` propagates out of this function
 * and is caught by the route handler's existing try/catch, then mapped to
 * an HTTP 402 response by `mapError` in `src/lib/api.ts`. This matches
 * the existing pattern for `RbacError`, `ZodError`, etc. — no per-route
 * 402 handling needed.
 *
 * A tenant with NO subscription row (pre-Phase 8 tenants, or a brand-new
 * tenant before onboarding creates one) is allowed through — the check
 * only applies when a subscription exists. This keeps the system working
 * without forcing a backfill of every tenant.
 *
 * Usage in an API route:
 *   // GET (default — subscription check is read-tolerant)
 *   return withTenantContext(async (ctx) => { ... })
 *   // Write — pass the method so SUSPENDED blocks it with 402
 *   return withTenantContext(async (ctx) => { ... }, 'POST')
 */
export async function withTenantContext<T>(
  fn: (ctx: TenantContextValue) => Promise<T>,
  method: HttpMethod = 'GET'
): Promise<T | { status: 401 }> {
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

  // Phase 8 — central subscription enforcement. Throws
  // SubscriptionSuspendedError when the state disallows `method`. The
  // error propagates to the route handler's try/catch, which maps it to
  // HTTP 402 via `mapError`. This is the SINGLE enforcement point — no
  // other service re-checks subscription state.
  const subscription = await getSubscription(ctx.tenantId)
  if (subscription) {
    requireActiveSubscription(subscription, method)
  }

  return runInTenantContext(ctx, () => fn(ctx))
}
