/**
 * GET /api/admin/tenants — super-admin only: list all tenants with subscriptions
 *
 * This route uses dbRaw (bypasses tenant scoping) — it's the "separate
 * connection with special privileges" described in 03-architecture-decisions.md.
 *
 * Permission: platform:admin (NOT part of normal RBAC — separate from tenant roles).
 *
 * runtime = 'nodejs' (Prisma). Auth required.
 */
import { NextResponse } from 'next/server'
import { getSession } from '@/core/auth/session'
import { listAllTenantsWithSubscriptions } from '@/modules/saas/subscription.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 })
  }

  // Check platform:admin permission — completely separate from tenant RBAC.
  if (!session.user.permissionKeys.includes('platform:admin')) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Platform admin access required' } }, { status: 403 })
  }

  try {
    const tenants = await listAllTenantsWithSubscriptions()
    return NextResponse.json(tenants)
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, { status: 500 })
  }
}
