/**
 * Server-side helpers for extracting the session and building a tenant
 * context for the duration of a request.
 */
import { getServerSession, type Session } from 'next-auth'
import { authOptions } from './options'
import { runInTenantContext, type TenantContextValue } from '@/core/tenancy/context'
import { dbRaw } from '@/lib/db'

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
  return runInTenantContext(ctx, async () => {
    // Set the PostgreSQL session variable for RLS.
    // This tells the database which tenant's rows to show.
    // On SQLite this is a no-op (SQLite ignores unknown SET commands
    // via $executeRawUnsafe, or we catch the error silently).
    try {
      await dbRaw.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${ctx.tenantId}'`)
    } catch {
      // SQLite doesn't support SET LOCAL — ignore. The Prisma Proxy
      // handles tenant isolation on SQLite.
    }
    return fn(ctx)
  })
}
