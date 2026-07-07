'use client'

/**
 * CRM panel — customers, appointments, and activity log.
 *
 * All text via i18n keys. All dates via Intl formatters. RTL-aware.
 *
 * Three sections:
 *  1. Customers — list (name/phone/email/counts) + create form
 *  2. Appointments — list (customer/date/note/status badge) + create form
 *     + status-update buttons (Complete / Cancel / No-Show)
 *  3. Activity Log — recent activities with optional customer filter
 *
 * The Create buttons + status-update buttons only render when
 * `canManage` (crm:manage) is true. Readers (crm:read) still see all data.
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatDate, useFormatNumber } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Users, CalendarClock, Activity, Check, Ban, UserX } from 'lucide-react'
import { toast } from 'sonner'

interface Customer {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  createdAt: string
  _count: { appointments: number; activityLogs: number }
}

type AppointmentStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'

interface Appointment {
  id: string
  customerId: string
  scheduledAt: string
  note?: string | null
  status: AppointmentStatus
  customer: { id: string; name: string; phone?: string | null; email?: string | null }
}

interface ActivityLogEntry {
  id: string
  type: string
  refId: string
  createdAt: string
  customerId: string
  customer: { id: string; name: string }
}

interface Props {
  canManage: boolean // crm:manage — create customers/appointments, update status
}

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'bg-muted text-muted-foreground border-border',
  COMPLETED: 'bg-success/15 text-success border-success/30',
  CANCELLED: 'bg-danger/15 text-danger border-danger/30',
  NO_SHOW: 'bg-warning/15 text-warning border-warning/30',
}

const STATUS_LABEL_KEY: Record<AppointmentStatus, string> = {
  SCHEDULED: 'crm.scheduled',
  COMPLETED: 'crm.completed',
  CANCELLED: 'crm.cancelled',
  NO_SHOW: 'crm.noShow',
}

const ACTIVITY_TYPE_KEY: Record<string, string> = {
  appointment_created: 'crm.appointmentCreated',
  appointment_status_changed: 'crm.appointmentStatusChanged',
}

export function CRMPanel({ canManage }: Props) {
  const { t } = useI18n()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [activities, setActivities] = useState<ActivityLogEntry[]>([])

  const [loadingCustomers, setLoadingCustomers] = useState(true)
  const [loadingAppointments, setLoadingAppointments] = useState(true)
  const [loadingActivities, setLoadingActivities] = useState(true)

  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [showAppointmentForm, setShowAppointmentForm] = useState(false)
  const [activityFilter, setActivityFilter] = useState<string>('all')

  // ---------- Loaders ----------

  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true)
    try {
      const r = await fetch('/api/customers', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      setCustomers(await r.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoadingCustomers(false)
    }
  }, [t])

  const loadAppointments = useCallback(async () => {
    setLoadingAppointments(true)
    try {
      const r = await fetch('/api/appointments', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      setAppointments(await r.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoadingAppointments(false)
    }
  }, [t])

  const loadActivities = useCallback(async (customerId?: string) => {
    setLoadingActivities(true)
    try {
      const url = customerId && customerId !== 'all'
        ? `/api/activity-log?customerId=${encodeURIComponent(customerId)}`
        : '/api/activity-log'
      const r = await fetch(url, { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      setActivities(await r.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoadingActivities(false)
    }
  }, [t])

  useEffect(() => {
    void loadCustomers()
    void loadAppointments()
    void loadActivities('all')
  }, [loadCustomers, loadAppointments, loadActivities])

  // Reload activity log whenever the filter changes.
  useEffect(() => {
    void loadActivities(activityFilter)
  }, [activityFilter, loadActivities])

  // ---------- Appointment status update ----------

  async function handleStatusChange(id: string, status: 'COMPLETED' | 'CANCELLED' | 'NO_SHOW') {
    try {
      const r = await fetch(`/api/appointments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t(`crm.${status === 'COMPLETED' ? 'completed' : status === 'CANCELLED' ? 'cancelled' : 'noShow'}`))
      void loadAppointments()
      void loadActivities(activityFilter)
    } catch {
      toast.error(t('common.error'))
    }
  }

  // ---------- Render ----------

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('crm.title')}</h1>
          <p className="text-xs text-muted-foreground">
            {customers.length} {t('crm.customers')} · {appointments.length} {t('crm.appointments')}
          </p>
        </div>
      </div>

      {/* ---------- Customers ---------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> {t('crm.customers')}
          </CardTitle>
          {canManage && (
            <Button onClick={() => setShowCustomerForm((s) => !s)} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              <span>{t('crm.createCustomer')}</span>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {showCustomerForm && canManage && (
            <div className="mb-3">
              <CustomerForm
                onClose={() => setShowCustomerForm(false)}
                onSaved={() => { setShowCustomerForm(false); void loadCustomers() }}
              />
            </div>
          )}

          {loadingCustomers ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : customers.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('crm.noCustomers')}</div>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto hamd-scroll">
              {/* Desktop table — hidden on mobile */}
              <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2 py-1 border-b border-border">
                <div className="col-span-4">{t('crm.customerName')}</div>
                <div className="col-span-3">{t('crm.phone')}</div>
                <div className="col-span-3">{t('crm.email')}</div>
                <div className="col-span-1 text-end">{t('crm.appointments')}</div>
                <div className="col-span-1 text-end">{t('crm.activityLog')}</div>
              </div>
              <div className="space-y-1 mt-1">
                {customers.map((c) => (
                  <div key={c.id}>
                    {/* Desktop row */}
                    <div className="hidden sm:grid grid-cols-12 gap-2 items-center px-2 py-2 rounded-md hover:bg-muted/40 text-sm">
                      <div className="col-span-4 font-medium truncate">{c.name}</div>
                      <div className="col-span-3 text-muted-foreground font-mono text-xs truncate">{c.phone ?? '—'}</div>
                      <div className="col-span-3 text-muted-foreground text-xs truncate">{c.email ?? '—'}</div>
                      <div className="col-span-1 text-end font-mono">{formatNumber(c._count.appointments)}</div>
                      <div className="col-span-1 text-end font-mono">{formatNumber(c._count.activityLogs)}</div>
                    </div>
                    {/* Mobile card */}
                    <div className="sm:hidden rounded-md border border-border/60 p-3 space-y-1">
                      <div className="font-medium text-sm">{c.name}</div>
                      {c.phone && <div className="text-xs text-muted-foreground font-mono">{c.phone}</div>}
                      {c.email && <div className="text-xs text-muted-foreground truncate">{c.email}</div>}
                      <div className="flex gap-3 pt-1 text-[10px] text-muted-foreground">
                        <span>{formatNumber(c._count.appointments)} {t('crm.appointments')}</span>
                        <span>{formatNumber(c._count.activityLogs)} {t('crm.activityLog')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Appointments ---------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> {t('crm.appointments')}
          </CardTitle>
          {canManage && customers.length > 0 && (
            <Button onClick={() => setShowAppointmentForm((s) => !s)} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              <span>{t('crm.createAppointment')}</span>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {showAppointmentForm && canManage && customers.length > 0 && (
            <div className="mb-3">
              <AppointmentForm
                customers={customers}
                onClose={() => setShowAppointmentForm(false)}
                onSaved={() => {
                  setShowAppointmentForm(false)
                  void loadAppointments()
                  void loadCustomers()
                  void loadActivities(activityFilter)
                }}
              />
            </div>
          )}

          {loadingAppointments ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : appointments.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('crm.noAppointments')}</div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto hamd-scroll space-y-2">
              {appointments.map((appt) => (
                <div key={appt.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{appt.customer.name}</span>
                        <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[appt.status]}`}>
                          {t(STATUS_LABEL_KEY[appt.status])}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{formatDate(appt.scheduledAt)}</div>
                      {appt.note && (
                        <div className="text-xs text-foreground/80 mt-1 line-clamp-2">{appt.note}</div>
                      )}
                    </div>
                  </div>
                  {appt.status === 'SCHEDULED' && canManage && (
                    <div className="flex items-center gap-1 pt-2 border-t border-border">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleStatusChange(appt.id, 'COMPLETED')}
                        className="gap-1.5 text-xs h-7"
                      >
                        <Check className="h-3 w-3" /> {t('crm.complete')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatusChange(appt.id, 'NO_SHOW')}
                        className="gap-1.5 text-xs h-7 text-warning"
                      >
                        <UserX className="h-3 w-3" /> {t('crm.markNoShow')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatusChange(appt.id, 'CANCELLED')}
                        className="gap-1.5 text-xs h-7 text-danger ms-auto"
                      >
                        <Ban className="h-3 w-3" /> {t('crm.cancel')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Activity Log ---------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> {t('crm.recentActivities')}
          </CardTitle>
          {customers.length > 0 && (
            <div className="w-48">
              <Select value={activityFilter} onValueChange={setActivityFilter}>
                <SelectTrigger size="sm"><SelectValue placeholder={t('crm.customer')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('crm.customers')}</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loadingActivities ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : activities.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('crm.noActivities')}</div>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto hamd-scroll space-y-1">
              {/* Desktop header */}
              <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2 py-1 border-b border-border">
                <div className="col-span-4">{t('crm.customer')}</div>
                <div className="col-span-5">{t('crm.type')}</div>
                <div className="col-span-3 text-end">{t('crm.scheduledAt')}</div>
              </div>
              {activities.map((a) => {
                const typeKey = ACTIVITY_TYPE_KEY[a.type] ?? 'crm.activityType'
                return (
                  <div
                    key={a.id}
                    className="hidden sm:grid grid-cols-12 gap-2 items-center px-2 py-2 rounded-md hover:bg-muted/40 text-sm"
                  >
                    <div className="col-span-4 font-medium truncate">{a.customer.name}</div>
                    <div className="col-span-5 text-muted-foreground">{t(typeKey)}</div>
                    <div className="col-span-3 text-end text-xs text-muted-foreground">{formatDate(a.createdAt)}</div>
                  </div>
                )
              })}
              {/* Mobile cards */}
              <div className="sm:hidden space-y-1">
                {activities.map((a) => {
                  const typeKey = ACTIVITY_TYPE_KEY[a.type] ?? 'crm.activityType'
                  return (
                    <div key={a.id} className="rounded-md border border-border/60 p-3 space-y-1">
                      <div className="font-medium text-sm">{a.customer.name}</div>
                      <div className="text-xs text-muted-foreground">{t(typeKey)}</div>
                      <div className="text-[10px] text-muted-foreground">{formatDate(a.createdAt)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- Customer Form ----------

function CustomerForm({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error(t('crm.customerName'))
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('crm.createCustomer'))
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
        <CardTitle className="text-base">{t('crm.createCustomer')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cust-name">{t('crm.customerName')}</Label>
              <Input id="cust-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-phone">{t('crm.phone')}</Label>
              <Input id="cust-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-email">{t('crm.email')}</Label>
              <Input id="cust-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <span className="ms-2">{t('common.save')}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------- Appointment Form ----------

function AppointmentForm({
  customers,
  onClose,
  onSaved,
}: {
  customers: Customer[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '')
  // Local datetime input value: "YYYY-MM-DDTHH:mm" — converts to ISO via new Date(...).toISOString()
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000) // default = +1 hour from now
    d.setMinutes(0, 0, 0)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!customerId) {
      toast.error(t('crm.customer'))
      return
    }
    if (!scheduledAt) {
      toast.error(t('crm.scheduledAt'))
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          customerId,
          scheduledAt: new Date(scheduledAt).toISOString(),
          note: note.trim() || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('crm.createAppointment'))
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
        <CardTitle className="text-base">{t('crm.createAppointment')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="appt-customer">{t('crm.customer')}</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger id="appt-customer"><SelectValue placeholder={t('crm.customer')} /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appt-at">{t('crm.scheduledAt')}</Label>
              <Input
                id="appt-at"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appt-note">{t('crm.note')}</Label>
            <Input
              id="appt-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('crm.note')}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <span className="ms-2">{t('common.save')}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
