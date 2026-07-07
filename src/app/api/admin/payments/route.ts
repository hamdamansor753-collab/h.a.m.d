/**
 * POST /api/admin/payments
 *
 * Super-admin only — records a manual payment for a tenant's subscription.
 * This is NOT a payment-gateway integration (Paymob/Fawry are a later
 * module); it's the platform owner manually recording a bank transfer,
 * InstaPay, cash, or Vodafone Cash payment they received outside the
 * system.
 *
 * Effects (all atomic in one `dbRaw.$transaction` inside the service):
 *  1. Creates a PaymentRecord row (audit trail: who recorded, how much,
 *     which method, when).
 *  2. Extends `subscription.currentPeriodEnd` by 1 month from
 *     max(currentPeriodEnd, now) — so a tenant who pays before their
 *     period ends doesn't lose paid days, and a tenant who pays late
 *     starts the new month from now.
 *  3. Sets `subscription.status` to ACTIVE (clears PAST_DUE / SUSPENDED).
 *
 * Authorization: `platform:admin` via `PLATFORM_ADMINS` env var.
 */
import { getSession } from '@/core/auth/session'
import { isPlatformAdmin } from '@/core/auth/platform-admin'
import { recordPayment } from '@/modules/billing/subscription.service'
import { recordPaymentSchema } from '@/lib/validations'
import { ok, unauthorized, platformAdminRequired, badRequest, mapError } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session?.user) {
    return unauthorized('en')
  }
  if (!isPlatformAdmin(session.user.email)) {
    return platformAdminRequired(session.user.locale || 'en')
  }
  try {
    const body = await req.json()
    const parsed = recordPaymentSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }
    const result = await recordPayment({
      subscriptionId: parsed.data.subscriptionId,
      amount: parsed.data.amount,
      method: parsed.data.method,
      recordedByUserId: session.user.id,
    })
    return ok(result, 201)
  } catch (err) {
    return mapError(err, session.user.locale || 'en')
  }
}
