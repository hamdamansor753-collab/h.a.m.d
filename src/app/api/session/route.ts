/**
 * GET /api/session
 * Returns the current user's session info (tenant, locale, roles, permissions)
 * plus the client-side i18n dictionary for the user's locale. The dashboard
 * uses this to bootstrap itself after page load.
 *
 * runtime = 'nodejs' (uses NextAuth → Prisma for credential verification
 * on subsequent requests, and loads i18n cache).
 */
import { NextResponse } from 'next/server'
import { getSession } from '@/core/auth/session'
import { buildClientDictionary, loadTranslations } from '@/core/i18n'
import { getDir } from '@/core/i18n/locales'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  await loadTranslations()
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ authenticated: false }, { status: 200 })
  }
  const locale = session.user.locale
  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.user.id,
      tenantId: session.user.tenantId,
      email: session.user.email,
      name: session.user.name,
      locale,
      roleKeys: session.user.roleKeys,
      permissionKeys: session.user.permissionKeys,
    },
    dir: getDir(locale),
    dictionary: buildClientDictionary(locale),
  })
}
