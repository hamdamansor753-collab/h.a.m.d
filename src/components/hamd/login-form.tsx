'use client'

/**
 * Login form. Uses NextAuth's `signIn` client helper with the credentials
 * provider. All visible text comes from the i18n dictionary.
 */
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useI18n } from '@/core/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Loader2, LogIn, AlertCircle } from 'lucide-react'
import { LanguageSwitcher } from './language-switcher'
import type { Locale } from '@/core/i18n/locales'

interface Props {
  locale: Locale
  onLocaleChange: (l: Locale) => void
}

const DEMO_ACCOUNTS = [
  { email: 'admin@afak.test',      roleKey: 'common.role', tenant: 'tenant-afak' },
  { email: 'accountant@afak.test', roleKey: 'common.role', tenant: 'tenant-afak' },
  { email: 'viewer@afak.test',     roleKey: 'common.role', tenant: 'tenant-afak' },
  { email: 'admin@noor.test',      roleKey: 'common.role', tenant: 'tenant-noor' },
]

export function LoginForm({ locale, onLocaleChange }: Props) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })
    setLoading(false)
    if (!res || res.error) {
      setError(t('auth.invalidCreds'))
      return
    }
    // Successful login — reload to re-bootstrap the session.
    window.location.reload()
  }

  async function quickLogin(demoEmail: string) {
    setEmail(demoEmail)
    setPassword('password123')
    setLoading(true)
    setError(null)
    const res = await signIn('credentials', {
      email: demoEmail,
      password: 'password123',
      redirect: false,
    })
    setLoading(false)
    if (!res || res.error) {
      setError(t('auth.invalidCreds'))
      return
    }
    window.location.reload()
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Top bar with language switcher */}
      <header className="border-b border-border bg-surface">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
              H
            </div>
            <span className="font-semibold text-foreground">{t('app.name')}</span>
          </div>
          <LanguageSwitcher locale={locale} onChange={onLocaleChange} />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <Card className="shadow-lg">
            <CardHeader className="space-y-2 text-center">
              <div className="mx-auto h-12 w-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl">
                H
              </div>
              <CardTitle className="text-2xl">{t('auth.login')}</CardTitle>
              <CardDescription>{t('app.tagline')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{t('auth.email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t('auth.password')}</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-sm text-danger bg-danger/10 rounded-md p-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                  <span className="ms-2">{t('auth.signInBtn')}</span>
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('auth.demoAccounts')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => quickLogin(acc.email)}
                  disabled={loading}
                  className="w-full text-start text-sm rounded-md border border-border px-3 py-2 hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <div className="font-medium text-foreground">{acc.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {acc.tenant} · password123
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="border-t border-border bg-surface mt-auto">
        <div className="max-w-5xl mx-auto px-4 py-3 text-center text-xs text-muted-foreground">
          H.A.M.D ERP · Phase 0 (Core)
        </div>
      </footer>
    </div>
  )
}
