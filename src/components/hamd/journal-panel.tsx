'use client'

/**
 * Journal panel — list existing entries, and a form to create a new one.
 * The form displays the running debit/credit totals and disables submit
 * until they match. Even if the user bypasses the UI check, the server
 * rejects unbalanced entries (see /api/tests).
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatDate, useFormatNumber } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, FileText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface Account {
  id: string
  code: string
  nameKey: string
  type: string
}
interface JournalEntry {
  id: string
  date: string
  description: string
  sourceModule: string
  sourceRefId: string
  lines: Array<{ id: string; accountId: string; debit: string; credit: string }>
}

interface Props {
  canCreate: boolean
}

export function JournalPanel({ canCreate }: Props) {
  const { t } = useI18n()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<Array<{ accountId: string; debit: string; credit: string }>>([
    { accountId: '', debit: '0', credit: '0' },
    { accountId: '', debit: '0', credit: '0' },
  ])
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [jeR, accR] = await Promise.all([
        fetch('/api/journal', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/accounts', { cache: 'no-store', credentials: 'include' }),
      ])
      if (!jeR.ok || !accR.ok) throw new Error()
      const je = await jeR.json()
      const acc = await accR.json()
      setEntries(je)
      setAccounts(acc.flat)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const debitTotal = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const creditTotal = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const balanced = Math.round(debitTotal * 100) === Math.round(creditTotal * 100) && debitTotal > 0

  function updateLine(i: number, patch: Partial<{ accountId: string; debit: string; credit: string }>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((prev) => [...prev, { accountId: '', debit: '0', credit: '0' }])
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!balanced) {
      toast.error(t('journal.unbalanced'))
      return
    }
    setCreating(true)
    try {
      const r = await fetch('/api/journal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: new Date(date).toISOString(),
          description,
          sourceModule: 'accounting',
          sourceRefId: `manual-${Date.now()}`,
          lines: lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) })),
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('journal.created'))
      setDescription('')
      setLines([
        { accountId: '', debit: '0', credit: '0' },
        { accountId: '', debit: '0', credit: '0' },
      ])
      setShowForm(false)
      void load()
    } finally {
      setCreating(false)
    }
  }

  const accountLabel = (a: Account) => `${a.code} · ${t(a.nameKey)}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold">{t('nav.journal')}</h1>
            <p className="text-xs text-muted-foreground">{entries.length} {t('nav.journal')}</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm((s) => !s)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span>{t('journal.create')}</span>
          </Button>
        )}
      </div>

      {showForm && canCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('journal.create')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="date">{t('journal.date')}</Label>
                  <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="desc">{t('journal.description')}</Label>
                  <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
                  <div className="col-span-6">{t('account.name')}</div>
                  <div className="col-span-2 text-end">{t('journal.debit')}</div>
                  <div className="col-span-2 text-end">{t('journal.credit')}</div>
                  <div className="col-span-2"></div>
                </div>
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-6">
                      <Select value={l.accountId} onValueChange={(v) => updateLine(i, { accountId: v })}>
                        <SelectTrigger><SelectValue placeholder={t('account.name')} /></SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{accountLabel(a)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      className="col-span-2 text-end font-mono"
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.debit}
                      onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value === '0' || Number(l.credit) === 0 ? l.credit : '0' })}
                    />
                    <Input
                      className="col-span-2 text-end font-mono"
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.credit}
                      onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value === '0' || Number(l.debit) === 0 ? l.debit : '0' })}
                    />
                    <div className="col-span-2 flex justify-center">
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)} disabled={lines.length <= 2}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addLine} className="gap-2">
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('journal.addLine')}</span>
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <span className="text-muted-foreground">{t('journal.total')}</span>
                <div className="flex items-center gap-4 font-mono">
                  <span className={balanced ? 'text-success' : 'text-muted-foreground'}>
                    {t('journal.debit')}: {formatNumber(debitTotal, { minimumFractionDigits: 2 })}
                  </span>
                  <span className={balanced ? 'text-success' : 'text-muted-foreground'}>
                    {t('journal.credit')}: {formatNumber(creditTotal, { minimumFractionDigits: 2 })}
                  </span>
                  {!balanced && (
                    <span className="text-danger text-xs">{t('journal.unbalanced')}</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('journal.cancel')}</Button>
                <Button type="submit" disabled={creating || !balanced}>
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span className="ms-2">{t('journal.save')}</span>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('nav.journal')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('journal.empty')}</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto hamd-scroll space-y-3">
              {entries.map((entry) => {
                const d = entry.lines.reduce((s, l) => s + Number(l.debit), 0)
                const c = entry.lines.reduce((s, l) => s + Number(l.credit), 0)
                return (
                  <div key={entry.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="text-sm font-medium">{entry.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(entry.date)} · {entry.sourceModule} · {entry.sourceRefId}
                        </div>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        {formatNumber(d, { minimumFractionDigits: 2 })} = {formatNumber(c, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      {entry.lines.map((l) => {
                        const acc = accounts.find((a) => a.id === l.accountId)
                        return (
                          <div key={l.id} className="grid grid-cols-12 gap-2 text-xs py-0.5">
                            <div className="col-span-6 font-mono text-muted-foreground">
                              {acc ? `${acc.code} · ${t(acc.nameKey)}` : l.accountId}
                            </div>
                            <div className="col-span-3 text-end font-mono">{Number(l.debit) > 0 ? formatNumber(l.debit, { minimumFractionDigits: 2 }) : '—'}</div>
                            <div className="col-span-3 text-end font-mono">{Number(l.credit) > 0 ? formatNumber(l.credit, { minimumFractionDigits: 2 }) : '—'}</div>
                          </div>
                        )
                      })}
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
