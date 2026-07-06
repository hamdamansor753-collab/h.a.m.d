'use client'

/**
 * Branding panel — logo URL, color pickers, invoice footer, live preview.
 *
 * Per /upload/product-customization.md: visual customization only.
 * Tenant without BrandSettings uses H.A.M.D defaults (navy/cyan).
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, Palette, Save, Building2 } from 'lucide-react'
import { toast } from 'sonner'

interface BrandSettings {
  tenantId: string
  logoUrl: string | null
  primaryColor: string
  accentColor: string
  invoiceFooterText: string | null
  businessType: string
}

const DEFAULT_PRIMARY = '#0f172a'
const DEFAULT_ACCENT = '#06b6d4'

export function BrandingPanel() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<BrandSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form state
  const [logoUrl, setLogoUrl] = useState('')
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY)
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT)
  const [invoiceFooterText, setInvoiceFooterText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/tenant/branding', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      const data = await r.json()
      setSettings(data)
      setLogoUrl(data.logoUrl || '')
      setPrimaryColor(data.primaryColor || DEFAULT_PRIMARY)
      setAccentColor(data.accentColor || DEFAULT_ACCENT)
      setInvoiceFooterText(data.invoiceFooterText || '')
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await fetch('/api/tenant/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          logoUrl: logoUrl || null,
          primaryColor,
          accentColor,
          invoiceFooterText: invoiceFooterText || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('branding.saved'))
      void load()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
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
        <Palette className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('branding.title')}</h1>
          {settings && (
            <p className="text-xs text-muted-foreground">
              {t('branding.businessType')}: {t(`branding.businessType.${settings.businessType}`)}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Settings Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('branding.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              {/* Business Type (read-only) */}
              <div className="space-y-1.5">
                <Label>{t('branding.businessType')}</Label>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {settings ? t(`branding.businessType.${settings.businessType}`) : '—'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    ({t('branding.defaults')})
                  </span>
                </div>
              </div>

              {/* Logo URL */}
              <div className="space-y-1.5">
                <Label htmlFor="logoUrl">{t('branding.logoUrl')}</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  placeholder="https://example.com/logo.png"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </div>

              {/* Color Pickers */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="primaryColor">{t('branding.primaryColor')}</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="primaryColor"
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-9 w-12 rounded border border-border cursor-pointer"
                    />
                    <Input
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="accentColor">{t('branding.accentColor')}</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="accentColor"
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-9 w-12 rounded border border-border cursor-pointer"
                    />
                    <Input
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Invoice Footer */}
              <div className="space-y-1.5">
                <Label htmlFor="footerText">{t('branding.invoiceFooter')}</Label>
                <Input
                  id="footerText"
                  placeholder="شكراً لتعاملكم معنا · هاتف: 01000000000"
                  value={invoiceFooterText}
                  onChange={(e) => setInvoiceFooterText(e.target.value)}
                />
              </div>

              <Button type="submit" disabled={saving} className="w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span className="ms-2">{t('branding.save')}</span>
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Live Invoice Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('branding.preview')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="rounded-lg border-2 overflow-hidden"
              style={{ borderColor: primaryColor }}
            >
              {/* Invoice Header */}
              <div
                className="p-4 flex items-center gap-3"
                style={{ backgroundColor: primaryColor, color: '#ffffff' }}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="h-10 w-10 rounded object-contain bg-white/10" />
                ) : (
                  <div className="h-10 w-10 rounded flex items-center justify-center font-bold text-lg" style={{ backgroundColor: accentColor, color: '#ffffff' }}>
                    H
                  </div>
                )}
                <div>
                  <div className="font-bold text-sm">H.A.M.D ERP</div>
                  <div className="text-xs opacity-80">فاتورة ضريبية</div>
                </div>
              </div>

              {/* Invoice Body */}
              <div className="p-4 space-y-2 bg-background">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">رقم الفاتورة:</span>
                  <span className="font-mono font-medium">INV-0001</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">العميل:</span>
                  <span>عميل تجريبي</span>
                </div>
                <div className="border-t border-border pt-2 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>منتج تجريبي × 2</span>
                    <span className="font-mono">1,000.00</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>ضريبة 14%</span>
                    <span className="font-mono">140.00</span>
                  </div>
                </div>
                <div
                  className="flex justify-between font-bold pt-2 border-t"
                  style={{ borderColor: primaryColor + '40' }}
                >
                  <span>الإجمالي</span>
                  <span className="font-mono" style={{ color: accentColor }}>1,140.00</span>
                </div>
              </div>

              {/* Invoice Footer */}
              {invoiceFooterText && (
                <div
                  className="p-2 text-center text-xs"
                  style={{ backgroundColor: primaryColor + '0a', color: primaryColor }}
                >
                  {invoiceFooterText}
                </div>
              )}
            </div>

            {/* Color Swatches */}
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('branding.primaryColor')}:</span>
              <div className="h-4 w-4 rounded border" style={{ backgroundColor: primaryColor }} />
              <span className="text-xs text-muted-foreground ms-2">{t('branding.accentColor')}:</span>
              <div className="h-4 w-4 rounded border" style={{ backgroundColor: accentColor }} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
