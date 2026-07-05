'use client'

/**
 * Appointments panel — list + schedule.
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatDate } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'

interface Customer { id: string; name: string }
interface Appointment {
  id: string
  scheduledAt: string
  note: string | null
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'
  customer: { id: string; name: string; phone: string | null }
  reminders: Array<{ id: string; dueAt: string; sent: boolean }>
}

interface Props {
  canManage: boolean
}

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: 'bg-accent/15 text-accent border-accent/30',
  COMPLETED: 'bg-success/15 text-success border-success/30',
  CANCELLED: 'bg-danger/15 text-danger border-danger/30',
  NO_SHOW: 'bg-warning/15 text-warning border-warning/30',
}

export function AppointmentsPanel({ canManage }: Props) {
  const { t } = useI18n()
  const formatDate = useFormatDate()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ar, cr] = await Promise.all([
        fetch('/api/appointments', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/customers', { cache: 'no-store', credentials: 'include' }),
      ])
      if (!ar.ok || !cr.ok) throw new Error()
      setAppointments(await ar.json())
      const cData = await cr.json()
      setCustomers(cData.map((c: Customer) => ({ id: c.id, name: c.name })))
    } catch { toast.error(t('common.error')) }
    finally { setLoading(false) }
  }, [t])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarClock className="h-6 w-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold">{t('appointment.title')}</h1>
            <p className="text-xs text-muted-foreground">{appointments.length} {t('appointment.title')}</p>
          </div>
        </div>
        {canManage && customers.length > 0 && (
          <Button onClick={() => setShowForm(s => !s)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span>{t('appointment.schedule')}</span>
          </Button>
        )}
      </div>

      {showForm && canManage && customers.length > 0 && (
        <AppointmentForm
          customers={customers}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); void load() }}
        />
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t('appointment.title')}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : appointments.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('appointment.empty')}</div>
          ) : (
            <div className="max-h-96 overflow-y-auto hamd-scroll space-y-2">
              {appointments.map((appt) => (
                <div key={appt.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <div className="text-sm font-medium">{appt.customer.name}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(appt.scheduledAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                      {appt.note && <div className="text-xs text-muted-foreground mt-1">{appt.note}</div>}
                    </div>
                    <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[appt.status] ?? ''}`}>
                      {t(`appointment.status.${appt.status}`)}
                    </Badge>
                  </div>
                  {appt.reminders.length > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {appt.reminders.length} reminder(s) · next: {formatDate(appt.reminders[0].dueAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AppointmentForm({ customers, onClose, onSaved }: { customers: Customer[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [customerId, setCustomerId] = useState('')
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 24, 0, 0, 0)
    return d.toISOString().slice(0, 16)
  })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!customerId) { toast.error(t('appointment.customer')); return }
    setSaving(true)
    try {
      const r = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          customerId,
          scheduledAt: new Date(scheduledAt).toISOString(),
          note: note || undefined,
        }),
      })
      const d = await r.json()
      if (!r.ok) { toast.error(d?.error?.message ?? t('common.error')); return }
      toast.success(t('appointment.schedule'))
      onSaved()
    } catch { toast.error(t('common.error')) }
    finally { setSaving(false) }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('appointment.schedule')}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="apptCustomer">{t('appointment.customer')}</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger id="apptCustomer"><SelectValue placeholder={t('appointment.customer')} /></SelectTrigger>
              <SelectContent>
                {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apptDate">{t('appointment.scheduledAt')}</Label>
            <Input id="apptDate" type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} required />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="apptNote">{t('appointment.note')}</Label>
            <Input id="apptNote" value={note} onChange={e => setNote(e.target.value)} />
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
