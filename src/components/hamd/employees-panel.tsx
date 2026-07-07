'use client'

/**
 * Employees panel — list + create.
 *
 * Salary fields are only shown if the user has hr:salary:read permission.
 * The API strips baseSalary/nationalId from the response when the caller
 * has hr:read but NOT hr:salary:read — this is defense in depth (the UI
 * also checks, but the API is the authoritative guard).
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatDate, useFormatNumber } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'

interface Employee {
  id: string
  fullName: string
  hireDate: string
  status: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED'
  baseSalary?: string  // only present if hr:salary:read
  nationalId?: string  // only present if hr:salary:read
}

interface Props {
  canManage: boolean
  canReadSalary: boolean
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-success/15 text-success border-success/30',
  SUSPENDED: 'bg-warning/15 text-warning border-warning/30',
  TERMINATED: 'bg-danger/15 text-danger border-danger/30',
}

export function EmployeesPanel({ canManage, canReadSalary }: Props) {
  const { t } = useI18n()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/employees', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      setEmployees(await r.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold">{t('hr.title')}</h1>
            <p className="text-xs text-muted-foreground">{employees.length} {t('hr.title')}</p>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => setShowForm((s) => !s)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span>{t('hr.createEmployee')}</span>
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <EmployeeForm
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); void load() }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('hr.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : employees.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('hr.empty')}</div>
          ) : (
            <div className="max-h-96 overflow-y-auto hamd-scroll">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2 py-1 border-b border-border">
                <div className="col-span-4">{t('hr.fullName')}</div>
                <div className="col-span-3">{t('hr.hireDate')}</div>
                <div className="col-span-2">{t('hr.status')}</div>
                <div className="col-span-3 text-end">{t('hr.baseSalary')}</div>
              </div>
              {employees.map((emp) => (
                <div key={emp.id} className="grid grid-cols-12 gap-2 px-2 py-2 border-b border-border/50 text-sm items-center">
                  <div className="col-span-4 font-medium">{emp.fullName}</div>
                  <div className="col-span-3 text-xs text-muted-foreground">{formatDate(emp.hireDate)}</div>
                  <div className="col-span-2">
                    <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[emp.status] ?? ''}`}>
                      {t(`hr.status.${emp.status}`)}
                    </Badge>
                  </div>
                  <div className="col-span-3 text-end font-mono">
                    {canReadSalary && emp.baseSalary
                      ? formatNumber(Number(emp.baseSalary), { minimumFractionDigits: 2 })
                      : <span className="text-muted-foreground text-xs">{t('hr.salaryHidden')}</span>
                    }
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function EmployeeForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [fullName, setFullName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [hireDate, setHireDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [baseSalary, setBaseSalary] = useState('0')
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
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
        <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">{t('hr.fullName')}</Label>
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nationalId">National ID</Label>
            <Input id="nationalId" value={nationalId} onChange={(e) => setNationalId(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hireDate">{t('hr.hireDate')}</Label>
            <Input id="hireDate" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="baseSalary">{t('hr.baseSalary')}</Label>
            <Input id="baseSalary" type="number" step="0.01" min="0" value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} required />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <span className="ms-2">{t('common.save')}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
