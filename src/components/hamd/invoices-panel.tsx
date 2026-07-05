'use client'

/**
 * Invoices panel — list, create, edit, post, void.
 *
 * All text via i18n keys. All amounts via Intl formatters. RTL-aware.
 *
 * Flow:
 *  - DRAFT invoices: editable (customer, date, lines), deletable, postable
 *  - POSTED invoices: immutable — show "Posted" badge + "Void" button
 *  - VOID invoices: show "Void" badge, no actions
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatDate, useFormatNumber } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, FileText, Trash2, Send, Ban, Pencil } from 'lucide-react'
import { toast } from 'sonner'

interface InvoiceLine {
  id?: string
  description: string
  amount: string  // Decimal comes as string from Prisma
  taxRate: string
}
interface Invoice {
  id: string
  number: string
  customerName: string
  date: string
  status: 'DRAFT' | 'POSTED' | 'VOID'
  lines: InvoiceLine[]
  journalEntryId?: string | null
  voidJournalEntryId?: string | null
}

interface Props {
  canCreate: boolean
  canPost: boolean
  canVoid: boolean
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  POSTED: 'bg-success/15 text-success border-success/30',
  VOID: 'bg-danger/15 text-danger border-danger/30',
}

export function InvoicesPanel({ canCreate, canPost, canVoid }: Props) {
  const { t } = useI18n()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Invoice | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/invoices', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      setInvoices(await r.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  function handleNew() {
    setEditing(null)
    setShowForm(true)
  }
  function handleEdit(inv: Invoice) {
    setEditing(inv)
    setShowForm(true)
  }

  async function handlePost(id: string) {
    try {
      const r = await fetch(`/api/invoices/${id}/post`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('invoice.posted'))
      void load()
    } catch {
      toast.error(t('common.error'))
    }
  }

  async function handleVoid(id: string) {
    try {
      const r = await fetch(`/api/invoices/${id}/void`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('invoice.voided'))
      void load()
    } catch {
      toast.error(t('common.error'))
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this draft invoice?')) return
    try {
      const r = await fetch(`/api/invoices/${id}`, { method: 'DELETE', credentials: 'include' })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      void load()
    } catch {
      toast.error(t('common.error'))
    }
  }

  function lineTotals(lines: InvoiceLine[]) {
    const base = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
    const tax = lines.reduce((s, l) => s + (Number(l.amount) || 0) * (Number(l.taxRate) || 0), 0)
    return { base, tax, total: base + tax }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold">{t('invoice.title')}</h1>
            <p className="text-xs text-muted-foreground">{invoices.length} {t('invoice.title')}</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={handleNew} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span>{t('invoice.create')}</span>
          </Button>
        )}
      </div>

      {showForm && (
        <InvoiceForm
          invoice={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSaved={() => { setShowForm(false); setEditing(null); void load() }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('invoice.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('invoice.empty')}</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto hamd-scroll space-y-2">
              {invoices.map((inv) => {
                const totals = lineTotals(inv.lines)
                return (
                  <div key={inv.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-medium">{inv.number}</span>
                          <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[inv.status]}`}>
                            {t(`invoice.status.${inv.status}`)}
                          </Badge>
                        </div>
                        <div className="text-sm text-foreground mt-1">{inv.customerName}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(inv.date)}</div>
                      </div>
                      <div className="text-end shrink-0">
                        <div className="text-sm font-mono font-medium">{formatNumber(totals.total, { minimumFractionDigits: 2 })}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {t('invoice.baseTotal')}: {formatNumber(totals.base, { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {t('invoice.taxTotal')}: {formatNumber(totals.tax, { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 pt-2 border-t border-border">
                      {inv.status === 'DRAFT' && canCreate && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => handleEdit(inv)} className="gap-1.5 text-xs h-7">
                            <Pencil className="h-3 w-3" /> {t('invoice.edit')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(inv.id)} className="gap-1.5 text-xs h-7 text-danger">
                            <Trash2 className="h-3 w-3" /> {t('common.cancel')}
                          </Button>
                        </>
                      )}
                      {inv.status === 'DRAFT' && canPost && (
                        <Button variant="default" size="sm" onClick={() => handlePost(inv.id)} className="gap-1.5 text-xs h-7 ms-auto">
                          <Send className="h-3 w-3" /> {t('invoice.post')}
                        </Button>
                      )}
                      {inv.status === 'POSTED' && canVoid && (
                        <Button variant="ghost" size="sm" onClick={() => handleVoid(inv.id)} className="gap-1.5 text-xs h-7 text-danger ms-auto">
                          <Ban className="h-3 w-3" /> {t('invoice.void')}
                        </Button>
                      )}
                      {inv.status === 'VOID' && (
                        <span className="text-[10px] text-muted-foreground ms-auto">
                          {t('invoice.voided')}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- Invoice Form ----------

function InvoiceForm({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: Invoice | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [customerName, setCustomerName] = useState(invoice?.customerName ?? '')
  const [date, setDate] = useState(() => {
    if (invoice?.date) return new Date(invoice.date).toISOString().slice(0, 10)
    return new Date().toISOString().slice(0, 10)
  })
  const [lines, setLines] = useState<Array<{ description: string; amount: string; taxRate: string }>>(
    invoice?.lines?.map((l) => ({
      description: l.description,
      amount: String(l.amount),
      taxRate: String(l.taxRate),
    })) ?? [{ description: '', amount: '0', taxRate: '0.14' }]
  )
  const [saving, setSaving] = useState(false)

  function addLine() {
    setLines((prev) => [...prev, { description: '', amount: '0', taxRate: '0.14' }])
  }
  function updateLine(i: number, patch: Partial<{ description: string; amount: string; taxRate: string }>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i))
  }

  const baseTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const taxTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0) * (Number(l.taxRate) || 0), 0)
  const grandTotal = baseTotal + taxTotal

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!customerName.trim()) {
      toast.error(t('invoice.customer'))
      return
    }
    if (lines.length === 0) {
      toast.error(t('invoice.lines'))
      return
    }
    setSaving(true)
    try {
      const payload = {
        customerName,
        date: new Date(date).toISOString(),
        lines: lines.map((l) => ({
          description: l.description,
          amount: Number(l.amount),
          taxRate: Number(l.taxRate),
        })),
      }
      const url = invoice ? `/api/invoices/${invoice.id}` : '/api/invoices'
      const method = invoice ? 'PATCH' : 'POST'
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(invoice ? t('invoice.updated') : t('invoice.created'))
      onSaved()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{invoice ? t('invoice.edit') : t('invoice.create')}</CardTitle>
        {invoice && (
          <CardDescription className="font-mono">{invoice.number}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="customer">{t('invoice.customer')}</Label>
              <Input id="customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">{t('invoice.date')}</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('invoice.lines')}</Label>
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
              <div className="col-span-6">{t('invoice.description')}</div>
              <div className="col-span-3 text-end">{t('invoice.amount')}</div>
              <div className="col-span-2 text-end">{t('invoice.taxRate')}</div>
              <div className="col-span-1"></div>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-6"
                  placeholder={t('invoice.description')}
                  value={l.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                  required
                />
                <Input
                  className="col-span-3 text-end font-mono"
                  type="number"
                  step="0.01"
                  min="0"
                  value={l.amount}
                  onChange={(e) => updateLine(i, { amount: e.target.value })}
                />
                <Input
                  className="col-span-2 text-end font-mono"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={l.taxRate}
                  onChange={(e) => updateLine(i, { taxRate: e.target.value })}
                />
                <div className="col-span-1 flex justify-center">
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)} disabled={lines.length <= 1}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addLine} className="gap-2">
              <Plus className="h-3.5 w-3.5" />
              <span>{t('invoice.addLine')}</span>
            </Button>
          </div>

          <div className="rounded-md border border-border p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('invoice.baseTotal')}</span>
              <span className="font-mono">{baseTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('invoice.taxTotal')}</span>
              <span className="font-mono">{taxTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-medium pt-1 border-t border-border">
              <span>{t('invoice.grandTotal')}</span>
              <span className="font-mono">{grandTotal.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t('invoice.cancel')}</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <span className="ms-2">{t('invoice.save')}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
