/**
 * Locale metadata for the three supported locales.
 */
export type Locale = 'ar-EG' | 'ar-SA' | 'en'

export interface LocaleMeta {
  code: Locale
  /** BCP-47 tag used for Intl APIs. */
  intlLocale: string
  /** Display name in the locale's own language. */
  displayName: string
  /** Text direction. */
  dir: 'rtl' | 'ltr'
  /** Default country code for tax-provider selection. */
  defaultCountry: string
}

export const LOCALES: Record<Locale, LocaleMeta> = {
  'ar-EG': {
    code: 'ar-EG',
    intlLocale: 'ar-EG',
    displayName: 'العربية (مصر)',
    dir: 'rtl',
    defaultCountry: 'EG',
  },
  'ar-SA': {
    code: 'ar-SA',
    intlLocale: 'ar-SA',
    displayName: 'العربية (السعودية)',
    dir: 'rtl',
    defaultCountry: 'SA',
  },
  en: {
    code: 'en',
    intlLocale: 'en-US',
    displayName: 'English',
    dir: 'ltr',
    defaultCountry: 'US',
  },
}

export const LOCALE_LIST: Locale[] = ['ar-EG', 'ar-SA', 'en']

export function isLocale(value: string): value is Locale {
  return value in LOCALES
}

export function getDir(locale: string): 'rtl' | 'ltr' {
  return isLocale(locale) ? LOCALES[locale].dir : 'ltr'
}

export function getIntlLocale(locale: string): string {
  return isLocale(locale) ? LOCALES[locale].intlLocale : 'en-US'
}
