'use client'

/**
 * Reminders bell — dropdown from the header bell icon.
 * Opens/closes on click, not fixed above content.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useI18n, useFormatDate } from '@/core/i18n/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bell, X, CheckCircle2 } from 'lucide-react'
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

export function RemindersBell() {
  const { t } = useI18n()
  const formatDate = useFormatDate()
  const [reminders, setReminders] = useState<DueReminder[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/reminders/due', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) return
      setReminders(await r.json())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function dismiss(id: string) {
    setReminders(prev => prev.filter(r => r.id !== id))
    toast.success(t('reminder.dismiss'))
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="sm"
        className="relative h-9 w-9 p-0"
        onClick={() => { setOpen(o => !o); if (!open) void load() }}
      >
        <Bell className="h-4 w-4" />
        {reminders.length > 0 && (
          <span className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-danger-foreground">
            {reminders.length}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute end-0 top-full mt-2 w-80 rounded-lg border border-border bg-popover shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium flex items-center gap-2">
              <Bell className="h-3.5 w-3.5" />
              {t('reminder.dueTitle')}
            </span>
            {reminders.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{reminders.length}</Badge>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto hamd-scroll">
            {loading ? (
              <div className="py-6 text-center text-xs text-muted-foreground">{t('common.loading')}</div>
            ) : reminders.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                {t('reminder.empty')}
              </div>
            ) : (
              reminders.slice(0, 10).map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-2 px-3 py-2 border-b border-border/50 last:border-0 hover:bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.appointment.customer.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatDate(r.appointment.scheduledAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {r.appointment.note && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{r.appointment.note}</div>}
                  </div>
                  <button onClick={() => dismiss(r.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
