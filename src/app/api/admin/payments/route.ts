/**
 * POST /api/admin/payments — super-admin only: record a manual payment
 *
 * Records a payment and extends the subscription's currentPeriodEnd.
 * Uses dbRaw (bypasses tenant scoping) — platform-level operation.
 *
 * Permission: platform:admin.
 *
 * runtime = 'nodejs' (Prisma). Auth + Zod.
 */
import { NextResponse } from 'next/server'
import { getSession } from '@/core/auth/session'
import { recordPayment } from '@/modules/saas/subscription.service'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paymentSchema = z.object({
  subscriptionId: z.string().min(1),
  amount: z.coerce.number().min(0),
  method: z.string().min(1).max(50),
  extendMonths: z.coerce.number().min(1).max(36).default(1),
})

export async function POST(req: Request) {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 })
  }

  if (!session.user.permissionKeys.includes('platform:admin')) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Platform admin access required' } }, { status: 403 })
  }

  try {
    const body = await req.json()
    const parsed = paymentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid input', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 }
      )
    }

    const result = await recordPayment({
      subscriptionId: parsed.data.subscriptionId,
      amount: parsed.data.amount,
      method: parsed.data.method,
      recordedByUserId: session.user.id,
      extendMonths: parsed.data.extendMonths,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: { code: 'INTERNAL', message: e instanceof Error ? e.message : 'Something went wrong' } }, { status: 500 })
  }
}
