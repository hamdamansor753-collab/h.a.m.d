'use client'

/**
 * Payroll panel — create payroll run + post to ledger.
 *
 * Flow:
 *  1. Enter a period (YYYY-MM) → click "Run Payroll" → creates a DRAFT run
 *  2. View the run's lines (per-employee breakdown)
 *  3. Click "Post" → posts to ledger (creates balanced JE)
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatNumber } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, Wallet, Send, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

interface PayrollLine {
  id: string
  employeeId: string
  grossSalary: string
  incomeTax: string
  employeeInsurance: string
  employerInsurance: string
  netPay: string
}
interface PayrollRun {
  id: string
  period: string
  status: 'DRAFT' | 'POSTED'
  lines: PayrollLine[]
  journalEntryId?: string | null
  createdAt: string
}

interface Props {
  canRun: boolean
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  POSTED: 'bg-success/15 text-success border-success/30',
}

export function PayrollPanel({ canRun }: Props) {
  const { t } = useI18n()
  const formatNumber = useFormatNumber()
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [creating, setCreating] = useState(false)
  const [postingId, setPostingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/payroll-runs', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      setRuns(await r.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate() {
    setCreating(true)
    try {
      const r = await fetch('/api/payroll-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ period }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('payroll.create'))
      void load()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setCreating(false)
    }
  }

  async function handlePost(id: string) {
    setPostingId(id)
    try {
      const r = await fetch(`/api/payroll-runs/${id}/post`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('payroll.posted'))
      void load()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setPostingId(null)
    }
  }

  function runTotals(run: PayrollRun) {
    let gross = 0, tax = 0, empIns = 0, erIns = 0, net = 0
    for (const l of run.lines) {
      gross += Number(l.grossSalary)
      tax += Number(l.incomeTax)
      empIns += Number(l.employeeInsurance)
      erIns += Number(l.employerInsurance)
      net += Number(l.netPay)
    }
    return { gross, tax, empIns, erIns, net, insurance: empIns + erIns }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Wallet className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('payroll.title')}</h1>
          <p className="text-xs text-muted-foreground">{runs.length} {t('payroll.title')}</p>
        </div>
      </div>

      {canRun && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('payroll.create')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="period">{t('payroll.monthLabel')}</Label>
                <Input
                  id="period"
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </div>
              <Button onClick={handleCreate} disabled={creating} className="gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus />}
                <span>{t('payroll.create')}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </CardContent>
        </Card>
      ) : runs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('payroll.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => {
            const totals = runTotals(run)
            return (
              <Card key={run.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {run.period}
                      <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[run.status] ?? ''}`}>
                        {t(`payroll.status.${run.status}`)}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {run.lines.length} {t('payroll.employees')}
                      {run.journalEntryId && ` · JE: ${run.journalEntryId.substring(0, 8)}...`}
                    </CardDescription>
                  </div>
                  {run.status === 'DRAFT' && canRun && (
                    <Button
                      size="sm"
                      onClick={() => handlePost(run.id)}
                      disabled={postingId === run.id}
                      className="gap-2"
                    >
                      {postingId === run.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      <span>{t('payroll.post')}</span>
                    </Button>
                  )}
                  {run.status === 'POSTED' && (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  )}
                </CardHeader>
                <CardContent>
                  {/* Per-line breakdown */}
                  <div className="space-y-1 mb-3">
                    <div className="grid grid-cols-12 gap-2 text-[10px] font-medium text-muted-foreground px-1">
                      <div className="col-span-3">{t('payroll.employees')}</div>
                      <div className="col-span-2 text-end">{t('payroll.grossTotal')}</div>
                      <div className="col-span-2 text-end">{t('payroll.taxTotal')}</div>
                      <div className="col-span-2 text-end">{t('payroll.insuranceTotal')}</div>
                      <div className="col-span-3 text-end">{t('payroll.netTotal')}</div>
                    </div>
                    {run.lines.map((line) => (
                      <div key={line.id} className="grid grid-cols-12 gap-2 px-1 py-1 text-xs border-b border-border/30 last:border-0">
                        <div className="col-span-3 font-mono text-muted-foreground">{line.employeeId.substring(0, 8)}...</div>
                        <div className="col-span-2 text-end font-mono">{formatNumber(Number(line.grossSalary), { minimumFractionDigits: 0 })}</div>
                        <div className="col-span-2 text-end font-mono">{formatNumber(Number(line.incomeTax), { minimumFractionDigits: 0 })}</div>
                        <div className="col-span-2 text-end font-mono">{formatNumber(Number(line.employeeInsurance) + Number(line.employerInsurance), { minimumFractionDigits: 0 })}</div>
                        <div className="col-span-3 text-end font-mono font-medium">{formatNumber(Number(line.netPay), { minimumFractionDigits: 0 })}</div>
                      </div>
                    ))}
                  </div>
                  {/* Totals */}
                  <div className="grid grid-cols-12 gap-2 px-1 py-2 text-sm border-t border-border font-medium">
                    <div className="col-span-3">{t('payroll.grossTotal')}</div>
                    <div className="col-span-2 text-end font-mono">{formatNumber(totals.gross, { minimumFractionDigits: 2 })}</div>
                    <div className="col-span-2 text-end font-mono">{formatNumber(totals.tax, { minimumFractionDigits: 2 })}</div>
                    <div className="col-span-2 text-end font-mono">{formatNumber(totals.insurance, { minimumFractionDigits: 2 })}</div>
                    <div className="col-span-3 text-end font-mono text-accent">{formatNumber(totals.net, { minimumFractionDigits: 2 })}</div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Plus() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  )
}
