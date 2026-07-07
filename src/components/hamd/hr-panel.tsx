'use client'

/**
 * HR / Payroll panel — employees + payroll runs.
 *
 * Two cards:
 *  - Employees (canManage = hr:manage)
 *      · list employees (fullName, nationalId, hireDate, baseSalary, status badge)
 *      · create employee form (fullName, nationalId, hireDate, baseSalary)
 *  - Payroll Runs (canRun = hr:run)
 *      · list payroll runs (period, status, total gross/net, lines count)
 *      · create payroll run form (period YYYY-MM, multi-select employees via checkboxes)
 *      · "Post" button on DRAFT runs → POST /api/payroll-runs/[id]/post
 *
 * Patterns mirrored from purchase-orders-panel.tsx + manufacturing-panel.tsx:
 *  - 'use client', useI18n(), useFormatNumber(), useFormatDate()
 *  - fetch with cache:'no-store' + credentials:'include'
 *  - toast from sonner, Card/CardContent/CardHeader/CardTitle, Button, Input, Label, Badge, Loader2
 *  - dual-rendering (desktop grid `hidden sm:grid` + mobile card `sm:hidden`)
 *  - all text via t('key')
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatNumber, useFormatDate } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Users, Wallet, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

// ---------- Types ----------

interface Employee {
  id: string
  fullName: string
  nationalId: string
  hireDate: string
  baseSalary: string
  status: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED'
  createdAt: string
}

interface PayrollLine {
  id: string
  employeeId: string
  grossSalary: string
  incomeTax: string
  employeeInsurance: string
  employerInsurance: string
  netPay: string
  employee: Employee
}

interface PayrollRun {
  id: string
  period: string
  status: 'DRAFT' | 'POSTED'
  journalEntryId?: string | null
  createdAt: string
  lines: PayrollLine[]
}

interface Props {
  canManage: boolean  // hr:manage — create employees
  canRun: boolean     // hr:run — create / post payroll runs
}

const EMPLOYEE_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-success/15 text-success border-success/30',
  SUSPENDED: 'bg-muted text-muted-foreground border-border',
  TERMINATED: 'bg-danger/15 text-danger border-danger/30',
}

const RUN_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  POSTED: 'bg-success/15 text-success border-success/30',
}

// ---------- Main Panel ----------

export function HRPanel({ canManage, canRun }: Props) {
  const { t } = useI18n()
  const formatNumber = useFormatNumber()
  const formatDate = useFormatDate()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const [showEmployeeForm, setShowEmployeeForm] = useState(false)
  const [showRunForm, setShowRunForm] = useState(false)
  const [postingId, setPostingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [empR, runR] = await Promise.all([
        fetch('/api/employees', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/payroll-runs', { cache: 'no-store', credentials: 'include' }),
      ])
      if (!empR.ok || !runR.ok) throw new Error()
      setEmployees(await empR.json())
      setRuns(await runR.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function handlePost(id: string) {
    if (!confirm(t('hr.post') + '?')) return
    setPostingId(id)
    try {
      const r = await fetch(`/api/payroll-runs/${id}/post`, {
        method: 'POST',
        credentials: 'include',
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('hr.posted'))
      void load()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setPostingId(null)
    }
  }

  // helpers
  const statusLabel = (s: Employee['status']) =>
    s === 'ACTIVE' ? t('hr.active') : s === 'SUSPENDED' ? t('hr.suspended') : t('hr.terminated')

  const runTotals = (run: PayrollRun) => {
    let gross = 0
    let net = 0
    let tax = 0
    for (const l of run.lines) {
      gross += Number(l.grossSalary)
      net += Number(l.netPay)
      tax += Number(l.incomeTax)
    }
    return { gross, net, tax }
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('hr.title')}</h1>
          <p className="text-xs text-muted-foreground">
            {employees.length} {t('hr.employees')} · {runs.length} {t('hr.payrollRuns')}
          </p>
        </div>
      </div>

      {/* ============ Employees ============ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('hr.employees')}</CardTitle>
          {canManage && (
            <Button onClick={() => setShowEmployeeForm((s) => !s)} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              <span>{t('hr.createEmployee')}</span>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {showEmployeeForm && canManage && (
            <EmployeeForm
              onClose={() => setShowEmployeeForm(false)}
              onSaved={() => { setShowEmployeeForm(false); void load() }}
            />
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : employees.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('hr.noEmployees')}
            </div>
          ) : (
            <>
              {/* Desktop table header — hidden on mobile */}
              <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-3 pb-2 border-b border-border">
                <div className="col-span-4">{t('hr.fullName')}</div>
                <div className="col-span-2">{t('hr.nationalId')}</div>
                <div className="col-span-2">{t('hr.hireDate')}</div>
                <div className="col-span-2 text-end">{t('hr.baseSalary')}</div>
                <div className="col-span-2 text-center">{t('hr.status')}</div>
              </div>
              <div className="max-h-[50vh] overflow-y-auto hamd-scroll space-y-2 mt-2">
                {employees.map((e) => (
                  <div key={e.id}>
                    {/* Desktop row — hidden on mobile */}
                    <div className="hidden sm:grid grid-cols-12 gap-2 items-center text-sm px-3 py-2 rounded-md border border-border/60">
                      <div className="col-span-4 font-medium truncate">{e.fullName}</div>
                      <div className="col-span-2 font-mono text-xs text-muted-foreground truncate">{e.nationalId}</div>
                      <div className="col-span-2 text-xs text-muted-foreground">{formatDate(e.hireDate)}</div>
                      <div className="col-span-2 text-end font-mono">{formatNumber(Number(e.baseSalary), { minimumFractionDigits: 2 })}</div>
                      <div className="col-span-2 flex justify-center">
                        <Badge variant="outline" className={`text-[10px] ${EMPLOYEE_STATUS_COLORS[e.status]}`}>
                          {statusLabel(e.status)}
                        </Badge>
                      </div>
                    </div>
                    {/* Mobile card — hidden on sm+ */}
                    <div className="sm:hidden rounded-md border border-border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{e.fullName}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{e.nationalId}</div>
                        </div>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${EMPLOYEE_STATUS_COLORS[e.status]}`}>
                          {statusLabel(e.status)}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/40">
                        <div>
                          <div className="text-[10px] text-muted-foreground">{t('hr.hireDate')}</div>
                          <div>{formatDate(e.hireDate)}</div>
                        </div>
                        <div className="text-end">
                          <div className="text-[10px] text-muted-foreground">{t('hr.baseSalary')}</div>
                          <div className="font-mono">{formatNumber(Number(e.baseSalary), { minimumFractionDigits: 2 })}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ============ Payroll Runs ============ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('hr.payrollRuns')}</CardTitle>
          {canRun && (
            <Button
              onClick={() => setShowRunForm((s) => !s)}
              size="sm"
              className="gap-2"
              disabled={employees.length === 0}
              title={employees.length === 0 ? t('hr.noEmployees') : undefined}
            >
              <Plus className="h-4 w-4" />
              <span>{t('hr.createPayrollRun')}</span>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {showRunForm && canRun && employees.length > 0 && (
            <PayrollRunForm
              employees={employees}
              existingPeriods={new Set(runs.map((r) => r.period))}
              onClose={() => setShowRunForm(false)}
              onSaved={() => { setShowRunForm(false); void load() }}
            />
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : runs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('hr.noPayrollRuns')}
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto hamd-scroll space-y-2">
              {runs.map((run) => {
                const totals = runTotals(run)
                return (
                  <div key={run.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium font-mono">{run.period}</span>
                          <Badge variant="outline" className={`text-[10px] ${RUN_STATUS_COLORS[run.status]}`}>
                            {run.status === 'POSTED' ? t('hr.posted') : t('hr.draft')}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatDate(run.createdAt)}
                        </div>
                      </div>
                      <div className="text-end shrink-0">
                        <div className="text-sm font-mono font-medium">
                          {formatNumber(totals.gross, { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{t('hr.totalGross')}</div>
                      </div>
                    </div>

                    {/* Totals row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mt-2 pt-2 border-t border-border/40">
                      <div>
                        <div className="text-[10px] text-muted-foreground">{t('hr.lines')}</div>
                        <div className="font-mono">{run.lines.length}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">{t('hr.totalTax')}</div>
                        <div className="font-mono">{formatNumber(totals.tax, { minimumFractionDigits: 2 })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">{t('hr.totalGross')}</div>
                        <div className="font-mono">{formatNumber(totals.gross, { minimumFractionDigits: 2 })}</div>
                      </div>
                      <div className="text-end">
                        <div className="text-[10px] text-muted-foreground">{t('hr.totalNet')}</div>
                        <div className="font-mono font-medium">{formatNumber(totals.net, { minimumFractionDigits: 2 })}</div>
                      </div>
                    </div>

                    {/* Per-line breakdown (compact, both desktop + mobile) */}
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                        {t('hr.lines')} ({run.lines.length})
                      </summary>
                      <div className="mt-2 space-y-1 text-xs">
                        {/* Desktop table header */}
                        <div className="hidden sm:grid grid-cols-12 gap-2 text-[10px] font-medium text-muted-foreground px-1 pb-1">
                          <div className="col-span-4">{t('hr.fullName')}</div>
                          <div className="col-span-2 text-end">{t('hr.grossSalary')}</div>
                          <div className="col-span-2 text-end">{t('hr.incomeTax')}</div>
                          <div className="col-span-2 text-end">{t('hr.employeeInsurance')}</div>
                          <div className="col-span-2 text-end">{t('hr.netPay')}</div>
                        </div>
                        {run.lines.map((l) => (
                          <div key={l.id}>
                            {/* Desktop row */}
                            <div className="hidden sm:grid grid-cols-12 gap-2 px-1 py-1 border-b border-border/30 last:border-0">
                              <div className="col-span-4 truncate">{l.employee.fullName}</div>
                              <div className="col-span-2 text-end font-mono">{formatNumber(Number(l.grossSalary), { minimumFractionDigits: 2 })}</div>
                              <div className="col-span-2 text-end font-mono">{formatNumber(Number(l.incomeTax), { minimumFractionDigits: 2 })}</div>
                              <div className="col-span-2 text-end font-mono">{formatNumber(Number(l.employeeInsurance), { minimumFractionDigits: 2 })}</div>
                              <div className="col-span-2 text-end font-mono font-medium">{formatNumber(Number(l.netPay), { minimumFractionDigits: 2 })}</div>
                            </div>
                            {/* Mobile stacked card */}
                            <div className="sm:hidden rounded border border-border/40 p-2 space-y-1">
                              <div className="font-medium text-xs">{l.employee.fullName}</div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('hr.grossSalary')}</span>
                                <span className="font-mono">{formatNumber(Number(l.grossSalary), { minimumFractionDigits: 2 })}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('hr.incomeTax')}</span>
                                <span className="font-mono">{formatNumber(Number(l.incomeTax), { minimumFractionDigits: 2 })}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('hr.employeeInsurance')}</span>
                                <span className="font-mono">{formatNumber(Number(l.employeeInsurance), { minimumFractionDigits: 2 })}</span>
                              </div>
                              <div className="flex justify-between pt-1 border-t border-border/30">
                                <span className="font-medium">{t('hr.netPay')}</span>
                                <span className="font-mono font-medium">{formatNumber(Number(l.netPay), { minimumFractionDigits: 2 })}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>

                    {run.status === 'DRAFT' && canRun && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handlePost(run.id)}
                        disabled={postingId === run.id}
                        className="gap-1.5 text-xs h-9 w-full mt-2"
                      >
                        {postingId === run.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        <span>{t('hr.post')}</span>
                      </Button>
                    )}
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

// ---------- Employee Form ----------

function EmployeeForm({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [fullName, setFullName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [hireDate, setHireDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [baseSalary, setBaseSalary] = useState('0')
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || !nationalId.trim()) {
      toast.error(t('common.error'))
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fullName,
          nationalId,
          hireDate: new Date(hireDate).toISOString(),
          baseSalary: Number(baseSalary),
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('hr.createEmployee'))
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
        <CardTitle className="text-base">{t('hr.createEmployee')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">{t('hr.fullName')}</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nationalId">{t('hr.nationalId')}</Label>
              <Input id="nationalId" value={nationalId} onChange={(e) => setNationalId(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hireDate">{t('hr.hireDate')}</Label>
              <Input id="hireDate" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baseSalary">{t('hr.baseSalary')}</Label>
              <Input
                id="baseSalary"
                type="number"
                step="0.01"
                min="0"
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
                className="text-end font-mono"
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t('purchaseOrder.cancel')}</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <span className="ms-2">{t('hr.createEmployee')}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------- Payroll Run Form ----------

function PayrollRunForm({
  employees,
  existingPeriods,
  onClose,
  onSaved,
}: {
  employees: Employee[]
  existingPeriods: Set<string>
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const formatNumber = useFormatNumber()
  const [period, setPeriod] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  // Only ACTIVE employees are eligible for payroll runs.
  const eligible = employees.filter((e) => e.status === 'ACTIVE')

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function selectAll() {
    setSelected(new Set(eligible.map((e) => e.id)))
  }
  function clearAll() {
    setSelected(new Set())
  }

  const periodValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
  const periodDuplicate = existingPeriods.has(period)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!periodValid) {
      toast.error(t('hr.period'))
      return
    }
    if (periodDuplicate) {
      toast.error(t('hr.cannotModify'))
      return
    }
    if (selected.size === 0) {
      toast.error(t('hr.selectEmployees'))
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/payroll-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          period,
          employeeIds: Array.from(selected),
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('hr.createPayrollRun'))
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
        <CardTitle className="text-base">{t('hr.createPayrollRun')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="period">{t('hr.period')}</Label>
              <Input
                id="period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="YYYY-MM"
                className={`font-mono ${(!periodValid || periodDuplicate) ? 'border-danger' : ''}`}
                required
              />
              {periodDuplicate && (
                <p className="text-[10px] text-danger">{t('hr.cannotModify')}</p>
              )}
            </div>
            <div className="sm:col-span-2 flex items-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={selectAll} disabled={eligible.length === 0}>
                {t('hr.selectEmployees')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={clearAll} disabled={selected.size === 0}>
                {t('purchaseOrder.cancel')}
              </Button>
              <span className="text-xs text-muted-foreground ms-auto">
                {selected.size} / {eligible.length}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('hr.selectEmployees')}</Label>
            {eligible.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t('hr.noEmployees')}</p>
            ) : (
              <div className="max-h-[40vh] overflow-y-auto hamd-scroll rounded-md border border-border divide-y divide-border/40">
                {eligible.map((e) => {
                  const checked = selected.has(e.id)
                  return (
                    <label
                      key={e.id}
                      className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-muted/40 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(e.id)}
                        className="h-4 w-4 accent-accent"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{e.fullName}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{e.nationalId}</div>
                      </div>
                      <div className="text-end shrink-0">
                        <div className="font-mono text-xs">{formatNumber(Number(e.baseSalary), { minimumFractionDigits: 2 })}</div>
                        <div className="text-[10px] text-muted-foreground">{t('hr.baseSalary')}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t('purchaseOrder.cancel')}</Button>
            <Button type="submit" disabled={saving || selected.size === 0 || !periodValid || periodDuplicate}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <span className="ms-2">{t('hr.createPayrollRun')}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
