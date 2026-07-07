'use client'

/**
 * Dashboard shell — responsive layout.
 *
 * Desktop (md+): fixed sidebar + content side-by-side
 * Mobile (<md): off-canvas drawer with hamburger toggle, full-width content
 */
import { useState, useEffect, useMemo } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BookOpen, FileText, ShieldCheck, LogOut, User as UserIcon, Building2, Receipt, BarChart3, Package, ShoppingCart, Monitor, Menu, X, Factory, Users, UserCheck, CreditCard, Palette, LayoutGrid } from 'lucide-react'
import { LanguageSwitcher } from './language-switcher'
import { AccountsPanel } from './accounts-panel'
import { JournalPanel } from './journal-panel'
import { TestsPanel } from './tests-panel'
import { InvoicesPanel } from './invoices-panel'
import { IncomeStatementPanel } from './income-statement-panel'
import { InventoryPanel } from './inventory-panel'
import { PurchaseOrdersPanel } from './purchase-orders-panel'
import { PosPanel } from './pos-panel'
import { ManufacturingPanel } from './manufacturing-panel'
import { HRPanel } from './hr-panel'
import { CRMPanel } from './crm-panel'
import { BillingPanel } from './billing-panel'
import { BrandingPanel } from './branding-panel'
import { ModulesPanel } from './modules-panel'
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
    // Phase 8 — true when the user's email is in PLATFORM_ADMINS. Gates
    // visibility of the billing super-admin panel.
    isPlatformAdmin?: boolean
  }
  locale: Locale
  onLocaleChange: (l: Locale) => void
  onLogout: () => void
}

type Section = 'accounts' | 'journal' | 'invoices' | 'pos' | 'inventory' | 'purchases' | 'manufacturing' | 'hr' | 'crm' | 'reports' | 'tests' | 'billing' | 'branding' | 'modules'

// Phase 9 — Industry Activation. The set of business module keys that
// appear in INDUSTRY_MODULE_MAP (see src/modules/branding/industry-modules.ts).
// Items with these keys are subject to industry filtering: a 'services'
// tenant doesn't see 'pos'/'inventory'/'purchases'/'manufacturing' in the
// nav. Items NOT in this set ('billing', 'modules') are admin/settings
// screens gated separately (isPlatformAdmin / tenant:manage) and are
// never filtered by industry.
//
// This mirror is intentionally kept in the client file (rather than
// imported from the server-side industry-modules.ts) to avoid pulling
// Prisma-bearing code into the client bundle.
const INDUSTRY_MODULE_KEYS = new Set<string>([
  'pos', 'accounts', 'journal', 'invoices', 'inventory', 'purchases',
  'manufacturing', 'hr', 'crm', 'reports', 'tests', 'branding',
])

// System modules that are ALWAYS visible regardless of business type.
// Per /upload/industry-activation.md File 5: tests, branding, reports.
const SYSTEM_MODULE_KEYS = new Set<string>(['tests', 'branding', 'reports'])

export function Dashboard({ user, locale, onLocaleChange, onLogout }: Props) {
  const { t } = useI18n()
  const [section, setSection] = useState<Section>('pos')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Phase 9 — active modules for the current tenant (industry-filtered nav).
  // null while loading → no filter is applied (graceful fallback shows all
  // items, matching pre-Phase-9 behavior). After fetch, items not in the
  // set are hidden (unless they're system modules or admin/settings items).
  const [activeModules, setActiveModules] = useState<Set<string> | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/tenant/modules', { cache: 'no-store', credentials: 'include' })
        if (!r.ok) return
        const data = await r.json()
        if (cancelled) return
        if (Array.isArray(data.activeModules)) {
          setActiveModules(new Set(data.activeModules as string[]))
        }
      } catch {
        // Network/parse failure: leave activeModules = null → show all items
        // (graceful fallback — the user is never blocked by an industry-
        // filter fetch failure).
      }
    })()
    return () => { cancelled = true }
  }, [])

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
    { key: 'pos',           label: t('nav.pos'),           icon: Monitor,        permitted: user.permissionKeys.includes('pos:sell') },
    { key: 'accounts',      label: t('nav.accounts'),      icon: BookOpen,       permitted: user.permissionKeys.includes('account:read') },
    { key: 'journal',       label: t('nav.journal'),       icon: FileText,       permitted: user.permissionKeys.includes('journal:read') },
    { key: 'invoices',      label: t('nav.invoices'),      icon: Receipt,        permitted: user.permissionKeys.includes('invoice:read') },
    { key: 'inventory',     label: t('nav.inventory'),     icon: Package,        permitted: user.permissionKeys.includes('inventory:read') },
    { key: 'purchases',     label: t('nav.purchases'),     icon: ShoppingCart,   permitted: user.permissionKeys.includes('inventory:read') },
    { key: 'manufacturing', label: t('nav.manufacturing'), icon: Factory,        permitted: user.permissionKeys.includes('manufacturing:read') },
    { key: 'hr',            label: t('nav.hr'),            icon: Users,          permitted: user.permissionKeys.includes('hr:read') },
    { key: 'crm',           label: t('nav.crm'),           icon: UserCheck,      permitted: user.permissionKeys.includes('crm:read') },
    { key: 'reports',       label: t('nav.reports'),       icon: BarChart3,      permitted: user.permissionKeys.includes('journal:read') },
    { key: 'tests',         label: t('nav.tests'),         icon: ShieldCheck,    permitted: true },
    // Phase 8 — billing panel is platform-owner-only (not a normal RBAC
    // permission). Hidden from everyone whose email isn't in PLATFORM_ADMINS.
    { key: 'billing',       label: t('nav.billing'),       icon: CreditCard,     permitted: !!user.isPlatformAdmin },
    // Phase 7/9 — branding is always visible (system module per Phase 9
    // spec). Reading branding is open to all authenticated users; saving
    // requires tenant:manage (enforced server-side).
    { key: 'branding',      label: t('nav.branding'),      icon: Palette,        permitted: true },
    // Phase 9 — modules panel is admin-only. The 'modules' key is NOT in
    // INDUSTRY_MODULE_KEYS, so it bypasses the industry filter and only
    // respects the RBAC `permitted` flag below.
    { key: 'modules',       label: t('nav.modules'),       icon: LayoutGrid,     permitted: user.permissionKeys.includes('tenant:manage') },
  ]

  // Phase 9 — industry filter. Hide items whose module key isn't active
  // for this tenant, EXCEPT:
  //  - System modules (tests/branding/reports) — always visible per spec.
  //  - Items not in INDUSTRY_MODULE_KEYS (billing/modules) — gated by
  //    their own `permitted` flag, not by industry.
  // When `activeModules` is null (still loading or fetch failed), show all
  // items — graceful fallback so the dashboard is never empty.
  const visibleNavItems = useMemo(() => {
    if (activeModules === null) return navItems
    return navItems.filter((item) => {
      if (SYSTEM_MODULE_KEYS.has(item.key)) return true
      if (!INDUSTRY_MODULE_KEYS.has(item.key)) return true
      return activeModules.has(item.key)
    })
  }, [navItems, activeModules])

  // Phase 9 — derive the effective section: if the user's selected section
  // got filtered out (e.g., they were on 'pos' and the tenant is 'services'),
  // fall back to the first visible item. Computing this during render (rather
  // than via an effect with setState) avoids the cascading-render lint and
  // keeps the user's last-clicked section in state — when a previously-hidden
  // module is re-enabled, the user's original selection is preserved.
  const effectiveSection: Section = visibleNavItems.some((i) => i.key === section)
    ? section
    : (visibleNavItems[0]?.key ?? section)

  const sidebarContent = (
    <>
      <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
        {visibleNavItems.map((item) => {
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
                effectiveSection === item.key
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
          {effectiveSection === 'pos' && <PosPanel canSell={user.permissionKeys.includes('pos:sell')} />}
          {effectiveSection === 'accounts' && <AccountsPanel canCreate={user.permissionKeys.includes('account:create')} />}
          {effectiveSection === 'journal' && <JournalPanel canCreate={user.permissionKeys.includes('journal:create')} />}
          {effectiveSection === 'invoices' && (
            <InvoicesPanel
              canCreate={user.permissionKeys.includes('invoice:create')}
              canPost={user.permissionKeys.includes('invoice:post')}
              canVoid={user.permissionKeys.includes('invoice:void')}
            />
          )}
          {effectiveSection === 'inventory' && (
            <InventoryPanel canAdjust={user.permissionKeys.includes('inventory:adjust')} />
          )}
          {effectiveSection === 'purchases' && (
            <PurchaseOrdersPanel
              canCreate={user.permissionKeys.includes('purchase:create')}
              canReceive={user.permissionKeys.includes('purchase:receive')}
            />
          )}
          {effectiveSection === 'manufacturing' && (
            <ManufacturingPanel
              canManage={user.permissionKeys.includes('manufacturing:manage')}
              canRun={user.permissionKeys.includes('production:run')}
            />
          )}
          {effectiveSection === 'hr' && (
            <HRPanel
              canManage={user.permissionKeys.includes('hr:manage')}
              canRun={user.permissionKeys.includes('hr:run')}
            />
          )}
          {effectiveSection === 'crm' && (
            <CRMPanel canManage={user.permissionKeys.includes('crm:manage')} />
          )}
          {effectiveSection === 'reports' && <IncomeStatementPanel />}
          {effectiveSection === 'tests' && <TestsPanel />}
          {effectiveSection === 'billing' && user.isPlatformAdmin && <BillingPanel />}
          {effectiveSection === 'branding' && <BrandingPanel />}
          {effectiveSection === 'modules' && user.permissionKeys.includes('tenant:manage') && <ModulesPanel />}
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
