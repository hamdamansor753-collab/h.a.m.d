'use client'

/**
 * Phase 7 — Branding panel.
 *
 * UI for editing the current tenant's BrandSettings (logo URL, primary color,
 * accent color, invoice footer text). Shows a LIVE PREVIEW card with the
 * chosen colors + footer text so the admin can see how invoices will look.
 *
 * Patterns mirrored from existing panels (accounts-panel, invoices-panel):
 *  - 'use client', useI18n()
 *  - Card / CardContent / CardHeader / CardTitle, Button, Input, Label,
 *    Textarea, Badge, Loader2
 *  - fetch with cache:'no-store' + credentials:'include'
 *  - toast from sonner
 *  - all visible text via t('key')
 *
 * Tenant isolation note (per /upload/product-customization.md):
 *  - The PATCH endpoint derives `tenantId` from the JWT, NOT from the request
 *    body. The admin of tenant A can therefore never write to tenant B's
 *    BrandSettings — even if they crafted a custom fetch. This is enforced
 *    server-side; the panel never sends `tenantId`.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Loader2, Palette, Save, Image as ImageIcon, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_ACCENT_COLOR,
} from '@/modules/branding/constants'

// ---------- Types ----------

interface BrandingView {
  tenantId: string
  logoUrl: string | null
  primaryColor: string
  accentColor: string
  invoiceFooterText: string | null
  updatedAt: string
}

interface BrandingResponse {
  branding: BrandingView | null
  businessType: string
}

const BUSINESS_TYPES = [
  'general',
  'retail',
  'restaurant',
  'clinic',
  'services',
  'manufacturing',
] as const

// ---------- Main Panel ----------

export function BrandingPanel() {
  const { t } = useI18n()

  // Server state
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [businessType, setBusinessType] = useState<string>('general')

  // Form state — initialized from server, edited locally, committed on Save.
  const [logoUrl, setLogoUrl] = useState<string>('')
  const [primaryColor, setPrimaryColor] = useState<string>(DEFAULT_PRIMARY_COLOR)
  const [accentColor, setAccentColor] = useState<string>(DEFAULT_ACCENT_COLOR)
  const [invoiceFooterText, setInvoiceFooterText] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/tenant/branding', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      const data: BrandingResponse = await r.json()
      setBusinessType(data.businessType)
      const b = data.branding
      setLogoUrl(b?.logoUrl ?? '')
      setPrimaryColor(b?.primaryColor ?? DEFAULT_PRIMARY_COLOR)
      setAccentColor(b?.accentColor ?? DEFAULT_ACCENT_COLOR)
      setInvoiceFooterText(b?.invoiceFooterText ?? '')
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await fetch('/api/tenant/branding', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logoUrl: logoUrl.trim() === '' ? null : logoUrl.trim(),
          primaryColor,
          accentColor,
          invoiceFooterText: invoiceFooterText.trim() === '' ? null : invoiceFooterText.trim(),
        }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        toast.error(data?.error?.message ?? t('common.error'))
        return
      }
      // Sync local form state with the committed server state.
      const b: BrandingView | null = data?.branding ?? null
      if (b) {
        setLogoUrl(b.logoUrl ?? '')
        setPrimaryColor(b.primaryColor)
        setAccentColor(b.accentColor)
        setInvoiceFooterText(b.invoiceFooterText ?? '')
      }
      toast.success(t('branding.saved'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  function handleResetDefaults() {
    setLogoUrl('')
    setPrimaryColor(DEFAULT_PRIMARY_COLOR)
    setAccentColor(DEFAULT_ACCENT_COLOR)
    setInvoiceFooterText('')
  }

  // Memoized live-preview style — recomputed only when colors change.
  const previewStyle = useMemo(
    () => ({
      '--preview-primary': primaryColor,
      '--preview-accent': accentColor,
    }) as React.CSSProperties,
    [primaryColor, accentColor]
  )

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
        <Palette className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('branding.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('branding.title')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ---------------- Edit form ---------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4 text-accent" />
              <span>{t('branding.title')}</span>
            </CardTitle>
            <CardDescription>{t('branding.businessType')}: {t(`branding.${businessType}`)}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              {/* Business type (read-only — set at onboarding) */}
              <div className="space-y-1.5">
                <Label htmlFor="businessType">{t('branding.businessType')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="businessType"
                    value={t(`branding.${businessType}`)}
                    readOnly
                    disabled
                    className="bg-muted/40"
                  />
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {BUSINESS_TYPES.includes(businessType as (typeof BUSINESS_TYPES)[number])
                      ? businessType
                      : 'general'}
                  </Badge>
                </div>
              </div>

              {/* Logo URL */}
              <div className="space-y-1.5">
                <Label htmlFor="logoUrl" className="flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>{t('branding.logoUrl')}</span>
                </Label>
                <Input
                  id="logoUrl"
                  type="url"
                  inputMode="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                />
                <p className="text-[11px] text-muted-foreground">
                  {t('branding.logoUrl')} · URL
                </p>
              </div>

              {/* Primary color */}
              <div className="space-y-1.5">
                <Label htmlFor="primaryColor">{t('branding.primaryColor')}</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="primaryColor"
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-12 rounded border border-input bg-transparent p-0.5 cursor-pointer"
                    aria-label={t('branding.primaryColor')}
                  />
                  <Input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="font-mono w-32"
                    maxLength={7}
                  />
                  <span
                    className="inline-block h-9 w-9 rounded border border-input"
                    style={{ backgroundColor: primaryColor }}
                  />
                </div>
              </div>

              {/* Accent color */}
              <div className="space-y-1.5">
                <Label htmlFor="accentColor">{t('branding.accentColor')}</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="accentColor"
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-9 w-12 rounded border border-input bg-transparent p-0.5 cursor-pointer"
                    aria-label={t('branding.accentColor')}
                  />
                  <Input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="font-mono w-32"
                    maxLength={7}
                  />
                  <span
                    className="inline-block h-9 w-9 rounded border border-input"
                    style={{ backgroundColor: accentColor }}
                  />
                </div>
              </div>

              {/* Invoice footer text */}
              <div className="space-y-1.5">
                <Label htmlFor="invoiceFooterText">{t('branding.invoiceFooterText')}</Label>
                <Textarea
                  id="invoiceFooterText"
                  value={invoiceFooterText}
                  onChange={(e) => setInvoiceFooterText(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="شكراً لتعاملكم معنا · هاتف: ..."
                />
                <p className="text-[11px] text-muted-foreground">
                  {invoiceFooterText.length}/1000
                </p>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={handleResetDefaults} className="gap-1.5">
                  <RotateCcw className="h-4 w-4" />
                  <span>{t('common.cancel')}</span>
                </Button>
                <Button type="submit" disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span>{t('branding.save')}</span>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* ---------------- Live preview ---------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('branding.preview')}</CardTitle>
            <CardDescription>{t('branding.preview')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              style={previewStyle}
              className="rounded-lg border border-border overflow-hidden shadow-sm"
            >
              {/* Header band — uses the tenant's primary color */}
              <div
                className="px-4 py-3 flex items-center justify-between"
                style={{ backgroundColor: primaryColor, color: '#ffffff' }}
              >
                <div className="flex items-center gap-2">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="logo"
                      className="h-7 w-7 rounded object-cover bg-white/20"
                      onError={(e) => {
                        // Hide broken logo images so the preview never looks broken.
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <div
                      className="h-7 w-7 rounded flex items-center justify-center font-bold text-sm"
                      style={{ backgroundColor: accentColor, color: '#ffffff' }}
                    >
                      H
                    </div>
                  )}
                  <span className="font-semibold text-sm">{t('app.name')}</span>
                </div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: accentColor, color: '#ffffff' }}
                >
                  {t('invoice.title')}
                </span>
              </div>

              {/* Body — mock invoice content */}
              <div className="bg-card text-card-foreground p-4 space-y-3 text-xs">
                <div className="flex justify-between border-b border-dashed border-border pb-2">
                  <span className="text-muted-foreground">{t('invoice.customer')}</span>
                  <span className="font-medium">—</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('invoice.lines')}</span>
                    <span>—</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('invoice.total')}</span>
                    <span className="font-mono font-medium" style={{ color: primaryColor }}>0.00</span>
                  </div>
                </div>
                {/* Footer — uses the tenant's invoice footer text */}
                <div
                  className="pt-2 mt-2 border-t border-dashed border-border text-[10px] text-muted-foreground whitespace-pre-wrap min-h-[2.5em]"
                >
                  {invoiceFooterText && invoiceFooterText.trim().length > 0
                    ? invoiceFooterText
                    : <span className="opacity-50">{t('branding.invoiceFooterText')}</span>}
                </div>
              </div>

              {/* Color swatches legend */}
              <div className="px-4 py-2 bg-muted/40 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: primaryColor }} />
                  {t('branding.primaryColor')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: accentColor }} />
                  {t('branding.accentColor')}
                </span>
              </div>
            </div>

            {/* Defaults hint */}
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              {t('branding.businessType')}: <span className="font-medium">{t(`branding.${businessType}`)}</span>
              {' · '}
              <span className="font-mono">{businessType}</span>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
