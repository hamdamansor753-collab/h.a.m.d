'use client'

/**
 * Dashboard shell — responsive layout.
 *
 * Desktop (md+): fixed sidebar + content side-by-side
 * Mobile (<md): off-canvas drawer with hamburger toggle, full-width content
 */
import { useState, useEffect } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BookOpen, FileText, ShieldCheck, LogOut, User as UserIcon, Building2, Receipt, BarChart3, Package, ShoppingCart, Monitor, Menu, X } from 'lucide-react'
import { LanguageSwitcher } from './language-switcher'
import { AccountsPanel } from './accounts-panel'
import { JournalPanel } from './journal-panel'
import { TestsPanel } from './tests-panel'
import { InvoicesPanel } from './invoices-panel'
import { IncomeStatementPanel } from './income-statement-panel'
import { InventoryPanel } from './inventory-panel'
import { PurchaseOrdersPanel } from './purchase-orders-panel'
import { PosPanel } from './pos-panel'
import type { Locale } from '@/core/i18n/locales'

interface Props {
  user: {
    id: string
    tenantId: string
    email: string
    name: string
    locale: string
    roleKeys: string[]
    permissionKeys: string[]
  }
  locale: Locale
  onLocaleChange: (l: Locale) => void
  onLogout: () => void
}

type Section = 'accounts' | 'journal' | 'invoices' | 'pos' | 'inventory' | 'purchases' | 'reports' | 'tests'

export function Dashboard({ user, locale, onLocaleChange, onLogout }: Props) {
  const { t } = useI18n()
  const [section, setSection] = useState<Section>('pos')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Close mobile nav when section changes
  const handleSectionChange = (s: Section) => {
    setSection(s)
    setMobileNavOpen(false)
  }

  // Close mobile nav on resize to desktop
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth >= 768) setMobileNavOpen(false)
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const navItems: Array<{ key: Section; label: string; icon: typeof BookOpen; permitted: boolean }> = [
    { key: 'pos',        label: t('nav.pos'),        icon: Monitor,        permitted: user.permissionKeys.includes('pos:sell') },
    { key: 'accounts',   label: t('nav.accounts'),   icon: BookOpen,       permitted: user.permissionKeys.includes('account:read') },
    { key: 'journal',    label: t('nav.journal'),    icon: FileText,       permitted: user.permissionKeys.includes('journal:read') },
    { key: 'invoices',   label: t('nav.invoices'),   icon: Receipt,        permitted: user.permissionKeys.includes('invoice:read') },
    { key: 'inventory',  label: t('nav.inventory'),  icon: Package,        permitted: user.permissionKeys.includes('inventory:read') },
    { key: 'purchases',  label: t('nav.purchases'),  icon: ShoppingCart,   permitted: user.permissionKeys.includes('inventory:read') },
    { key: 'reports',    label: t('nav.reports'),    icon: BarChart3,      permitted: user.permissionKeys.includes('journal:read') },
    { key: 'tests',      label: t('nav.tests'),      icon: ShieldCheck,    permitted: true },
  ]

  const sidebarContent = (
    <>
      <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          if (!item.permitted) {
            return (
              <div
                key={item.key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm opacity-40 cursor-not-allowed min-h-[44px]"
                title={t('common.forbidden')}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </div>
            )
          }
          return (
            <button
              key={item.key}
              onClick={() => handleSectionChange(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors min-h-[44px] ${
                section === item.key
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'hover:bg-sidebar-accent/60 text-sidebar-foreground'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <Card className="bg-sidebar-accent/40 border-sidebar-border text-sidebar-foreground">
          <CardContent className="p-3 space-y-1">
            <div className="flex items-center gap-2 text-xs text-sidebar-foreground/70">
              <Building2 className="h-3.5 w-3.5" />
              <span>{t('common.tenant')}</span>
            </div>
            <div className="text-xs font-mono truncate">{user.tenantId}</div>
          </CardContent>
        </Card>
      </div>
    </>
  )

  return (
    <div className="flex-1 flex flex-col">
      {/* Top header */}
      <header className="border-b border-border bg-surface z-30 shrink-0">
        <div className="px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
          {/* Left: hamburger (mobile) + logo */}
          <div className="flex items-center gap-2">
            {/* Hamburger — mobile only */}
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden h-9 w-9 p-0"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
              H
            </div>
            <span className="font-semibold text-foreground text-sm hidden sm:inline">{t('app.name')}</span>
          </div>
          {/* Right: actions */}
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher locale={locale} onChange={onLocaleChange} />
            <div className="hidden lg:flex items-center gap-2 px-2 py-1 rounded-md bg-muted text-xs">
              <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-foreground font-medium">{user.name}</span>
              <Badge variant="secondary" className="text-[10px]">{user.roleKeys.join(', ')}</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={onLogout} className="gap-1.5 h-9">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t('auth.logout')}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop sidebar — fixed, hidden on mobile */}
        <aside className="hidden md:flex w-56 shrink-0 bg-sidebar text-sidebar-foreground border-e border-sidebar-border flex-col">
          {sidebarContent}
        </aside>

        {/* Mobile sidebar — off-canvas overlay */}
        {mobileNavOpen && (
          <>
            {/* Backdrop */}
            <div
              className="md:hidden fixed inset-0 bg-black/50 z-40"
              onClick={() => setMobileNavOpen(false)}
            />
            {/* Drawer — positioned at the inline-start edge (right in RTL, left in LTR) */}
            <aside className="md:hidden fixed inset-y-0 start-0 end-auto w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground border-e border-sidebar-border z-50 flex flex-col shadow-xl">
              {/* Drawer header */}
              <div className="flex items-center justify-between p-3 border-b border-sidebar-border">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold text-xs">
                    H
                  </div>
                  <span className="font-semibold text-sm">{t('app.name')}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 text-sidebar-foreground"
                  onClick={() => setMobileNavOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              {sidebarContent}
            </aside>
          </>
        )}

        {/* Main content — full width on mobile */}
        <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-x-hidden overflow-y-auto">
          {section === 'pos' && <PosPanel canSell={user.permissionKeys.includes('pos:sell')} />}
          {section === 'accounts' && <AccountsPanel canCreate={user.permissionKeys.includes('account:create')} />}
          {section === 'journal' && <JournalPanel canCreate={user.permissionKeys.includes('journal:create')} />}
          {section === 'invoices' && (
            <InvoicesPanel
              canCreate={user.permissionKeys.includes('invoice:create')}
              canPost={user.permissionKeys.includes('invoice:post')}
              canVoid={user.permissionKeys.includes('invoice:void')}
            />
          )}
          {section === 'inventory' && (
            <InventoryPanel canAdjust={user.permissionKeys.includes('inventory:adjust')} />
          )}
          {section === 'purchases' && (
            <PurchaseOrdersPanel
              canCreate={user.permissionKeys.includes('purchase:create')}
              canReceive={user.permissionKeys.includes('purchase:receive')}
            />
          )}
          {section === 'reports' && <IncomeStatementPanel />}
          {section === 'tests' && <TestsPanel />}
        </main>
      </div>

      <footer className="border-t border-border bg-surface mt-auto shrink-0">
        <div className="px-4 py-2 text-center text-[10px] text-muted-foreground">
          H.A.M.D ERP · {user.tenantId}
        </div>
      </footer>
    </div>
  )
}
