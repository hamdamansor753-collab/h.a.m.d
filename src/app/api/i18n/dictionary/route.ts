/**
 * GET /api/i18n/dictionary?locale=ar-EG
 * Public endpoint: returns the client-side dictionary for the requested
 * locale, with English fallback merged in. Used by the login screen
 * (pre-auth) and by the in-app language switcher.
 *
 * runtime = 'nodejs' (loads translations from Prisma).
 */
import { NextResponse } from 'next/server'
import { buildClientDictionary, loadTranslations } from '@/core/i18n'
import { getDir, isLocale } from '@/core/i18n/locales'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  await loadTranslations()
  const url = new URL(req.url)
  const raw = url.searchParams.get('locale') ?? 'ar-EG'
  const locale = isLocale(raw) ? raw : 'ar-EG'
  return NextResponse.json({
    locale,
    dir: getDir(locale),
    dictionary: buildClientDictionary(locale),
  })
}
