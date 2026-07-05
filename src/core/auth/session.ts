/**
 * Server-side helpers for extracting the session and building a tenant
 * context for the duration of a request.
 */
import { getServerSession, type Session } from 'next-auth'
import { authOptions } from './options'
import { runInTenantContext, type TenantContextValue } from '@/core/tenancy/context'

export async function getSession(): Promise<Session | null> {
  return getServerSession(authOptions)
}

/**
 * Run a handler inside a tenant context derived from the authenticated
 * session. Returns null if not authenticated (so the route handler can
 * respond with 401).
 *
 * Usage in an API route:
 *   return withTenantContext(async (ctx) => { ... })
 */
export async function withTenantContext<T>(
  fn: (ctx: TenantContextValue) => Promise<T>
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
  return runInTenantContext(ctx, () => fn(ctx))
}
