/**
 * Next.js edge middleware.
 *
 * Two responsibilities:
 *  1. Protect API routes that require auth — return 401 immediately if no
 *     session token is present. (The route handler still runs the full
 *     RBAC + tenant-context check; this is just an early-out to avoid
 *     spinning up the nodejs runtime for unauthenticated requests.)
 *  2. (Future) locale negotiation — for Phase 0 the locale is per-user
 *     (stored in the JWT), so we don't rewrite the URL here.
 *
 * Per /upload/05-security-baseline.md section 2: every protected route
 * starts with an auth check. This middleware is the FIRST check; the
 * route handler is the SECOND (defense in depth).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

const PROTECTED_PREFIXES = [
  '/api/accounts',
  '/api/journal',
  '/api/tests',
  '/api/session',
  '/api/invoices',
  '/api/reports',
  // Phase 2: inventory
  '/api/warehouses',
  '/api/products',
  '/api/purchase-orders',
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))
  if (!isProtected) return NextResponse.next()

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? 'hamd-dev-secret-change-in-production' })
  if (!token) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    )
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
