/**
 * GET  /api/appointments  — list appointments (with customer + reminders)
 * POST /api/appointments  — schedule a new appointment (+ reminder + activity log)
 *
 * runtime = 'nodejs' (Prisma). Zod-validated. Service-only Prisma.
 */
import { withTenantContext } from '@/core/auth/session'
import { listAppointments, scheduleAppointment } from '@/modules/crm/appointment.service'
import { scheduleAppointmentSchema } from '@/lib/validations'
import { ok, mapError, badRequest } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async () => listAppointments())
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = scheduleAppointmentSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }
    const result = await withTenantContext(async () =>
      scheduleAppointment({
        customerId: parsed.data.customerId,
        scheduledAt: new Date(parsed.data.scheduledAt),
        note: parsed.data.note,
      })
    )
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result, 201)
  } catch (err) {
    return mapError(err, 'en')
  }
}
