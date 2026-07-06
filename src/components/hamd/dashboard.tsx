'use client'

/**
 * Dashboard shell — sidebar with navigation, header with user info +
 * language switcher + reminders bell + logout, and a main content area.
 *
 * Design (per 01-brand-identity.md):
 *  - Sidebar: navy gradient top, grouped nav sections, cyan active indicator
 *  - Active item: cyan accent background + border-inline-start
 *  - Inactive items: lighter text, hover reveals accent
 *  - Logo: "H" badge with gradient
 *  - Grouped nav: Operations (POS, Accounts, Journal, Invoices),
 *    Commerce (Inventory, Purchases, CRM, Appointments),
 *    People (HR, Payroll), System (Reports, Branding, Tests)
 */
import { useState } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { BookOpen, FileText, ShieldCheck, LogOut, User as UserIcon, Building2, Receipt, BarChart3, Package, ShoppingCart, Monitor, Users, Wallet, CalendarClock, Palette } from 'lucide-react'
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
import { CustomersPanel } from './customers-panel'
import { AppointmentsPanel } from './appointments-panel'
import { RemindersBell } from './reminders-bell'
import { BrandingPanel } from './branding-panel'
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

type Section = 'pos' | 'accounts' | 'journal' | 'invoices' | 'inventory' | 'purchases' | 'hr' | 'payroll' | 'crm' | 'appointments' | 'reports' | 'branding' | 'tests'

interface NavItem {
  key: Section
  label: string
  icon: typeof BookOpen
  permitted: boolean
}
interface NavGroup {
  label?: string
  items: NavItem[]
}

export function Dashboard({ user, locale, onLocaleChange, onLogout }: Props) {
  const { t } = useI18n()
  const [section, setSection] = useState<Section>('pos')

  const navGroups: NavGroup[] = [
    {
      items: [
        { key: 'pos',          label: t('nav.pos'),          icon: Monitor,        permitted: user.permissionKeys.includes('pos:sell') },
      ],
    },
    {
      label: t('nav.accounts'),
      items: [
        { key: 'accounts',     label: t('nav.accounts'),     icon: BookOpen,       permitted: user.permissionKeys.includes('account:read') },
        { key: 'journal',      label: t('nav.journal'),      icon: FileText,       permitted: user.permissionKeys.includes('journal:read') },
        { key: 'invoices',     label: t('nav.invoices'),     icon: Receipt,        permitted: user.permissionKeys.includes('invoice:read') },
      ],
    },
    {
      label: t('nav.inventory'),
      items: [
        { key: 'inventory',    label: t('nav.inventory'),    icon: Package,        permitted: user.permissionKeys.includes('inventory:read') },
        { key: 'purchases',    label: t('nav.purchases'),    icon: ShoppingCart,   permitted: user.permissionKeys.includes('inventory:read') },
        { key: 'crm',          label: t('nav.crm'),          icon: Users,          permitted: user.permissionKeys.includes('crm:read') },
        { key: 'appointments', label: t('nav.appointments'), icon: CalendarClock,  permitted: user.permissionKeys.includes('crm:read') },
      ],
    },
    {
      label: t('nav.hr'),
      items: [
        { key: 'hr',           label: t('nav.hr'),           icon: Users,          permitted: user.permissionKeys.includes('hr:read') },
        { key: 'payroll',      label: t('nav.payroll'),      icon: Wallet,         permitted: user.permissionKeys.includes('hr:read') },
      ],
    },
    {
      label: t('nav.branding'),
      items: [
        { key: 'reports',      label: t('nav.reports'),      icon: BarChart3,      permitted: user.permissionKeys.includes('journal:read') },
        { key: 'branding',     label: t('nav.branding'),     icon: Palette,        permitted: user.permissionKeys.includes('tenant:manage') },
        { key: 'tests',        label: t('nav.tests'),        icon: ShieldCheck,    permitted: true },
      ],
    },
  ]

  return (
    <div className="flex-1 flex flex-col">
      {/* Top header */}
      <header className="border-b border-border bg-surface z-30">
        <div className="px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground font-bold text-sm shadow-sm">
              H
            </div>
            <span className="font-semibold text-foreground text-sm">{t('app.name')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {user.permissionKeys.includes('crm:read') && <RemindersBell />}
            <LanguageSwitcher locale={locale} onChange={onLocaleChange} />
            <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded-md bg-muted text-xs">
              <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-foreground font-medium">{user.name}</span>
              <Badge variant="secondary" className="text-[10px]">{user.roleKeys.join(', ')}</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={onLogout} className="gap-1.5">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t('auth.logout')}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 bg-sidebar text-sidebar-foreground border-e border-sidebar-border flex flex-col overflow-y-auto hamd-scroll">
          {/* Gradient top section with logo */}
          <div className="bg-gradient-to-b from-primary/20 to-transparent px-3 py-3 border-b border-sidebar-border/50">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground font-bold text-xs">
                H
              </div>
              <span className="text-sm font-semibold text-sidebar-foreground">{t('app.name')}</span>
            </div>
          </div>

          {/* Nav groups */}
          <nav className="flex-1 px-2 py-2 space-y-3">
            {navGroups.map((group, gi) => (
              <div key={gi} className="space-y-0.5">
                {group.label && (
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
                    {group.label}
                  </div>
                )}
                {group.items.map((item) => {
                  const Icon = item.icon
                  if (!item.permitted) {
                    return (
                      <div
                        key={item.key}
                        className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs opacity-30 cursor-not-allowed"
                        title={t('common.forbidden')}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{item.label}</span>
                      </div>
                    )
                  }
                  const isActive = section === item.key
                  return (
                    <button
                      key={item.key}
                      onClick={() => setSection(item.key)}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs transition-all duration-150 relative ${
                        isActive
                          ? 'bg-accent/15 text-accent font-medium'
                          : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/40'
                      }`}
                      style={isActive ? { borderInlineStart: '2px solid var(--accent)', paddingInlineStart: '10px' } : { borderInlineStart: '2px solid transparent' }}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={isActive ? 2.25 : 1.75} />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>

          {/* Tenant info at bottom */}
          <div className="p-2 border-t border-sidebar-border/50">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-sidebar-accent/20">
              <Building2 className="h-3 w-3 text-sidebar-foreground/50 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-sidebar-foreground/40">{t('common.tenant')}</div>
                <div className="text-[10px] font-mono truncate text-sidebar-foreground/70">{user.tenantId}</div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 sm:p-6 overflow-x-hidden overflow-y-auto hamd-scroll">
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
          {section === 'crm' && (
            <CustomersPanel canManage={user.permissionKeys.includes('crm:manage')} />
          )}
          {section === 'appointments' && (
            <AppointmentsPanel canManage={user.permissionKeys.includes('crm:manage')} />
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
          {section === 'branding' && <BrandingPanel />}
          {section === 'tests' && <TestsPanel />}
        </main>
      </div>

      <footer className="border-t border-border bg-surface mt-auto">
        <div className="px-4 py-2 text-center text-[10px] text-muted-foreground">
          H.A.M.D ERP · {user.tenantId}
        </div>
      </footer>
    </div>
  )
}
