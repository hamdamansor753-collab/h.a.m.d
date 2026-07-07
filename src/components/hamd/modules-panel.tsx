'use client'

/**
 * Phase 9 — Modules panel (Industry Activation admin UI).
 *
 * Lets the tenant admin tune which modules appear in the navigation:
 *  - Read-only business-type badge (set at onboarding; not editable here).
 *  - Grid of all toggleable module keys with checkboxes. Defaults are
 *    pre-checked based on the business type. The admin can enable a hidden
 *    module or disable a default one — both create a TenantModuleOverride.
 *  - Save button sends one PATCH /api/tenant/modules per changed module.
 *
 * Per /upload/industry-activation.md:
 *  - These settings control NAV VISIBILITY ONLY. All APIs remain functional
 *    regardless of these settings (the panel surfaces this in the
 *    `modules.modulesNote` line).
 *
 * Patterns mirrored from existing panels (branding-panel, accounts-panel):
 *  - 'use client', useI18n()
 *  - Card / CardContent / CardHeader / CardTitle, Button, Checkbox, Badge,
 *    Loader2
 *  - fetch with cache:'no-store' + credentials:'include'
 *  - toast from sonner
 *  - all visible text via t('key')
 *
 * Tenant isolation note: the PATCH endpoint derives `tenantId` from the JWT,
 * NOT from the request body. The admin of tenant A can therefore never
 * write to tenant B's overrides — even if they crafted a custom fetch.
 * This is enforced server-side; the panel never sends `tenantId`.
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, LayoutGrid, Save } from 'lucide-react'
import { toast } from 'sonner'

// ---------- Types ----------

interface ModuleOverride {
  moduleKey: string
  enabled: boolean
}

interface ModulesResponse {
  businessType: string
  defaultModules: string[]
  activeModules: string[]
  overrides: ModuleOverride[]
}

// Must stay in sync with ALL_MODULE_KEYS in
// src/modules/branding/industry-modules.ts.
const ALL_MODULE_KEYS = [
  'pos', 'accounts', 'journal', 'invoices', 'inventory', 'purchases',
  'manufacturing', 'hr', 'crm', 'reports', 'tests', 'branding',
] as const

// ---------- Main Panel ----------

export function ModulesPanel() {
  const { t } = useI18n()

  // Server state
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [businessType, setBusinessType] = useState<string>('general')
  const [defaultModules, setDefaultModules] = useState<string[]>([])

  // Local editable state — initialized from `activeModules` on load,
  // committed to the server on Save.
  const [active, setActive] = useState<Set<string>>(new Set())

  // Snapshot of the last-committed state — used to compute the diff
  // (only changed modules are PATCHed on Save).
  const [committed, setCommitted] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/tenant/modules', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      const data: ModulesResponse = await r.json()
      setBusinessType(data.businessType)
      setDefaultModules(data.defaultModules)
      const next = new Set(data.activeModules)
      setActive(next)
      setCommitted(next)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  function toggleModule(key: string) {
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Compute the set of modules whose state differs between the local
  // `active` set and the last-committed snapshot. We send one PATCH per
  // changed module — the API upserts into TenantModuleOverride.
  function diffChanges(): Array<{ moduleKey: string; enabled: boolean }> {
    const changes: Array<{ moduleKey: string; enabled: boolean }> = []
    for (const key of ALL_MODULE_KEYS) {
      const wasActive = committed.has(key)
      const isActive = active.has(key)
      if (wasActive !== isActive) {
        changes.push({ moduleKey: key, enabled: isActive })
      }
    }
    return changes
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const changes = diffChanges()
    if (changes.length === 0) {
      toast.info(t('modules.saved'))
      return
    }
    setSaving(true)
    try {
      // Fire all PATCHes in parallel — each one upserts a single
      // TenantModuleOverride row. Failures short-circuit with a toast;
      // the user can retry and the next Save re-sends only the still-
      // uncommitted changes (the snapshot only updates on full success).
      const results = await Promise.all(
        changes.map((c) =>
          fetch('/api/tenant/modules', {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(c),
          }).then((r) => ({ ok: r.ok, status: r.status, change: c }))
        )
      )
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        // 403 → RBAC (not an admin). 402 → subscription suspended.
        // Other → generic. Surface the first failure's status.
        const first = failed[0]
        if (first.status === 403) {
          toast.error(t('common.forbidden'))
        } else if (first.status === 402) {
          toast.error(t('billing.subscriptionSuspended'))
        } else {
          toast.error(t('common.error'))
        }
        return
      }
      // Commit the local state as the new snapshot.
      setCommitted(new Set(active))
      toast.success(t('modules.saved'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const changes = diffChanges()
  const hasChanges = changes.length > 0

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <LayoutGrid className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('modules.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('modules.description')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-accent" />
            <span>{t('modules.title')}</span>
          </CardTitle>
          <CardDescription>
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground">{t('modules.businessType')}:</span>
              <Badge variant="outline" className="text-[10px]">
                {t(`branding.${businessType}`)}
              </Badge>
              <Badge variant="secondary" className="text-[10px] font-mono">
                {businessType}
              </Badge>
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            {/* Active count line */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t('modules.activeModules')}: <span className="font-medium text-foreground">{active.size}</span> / {ALL_MODULE_KEYS.length}
              </span>
              {hasChanges && (
                <Badge variant="secondary" className="text-[10px]">
                  {changes.length}
                </Badge>
              )}
            </div>

            {/* Module grid — 1 col on mobile, 2 on sm, 3 on lg */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {ALL_MODULE_KEYS.map((key) => {
                const isOn = active.has(key)
                const isDefault = defaultModules.includes(key)
                return (
                  <label
                    key={key}
                    htmlFor={`mod-${key}`}
                    className="flex items-start gap-2.5 p-3 rounded-md border border-border hover:bg-muted/40 transition-colors cursor-pointer min-h-[60px]"
                  >
                    <Checkbox
                      id={`mod-${key}`}
                      checked={isOn}
                      onCheckedChange={() => toggleModule(key)}
                      className="mt-0.5"
                      aria-label={isOn ? t('modules.disable') : t('modules.enable')}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium">
                          {t(`nav.${key}`)}
                        </span>
                        {isDefault && (
                          <Badge variant="outline" className="text-[9px] py-0 px-1">
                            {t('modules.default')}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {key}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>

            {/* Explanation note */}
            <p className="text-[11px] text-muted-foreground leading-relaxed bg-muted/40 p-3 rounded-md border border-border">
              {t('modules.modulesNote')}
            </p>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  // Reset local state to the last-committed snapshot.
                  setActive(new Set(committed))
                }}
                disabled={!hasChanges || saving}
                className="gap-1.5"
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving || !hasChanges} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span>{t('modules.save')}</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
