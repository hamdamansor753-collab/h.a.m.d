'use client'

/**
 * Phase 8 — Super-admin billing panel.
 *
 * Visible ONLY to platform:admin users (the H.A.M.D platform owner).
 * Renders three sections:
 *  1. Plan overview cards — the 3 tiers (starter / pro / enterprise) with
 *     monthly price + limits. Loaded from /api/plans.
 *  2. Tenants table — every tenant on the platform with their subscription
 *     status, plan, currentPeriodEnd, trialEndsAt. Loaded from /api/admin/tenants.
 *  3. Record-payment form (per tenant) — amount + method (bank_transfer /
 *     instapay / cash / vodafone_cash). POSTs to /api/admin/payments, which
 *     extends the tenant's currentPeriodEnd by 1 month and flips status → ACTIVE.
 *
 * Patterns mirrored from existing panels (accounts-panel, hr-panel,
 * branding-panel):
 *  - 'use client', useI18n(), useFormatNumber(), useFormatDate()
 *  - Card / CardContent / CardHeader / CardTitle, Button, Input, Label,
 *    Badge, Select, Loader2
 *  - fetch with cache:'no-store' + credentials:'include'
 *  - toast from sonner
 *  - dual-rendering (desktop grid `hidden sm:grid` + mobile cards `sm:hidden`)
 *  - all visible text via t('key')
 *
 * Security note: this panel is rendered client-side only when
 * `user.isPlatformAdmin` is true (flag from /api/session). Every
 * /api/admin/* call is re-checked server-side via isPlatformAdmin(email) —
 * the client flag is UI-only and never trusted for authorization.
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatNumber, useFormatDate } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, CreditCard, Building2, Crown, Rocket, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

// ---------- Types ----------

type SubStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED'

interface Plan {
  id: string
  key: string
  nameKey: string
  monthlyPrice: string
  maxUsers: number
  maxInvoicesPerMonth: number | null
}

interface Subscription {
  id: string
  tenantId: string
  planId: string
  status: SubStatus
  currentPeriodEnd: string
  trialEndsAt: string | null
  createdAt: string
  plan: Plan
}

interface TenantRow {
  id: string
  name: string
  defaultLocale: string
  country: string
  businessType: string
  createdAt: string
  subscription: Subscription | null
}

type PaymentMethod = 'bank_transfer' | 'instapay' | 'cash' | 'vodafone_cash'

// ---------- Status badge styling ----------

const STATUS_BADGE: Record<SubStatus, string> = {
  TRIALING: 'bg-info/15 text-info border-info/30',
  ACTIVE: 'bg-success/15 text-success border-success/30',
  PAST_DUE: 'bg-warning/15 text-warning border-warning/30',
  SUSPENDED: 'bg-danger/15 text-danger border-danger/30',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
}

const PLAN_ICON: Record<string, typeof Rocket> = {
  starter: Rocket,
  pro: Crown,
  enterprise: Building2,
}

// ---------- Main Panel ----------

export function BillingPanel() {
  const { t } = useI18n()
  const fmtNum = useFormatNumber()
  const fmtDate = useFormatDate()

  const [loading, setLoading] = useState(true)
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [plans, setPlans] = useState<Plan[]>([])

  // Per-tenant payment form state. keyed by subscriptionId so multiple
  // tenants can have their form open independently without colliding.
  const [paymentForms, setPaymentForms] = useState<Record<string, { amount: string; method: PaymentMethod }>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tr, pr] = await Promise.all([
        fetch('/api/admin/tenants', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/plans', { cache: 'no-store', credentials: 'include' }),
      ])
      if (!tr.ok || !pr.ok) throw new Error()
      const td = await tr.json()
      const pd = await pr.json()
      setTenants(td.tenants ?? [])
      setPlans(pd.plans ?? [])
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  function getForm(subId: string): { amount: string; method: PaymentMethod } {
    return paymentForms[subId] ?? { amount: '', method: 'bank_transfer' }
  }

  function setForm(subId: string, patch: Partial<{ amount: string; method: PaymentMethod }>) {
    setPaymentForms((prev) => ({
      ...prev,
      [subId]: { ...getForm(subId), ...patch },
    }))
  }

  async function handleRecordPayment(subId: string) {
    const form = getForm(subId)
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t('billing.amount'))
      return
    }
    setSubmitting(subId)
    try {
      const r = await fetch('/api/admin/payments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: subId,
          amount,
          method: form.method,
        }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        toast.error(data?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('billing.paymentRecorded'))
      // Clear the form + reload to reflect the new currentPeriodEnd + ACTIVE status
      setPaymentForms((prev) => {
        const next = { ...prev }
        delete next[subId]
        return next
      })
      void load()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSubmitting(null)
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('billing.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('billing.tenants')} · {t('billing.plans')}</p>
        </div>
      </div>

      {/* ---------------- Plan overview cards ---------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {plans.map((plan) => {
          const Icon = PLAN_ICON[plan.key] ?? CreditCard
          return (
            <Card key={plan.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icon className="h-4 w-4 text-accent" />
                    <span>{t(plan.nameKey)}</span>
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] font-mono">{plan.key}</Badge>
                </div>
                <CardDescription className="text-2xl font-bold text-foreground pt-1">
                  {fmtNum(Number(plan.monthlyPrice), { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  <span className="text-xs font-normal text-muted-foreground ms-1">/ {t('billing.monthlyPrice')}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span className="text-muted-foreground">{t('billing.maxUsers')}:</span>
                  <span className="font-medium">{plan.maxUsers}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span className="text-muted-foreground">{t('billing.maxInvoicesPerMonth')}:</span>
                  <span className="font-medium">
                    {plan.maxInvoicesPerMonth === null ? '∞' : fmtNum(plan.maxInvoicesPerMonth)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ---------------- Tenants table (desktop) ---------------- */}
      <Card className="hidden sm:block">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-accent" />
            <span>{t('billing.tenants')}</span>
            <Badge variant="secondary" className="text-[10px] ms-2">{tenants.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {tenants.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('billing.noTenants')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-start font-medium px-3 py-2">{t('billing.tenants')}</th>
                    <th className="text-start font-medium px-3 py-2">{t('billing.plans')}</th>
                    <th className="text-start font-medium px-3 py-2">{t('billing.status')}</th>
                    <th className="text-start font-medium px-3 py-2">{t('billing.currentPeriodEnd')}</th>
                    <th className="text-start font-medium px-3 py-2">{t('billing.trialEndsAt')}</th>
                    <th className="text-start font-medium px-3 py-2">{t('billing.recordPayment')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tenants.map((tenant) => (
                    <TenantRowDesktop
                      key={tenant.id}
                      tenant={tenant}
                      getForm={getForm}
                      setForm={setForm}
                      onSubmit={handleRecordPayment}
                      submitting={submitting}
                      fmtNum={fmtNum}
                      fmtDate={fmtDate}
                      tStatus={(s: SubStatus) => t(`billing.${s.toLowerCase().replace('_', '')}`)}
                      tPlan={(k: string) => t(`plan.${k}`)}
                      t={t}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Tenants cards (mobile) ---------------- */}
      <div className="sm:hidden space-y-3">
        {tenants.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              {t('billing.noTenants')}
            </CardContent>
          </Card>
        ) : (
          tenants.map((tenant) => (
            <TenantCardMobile
              key={tenant.id}
              tenant={tenant}
              getForm={getForm}
              setForm={setForm}
              onSubmit={handleRecordPayment}
              submitting={submitting}
              fmtNum={fmtNum}
              fmtDate={fmtDate}
              tStatus={(s: SubStatus) => t(`billing.${s.toLowerCase().replace('_', '')}`)}
              tPlan={(k: string) => t(`plan.${k}`)}
              t={t}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ---------- Desktop row ----------

interface RowProps {
  tenant: TenantRow
  getForm: (subId: string) => { amount: string; method: PaymentMethod }
  setForm: (subId: string, patch: Partial<{ amount: string; method: PaymentMethod }>) => void
  onSubmit: (subId: string) => void
  submitting: string | null
  fmtNum: (n: number | string, opts?: Intl.NumberFormatOptions) => string
  fmtDate: (d: Date | string, opts?: Intl.DateTimeFormatOptions) => string
  tStatus: (s: SubStatus) => string
  tPlan: (k: string) => string
  t: (k: string) => string
}

function TenantRowDesktop({
  tenant, getForm, setForm, onSubmit, submitting, fmtDate, tStatus, tPlan, t,
}: RowProps) {
  const sub = tenant.subscription
  return (
    <tr className="align-top">
      <td className="px-3 py-2.5">
        <div className="font-medium">{tenant.name}</div>
        <div className="text-[11px] text-muted-foreground font-mono">{tenant.id}</div>
        <div className="text-[11px] text-muted-foreground">{tenant.country} · {tenant.businessType}</div>
      </td>
      <td className="px-3 py-2.5">
        {sub ? (
          <Badge variant="outline" className="text-[10px]">{tPlan(sub.plan.key)}</Badge>
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {sub ? (
          <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[sub.status]}`}>
            {tStatus(sub.status)}
          </Badge>
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs">
        {sub ? fmtDate(sub.currentPeriodEnd) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2.5 text-xs">
        {sub?.trialEndsAt ? fmtDate(sub.trialEndsAt) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2.5">
        {sub ? (
          <PaymentForm
            subId={sub.id}
            form={getForm(sub.id)}
            onFormChange={(patch) => setForm(sub.id, patch)}
            onSubmit={() => onSubmit(sub.id)}
            submitting={submitting === sub.id}
            t={t}
          />
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  )
}

// ---------- Mobile card ----------

function TenantCardMobile({
  tenant, getForm, setForm, onSubmit, submitting, fmtDate, tStatus, tPlan, t,
}: RowProps) {
  const sub = tenant.subscription
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium text-sm">{tenant.name}</div>
            <div className="text-[11px] text-muted-foreground font-mono">{tenant.id}</div>
          </div>
          {sub && (
            <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[sub.status]}`}>
              {tStatus(sub.status)}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">{t('billing.plans')}</div>
            <div className="font-medium">{sub ? tPlan(sub.plan.key) : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t('billing.currentPeriodEnd')}</div>
            <div className="font-medium">{sub ? fmtDate(sub.currentPeriodEnd) : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t('billing.trialEndsAt')}</div>
            <div className="font-medium">{sub?.trialEndsAt ? fmtDate(sub.trialEndsAt) : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t('billing.status')}</div>
            <div className="font-medium">{sub ? tStatus(sub.status) : '—'}</div>
          </div>
        </div>
        {sub && (
          <PaymentForm
            subId={sub.id}
            form={getForm(sub.id)}
            onFormChange={(patch) => setForm(sub.id, patch)}
            onSubmit={() => onSubmit(sub.id)}
            submitting={submitting === sub.id}
            t={t}
          />
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Payment form (shared) ----------

interface PaymentFormProps {
  subId: string
  form: { amount: string; method: PaymentMethod }
  onFormChange: (patch: Partial<{ amount: string; method: PaymentMethod }>) => void
  onSubmit: () => void
  submitting: boolean
  t: (k: string) => string
}

function PaymentForm({ form, onFormChange, onSubmit, submitting, t }: PaymentFormProps) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[180px]">
      <div className="flex gap-1.5">
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={form.amount}
          onChange={(e) => onFormChange({ amount: e.target.value })}
          placeholder={t('billing.amount')}
          className="h-8 text-xs"
          aria-label={t('billing.amount')}
        />
        <Select
          value={form.method}
          onValueChange={(v) => onFormChange({ method: v as PaymentMethod })}
        >
          <SelectTrigger className="h-8 text-xs w-[130px]" aria-label={t('billing.method')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bank_transfer">{t('billing.bankTransfer')}</SelectItem>
            <SelectItem value="instapay">{t('billing.instapay')}</SelectItem>
            <SelectItem value="cash">{t('billing.cash')}</SelectItem>
            <SelectItem value="vodafone_cash">{t('billing.vodafoneCash')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        size="sm"
        className="h-8 text-xs w-full"
        disabled={submitting || !form.amount}
        onClick={onSubmit}
      >
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
        <span className="ms-1.5">{t('billing.recordPayment')}</span>
      </Button>
    </div>
  )
}
