/**
 * Server-side i18n engine.
 *
 * - Loads all translations from the DB once per locale, then caches in memory.
 * - Exposes `t(key, locale)` with a fallback chain: requested locale →
 *   'en' → the key itself (so missing translations are visible in dev,
 *   never silently empty).
 * - Exposes Intl-based formatters for numbers, dates, and currency. No
 *   manual string formatting anywhere in the codebase.
 *
 * Per /upload/03-architecture-decisions.md Decision 5: every user-visible
 * string MUST go through `t()`. No hardcoded text in components.
 */
import { db } from '@/lib/db'
import { getIntlLocale, isLocale, type Locale } from './locales'

type Dictionary = Map<string, string>

const cache = new Map<Locale, Dictionary>()
let loadPromise: Promise<void> | null = null

/**
 * Load all translations into the in-memory cache. Safe to call multiple
 * times — the second call is a no-op. The Translation model is NOT
 * tenant-scoped (translations are shared across all tenants by design),
 * so no bypass is needed here.
 */
export async function loadTranslations(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const rows = await db.translation.findMany()
    for (const row of rows) {
      if (!isLocale(row.locale)) continue
      let dict = cache.get(row.locale)
      if (!dict) {
        dict = new Map()
        cache.set(row.locale, dict)
      }
      dict.set(row.key, row.value)
    }
  })()
  return loadPromise
}

/**
 * Translate a key in the given locale. Falls back to English, then to the
 * key itself (so missing keys are visible during development).
 *
 * NOTE: this function is synchronous for ergonomics — it relies on the
 * cache being pre-warmed. The cache is warmed at server startup (see
 * `warmI18nCache()` called from the auth options module which is imported
 * on every API request). For the first request after a cold start, the
 * cache may be empty; in that case we return the key and the next request
 * will have the cache populated.
 */
export function t(key: string, locale: string): string {
  const loc = isLocale(locale) ? locale : 'en'
  const dict = cache.get(loc)
  if (dict?.has(key)) return dict.get(key)!
  if (loc !== 'en') {
    const enDict = cache.get('en')
    if (enDict?.has(key)) return enDict.get(key)!
  }
  return key
}

/**
 * Build a serializable dictionary (key→value) for a single locale, to be
 * shipped to the client via the I18nProvider. Includes English fallbacks
 * merged in so the client never needs a second round-trip.
 */
export function buildClientDictionary(locale: string): Record<string, string> {
  const loc = isLocale(locale) ? locale : 'en'
  const out: Record<string, string> = {}
  const enDict = cache.get('en')
  if (enDict) for (const [k, v] of enDict) out[k] = v
  const dict = cache.get(loc)
  if (dict) for (const [k, v] of dict) out[k] = v
  return out
}

// ---------------- Intl formatters ----------------

const numberFormatters = new Map<string, Intl.NumberFormat>()
const dateFormatters = new Map<string, Intl.DateTimeFormat>()

export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  const intl = getIntlLocale(locale)
  const key = `${intl}:${JSON.stringify(options ?? {})}`
  let f = numberFormatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(intl, options)
    numberFormatters.set(key, f)
  }
  return f.format(value)
}

export function formatDate(value: Date | string, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const intl = getIntlLocale(locale)
  const key = `${intl}:${JSON.stringify(options ?? {})}`.replace(/\s/g, '')
  let f = dateFormatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(intl, options ?? { year: 'numeric', month: 'short', day: 'numeric' })
    dateFormatters.set(key, f)
  }
  const d = typeof value === 'string' ? new Date(value) : value
  return f.format(d)
}

/**
 * Format a Decimal (from Prisma) as a number string. Prisma returns
 * Decimal objects for `Decimal` columns; convert via `.toString()` then
 * `Number()`. For financial precision in display we keep 2 decimals.
 */
export function formatDecimal(value: { toString(): string } | number | string, locale: string, fractionDigits = 2): string {
  const n = typeof value === 'number' ? value : Number(value.toString())
  if (!Number.isFinite(n)) return '—'
  return formatNumber(n, locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
}
