'use client'

/**
 * Reminders widget — shows due reminders as a notification card.
 * Polls /api/reminders/due on mount and when the section changes.
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatDate } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bell, X } from 'lucide-react'
import { toast } from 'sonner'

interface DueReminder {
  id: string
  dueAt: string
  appointment: {
    id: string
    scheduledAt: string
    note: string | null
    customer: { id: string; name: string }
  }
}

interface Props {
  visible: boolean
}

export function RemindersWidget({ visible }: Props) {
  const { t } = useI18n()
  const formatDate = useFormatDate()
  const [reminders, setReminders] = useState<DueReminder[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/reminders/due', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) return
      setReminders(await r.json())
    } catch { /* silent — widget is non-critical */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (visible) void load()
  }, [visible, load])

  async function dismiss(id: string) {
    // Mark as sent via a direct PATCH (we don't have a dedicated endpoint,
    // but the appointment service has markReminderSent — for the widget,
    // we just remove it locally and show a toast).
    setReminders(prev => prev.filter(r => r.id !== id))
    toast.success(t('reminder.dismiss'))
  }

  if (!visible || loading || reminders.length === 0) return null

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-warning">
          <Bell className="h-4 w-4" />
          {t('reminder.dueTitle')}
          <Badge variant="secondary" className="text-[10px]">{reminders.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {reminders.slice(0, 5).map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-2 p-2 rounded bg-background/50">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{r.appointment.customer.name}</div>
              <div className="text-xs text-muted-foreground">
                {formatDate(r.appointment.scheduledAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
              {r.appointment.note && <div className="text-xs text-muted-foreground mt-0.5">{r.appointment.note}</div>}
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => dismiss(r.id)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
