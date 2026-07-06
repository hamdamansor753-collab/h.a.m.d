'use client'

/**
 * Customers panel — list + create.
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'

interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
  createdAt: string
  _count: { invoices: number; appointments: number; activities: number }
}

interface Props {
  canManage: boolean
}

export function CustomersPanel({ canManage }: Props) {
  const { t } = useI18n()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/customers', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      setCustomers(await r.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold">{t('crm.title')}</h1>
            <p className="text-xs text-muted-foreground">{customers.length} {t('crm.title')}</p>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => setShowForm(s => !s)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span>{t('crm.createCustomer')}</span>
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <CustomerForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load() }} />
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t('crm.title')}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : customers.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('crm.empty')}</div>
          ) : (
            <div className="max-h-96 overflow-y-auto hamd-scroll">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2 py-1 border-b border-border">
                <div className="col-span-3">{t('crm.name')}</div>
                <div className="col-span-2">{t('crm.phone')}</div>
                <div className="col-span-3">{t('crm.email')}</div>
                <div className="col-span-1 text-center">{t('crm.invoices')}</div>
                <div className="col-span-1 text-center">{t('crm.appointments')}</div>
                <div className="col-span-2 text-center">{t('crm.activities')}</div>
              </div>
              {customers.map((c) => (
                <div key={c.id} className="grid grid-cols-12 gap-2 px-2 py-2 border-b border-border/50 text-sm items-center">
                  <div className="col-span-3 font-medium">{c.name}</div>
                  <div className="col-span-2 text-xs text-muted-foreground">{c.phone || '—'}</div>
                  <div className="col-span-3 text-xs text-muted-foreground">{c.email || '—'}</div>
                  <div className="col-span-1 text-center"><Badge variant="secondary" className="text-[10px]">{c._count.invoices}</Badge></div>
                  <div className="col-span-1 text-center"><Badge variant="secondary" className="text-[10px]">{c._count.appointments}</Badge></div>
                  <div className="col-span-2 text-center"><Badge variant="outline" className="text-[10px]">{c._count.activities}</Badge></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CustomerForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, phone: phone || undefined, email: email || undefined }),
      })
      const d = await r.json()
      if (!r.ok) { toast.error(d?.error?.message ?? t('common.error')); return }
      toast.success(t('crm.createCustomer'))
      onSaved()
    } catch { toast.error(t('common.error')) }
    finally { setSaving(false) }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('crm.createCustomer')}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cname">{t('crm.name')}</Label>
            <Input id="cname" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cphone">{t('crm.phone')}</Label>
            <Input id="cphone" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cemail">{t('crm.email')}</Label>
            <Input id="cemail" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="sm:col-span-3 flex justify-end gap-2 pt-2">
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
