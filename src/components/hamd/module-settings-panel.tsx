'use client'

/**
 * Module Settings panel — enable/disable industry modules per tenant.
 *
 * Per /upload/industry-activation.md: admin can override the default
 * module visibility for their tenant. This is VISUAL ONLY — the API
 * routes remain fully functional regardless.
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Loader2, Boxes, Save } from 'lucide-react'
import { toast } from 'sonner'

interface ModuleStatus {
  moduleKey: string
  enabled: boolean
  isDefault: boolean
  isOverridden: boolean
}

const MODULE_LABELS: Record<string, { ar: string; en: string }> = {
  accounting: { ar: 'المحاسبة والفواتير', en: 'Accounting & Invoicing' },
  inventory: { ar: 'المخزون والمشتريات', en: 'Inventory & Purchasing' },
  pos: { ar: 'نقطة البيع', en: 'Point of Sale' },
  crm: { ar: 'العملاء والمواعيد', en: 'Customers & Appointments' },
  hr: { ar: 'الموارد البشرية والرواتب', en: 'HR & Payroll' },
}

export function ModuleSettingsPanel() {
  const { t, locale } = useI18n()
  const [modules, setModules] = useState<ModuleStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/tenant/modules', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      setModules(await r.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  async function toggleModule(moduleKey: string, enabled: boolean) {
    setSaving(moduleKey)
    // Optimistic update
    setModules(prev => prev.map(m => m.moduleKey === moduleKey ? { ...m, enabled, isOverridden: true } : m))
    try {
      const r = await fetch('/api/tenant/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ moduleKey, enabled }),
      })
      if (!r.ok) {
        // Revert on failure
        setModules(prev => prev.map(m => m.moduleKey === moduleKey ? { ...m, enabled: !enabled } : m))
        const d = await r.json().catch(() => null)
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('branding.saved'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(null)
    }
  }

  function resetModule(moduleKey: string) {
    // To reset an override, we set it back to the default value
    const mod = modules.find(m => m.moduleKey === moduleKey)
    if (!mod) return
    toggleModule(moduleKey, mod.isDefault)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Boxes className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('nav.branding')}</h1>
          <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'إدارة الموديولات' : 'Module Management'}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{locale === 'ar' ? 'الموديولات النشطة' : 'Active Modules'}</CardTitle>
          <CardDescription>
            {locale === 'ar'
              ? 'تحكم في إظهار/إخفاء الموديولات في القائمة الجانبية. التغييرات بصريّة فقط — جميع الـ APIs تظل تعمل.'
              : 'Control which modules appear in the sidebar. Changes are visual only — all APIs remain functional.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {modules.map((mod) => {
            const label = MODULE_LABELS[mod.moduleKey]
            return (
              <div key={mod.moduleKey} className="flex items-center justify-between gap-3 p-3 rounded-md border border-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {label ? (locale === 'ar' ? label.ar : label.en) : mod.moduleKey}
                    </span>
                    {mod.isOverridden && (
                      <Badge variant="outline" className="text-[10px] text-accent border-accent/30">
                        {locale === 'ar' ? 'مخصص' : 'Custom'}
                      </Badge>
                    )}
                    {!mod.isOverridden && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {locale === 'ar' ? 'افتراضي' : 'Default'}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {mod.moduleKey}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {mod.isOverridden && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => resetModule(mod.moduleKey)}
                      disabled={saving === mod.moduleKey}
                    >
                      {locale === 'ar' ? 'إعادة افتراضي' : 'Reset'}
                    </Button>
                  )}
                  <Switch
                    checked={mod.enabled}
                    onCheckedChange={(checked) => toggleModule(mod.moduleKey, checked)}
                    disabled={saving === mod.moduleKey}
                  />
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
