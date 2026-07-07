/**
 * GET /api/reminders/due
 *
 * Returns all due reminders (dueAt <= now() AND sent = false) for the
 * current tenant. Used by the dashboard's "due reminders" widget.
 *
 * Per /upload/crm.md: Phase 5 builds the infrastructure only — no actual
 * SMS/WhatsApp/email sending. The endpoint returns the list for in-app
 * notification display.
 *
 * runtime = 'nodejs' (Prisma). Auth + permission (crm:read). Service-only.
 */
import { withTenantContext } from '@/core/auth/session'
import { getDueReminders } from '@/modules/crm/appointment.service'
import { ok, mapError } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async () => getDueReminders())
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
