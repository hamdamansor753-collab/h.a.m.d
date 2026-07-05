'use client'

/**
 * Dashboard shell — sidebar with navigation, header with user info +
 * language switcher + logout, and a main content area that swaps between
 * the Accounts, Journal, and Tests panels.
 */
import { useState } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BookOpen, FileText, ShieldCheck, LogOut, User as UserIcon, Building2, Receipt, BarChart3, Package, ShoppingCart, Monitor, Users, Wallet } from 'lucide-react'
import { LanguageSwitcher } from './language-switcher'
import { AccountsPanel } from './accounts-panel'
import { JournalPanel } from './journal-panel'
import { TestsPanel } from './tests-panel'
import { InvoicesPanel } from './invoices-panel'
import { IncomeStatementPanel } from './income-statement-panel'
import { InventoryPanel } from './inventory-panel'
import { PurchaseOrdersPanel } from './purchase-orders-panel'
import { PosPanel } from './pos-panel'
import { EmployeesPanel } from './employees-panel'
import { PayrollPanel } from './payroll-panel'
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

type Section = 'pos' | 'accounts' | 'journal' | 'invoices' | 'inventory' | 'purchases' | 'hr' | 'payroll' | 'reports' | 'tests'

export function Dashboard({ user, locale, onLocaleChange, onLogout }: Props) {
  const { t } = useI18n()
  const [section, setSection] = useState<Section>('pos')

  const navItems: Array<{ key: Section; label: string; icon: typeof BookOpen; permitted: boolean }> = [
    { key: 'pos',        label: t('nav.pos'),        icon: Monitor,        permitted: user.permissionKeys.includes('pos:sell') },
    { key: 'accounts',   label: t('nav.accounts'),   icon: BookOpen,       permitted: user.permissionKeys.includes('account:read') },
    { key: 'journal',    label: t('nav.journal'),    icon: FileText,       permitted: user.permissionKeys.includes('journal:read') },
    { key: 'invoices',   label: t('nav.invoices'),   icon: Receipt,        permitted: user.permissionKeys.includes('invoice:read') },
    { key: 'inventory',  label: t('nav.inventory'),  icon: Package,        permitted: user.permissionKeys.includes('inventory:read') },
    { key: 'purchases',  label: t('nav.purchases'),  icon: ShoppingCart,   permitted: user.permissionKeys.includes('inventory:read') },
    { key: 'hr',         label: t('nav.hr'),         icon: Users,          permitted: user.permissionKeys.includes('hr:read') },
    { key: 'payroll',    label: t('nav.payroll'),    icon: Wallet,         permitted: user.permissionKeys.includes('hr:read') },
    { key: 'reports',    label: t('nav.reports'),    icon: BarChart3,      permitted: user.permissionKeys.includes('journal:read') },
    { key: 'tests',      label: t('nav.tests'),      icon: ShieldCheck,    permitted: true },
  ]

  return (
    <div className="flex-1 flex flex-col">
      {/* Top header */}
      <header className="border-b border-border bg-surface">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
              H
            </div>
            <span className="font-semibold text-foreground">{t('app.name')}</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher locale={locale} onChange={onLocaleChange} />
            <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded-md bg-muted text-xs">
              <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-foreground font-medium">{user.name}</span>
              <Badge variant="secondary" className="text-[10px]">{user.roleKeys.join(', ')}</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={onLogout} className="gap-2">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t('auth.logout')}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 bg-sidebar text-sidebar-foreground border-e border-sidebar-border">
          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              if (!item.permitted) {
                return (
                  <div
                    key={item.key}
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-sm opacity-40 cursor-not-allowed"
                    title={t('common.forbidden')}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </div>
                )
              }
              return (
                <button
                  key={item.key}
                  onClick={() => setSection(item.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                    section === item.key
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'hover:bg-sidebar-accent/60 text-sidebar-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Tenant info card at the bottom of the sidebar */}
          <div className="mt-auto p-3">
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
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 sm:p-6 overflow-x-hidden">
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
          {section === 'hr' && (
            <EmployeesPanel
              canManage={user.permissionKeys.includes('hr:manage')}
              canReadSalary={user.permissionKeys.includes('hr:salary:read')}
            />
          )}
          {section === 'payroll' && (
            <PayrollPanel canRun={user.permissionKeys.includes('payroll:run')} />
          )}
          {section === 'reports' && <IncomeStatementPanel />}
          {section === 'tests' && <TestsPanel />}
        </main>
      </div>

      <footer className="border-t border-border bg-surface mt-auto">
        <div className="px-4 py-3 text-center text-xs text-muted-foreground">
          H.A.M.D ERP · Phase 4 (HR & Payroll) · {user.tenantId}
        </div>
      </footer>
    </div>
  )
}
