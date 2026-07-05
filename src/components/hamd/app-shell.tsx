'use client'

/**
 * AppShell — the single entry point of the SPA.
 *
 * Responsibilities:
 *  1. On mount, call /api/session to determine auth state.
 *  2. If unauthenticated: load the default (ar-EG) dictionary and render
 *     the LoginForm.
 *  3. If authenticated: wrap the dashboard in <I18nProvider> using the
 *     user's locale + dictionary from the session.
 *  4. Expose `changeLocale` for the language switcher — fetches the new
 *     dictionary client-side and updates the provider. (The JWT-embedded
 *     locale is unchanged; this is a Phase 0 client-side override. See
 *     ASSUMPTIONS in the worklog.)
 */
import { useEffect, useState, useCallback } from 'react'
import { I18nProvider } from '@/core/i18n/client'
import { LOCALES, type Locale } from '@/core/i18n/locales'
import { LoginForm } from './login-form'
import { Dashboard } from './dashboard'
import { LoadingScreen } from './loading-screen'

interface SessionUser {
  id: string
  tenantId: string
  email: string
  name: string
  locale: string
  roleKeys: string[]
  permissionKeys: string[]
}

type State = 'loading' | 'unauth' | 'auth'

export function AppShell() {
  const [state, setState] = useState<State>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [locale, setLocale] = useState<Locale>('ar-EG')
  const [dictionary, setDictionary] = useState<Record<string, string>>({})

  // Initial bootstrap
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/session', { cache: 'no-store', credentials: 'include' })
        const data = await r.json()
        if (cancelled) return
        if (data.authenticated) {
          setUser(data.user)
          setLocale(data.user.locale as Locale)
          setDictionary(data.dictionary)
          setState('auth')
        } else {
          // Pre-load Arabic dictionary for the login screen
          const dr = await fetch('/api/i18n/dictionary?locale=ar-EG', { cache: 'no-store', credentials: 'include' })
          const dd = await dr.json()
          if (cancelled) return
          setDictionary(dd.dictionary)
          setState('unauth')
        }
      } catch {
        if (!cancelled) setState('unauth')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const changeLocale = useCallback(async (newLocale: Locale) => {
    setLocale(newLocale)
    try {
      const r = await fetch(`/api/i18n/dictionary?locale=${newLocale}`, { cache: 'no-store', credentials: 'include' })
      const d = await r.json()
      setDictionary(d.dictionary)
    } catch {
      // keep the existing dictionary; the locale switch is best-effort
    }
  }, [])

  const handleLogout = useCallback(async () => {
    // Use next-auth/react's signOut for proper CSRF handling + cookie clearing.
    const { signOut } = await import('next-auth/react')
    await signOut({ redirect: false })
    setUser(null)
    setState('unauth')
    // Reload Arabic dictionary for login screen
    const dr = await fetch('/api/i18n/dictionary?locale=ar-EG', { cache: 'no-store', credentials: 'include' })
    const dd = await dr.json()
    setLocale('ar-EG')
    setDictionary(dd.dictionary)
  }, [])

  const dir = LOCALES[locale]?.dir ?? 'rtl'

  // Keep <html> dir/lang in sync with the active locale (the server-rendered
  // layout defaults to ar/rtl; this updates it client-side on locale change).
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
      document.documentElement.dir = dir
    }
  }, [locale, dir])

  if (state === 'loading') return <LoadingScreen />

  return (
    <I18nProvider locale={locale} dir={dir} dictionary={dictionary}>
      <div dir={dir} className="min-h-screen flex flex-col">
        {state === 'unauth' || !user ? (
          <LoginForm locale={locale} onLocaleChange={changeLocale} />
        ) : (
          <Dashboard
            user={user}
            locale={locale}
            onLocaleChange={changeLocale}
            onLogout={handleLogout}
          />
        )}
      </div>
    </I18nProvider>
  )
}
