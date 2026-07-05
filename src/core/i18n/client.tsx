'use client'

/**
 * Client-side i18n provider. Receives a pre-built dictionary from the
 * server (see buildClientDictionary) and exposes `t()` and Intl formatters
 * via React context. No client-side fetching — the dictionary ships with
 * the initial HTML.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'

interface I18nContextValue {
  locale: string
  dir: 'rtl' | 'ltr'
  dictionary: Record<string, string>
  t: (key: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  locale,
  dir,
  dictionary,
  children,
}: {
  locale: string
  dir: 'rtl' | 'ltr'
  dictionary: Record<string, string>
  children: ReactNode
}) {
  const value = useMemo<I18nContextValue>(() => {
    return {
      locale,
      dir,
      dictionary,
      t: (key: string) => dictionary[key] ?? key,
    }
  }, [locale, dir, dictionary])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used inside <I18nProvider>')
  }
  return ctx
}

/** Client-side number formatting via Intl. */
export function useFormatNumber() {
  const { locale } = useI18n()
  return useMemo(() => {
    return (value: number | string, options?: Intl.NumberFormatOptions) => {
      const n = typeof value === 'string' ? Number(value) : value
      if (!Number.isFinite(n)) return '—'
      return new Intl.NumberFormat(locale, options).format(n)
    }
  }, [locale])
}

/** Client-side date formatting via Intl. */
export function useFormatDate() {
  const { locale } = useI18n()
  return useMemo(() => {
    return (value: Date | string, options?: Intl.DateTimeFormatOptions) => {
      const d = typeof value === 'string' ? new Date(value) : value
      return new Intl.DateTimeFormat(locale, options ?? { year: 'numeric', month: 'short', day: 'numeric' }).format(d)
    }
  }, [locale])
}
