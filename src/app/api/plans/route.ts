/**
 * GET /api/plans
 *
 * Public-ish — lists all subscription plans with their prices and limits.
 * Used by the pricing display on the landing/login page and by the
 * super-admin billing panel's plan overview cards.
 *
 * No auth required: plan names and prices are marketing data, not tenant
 * secrets. (Per /upload/saas-billing.md, plans are platform-level config,
 * not per-tenant.) The route is still protected by the Next.js middleware
 * for API rate-limiting reasons, but does not require a session.
 */
import { listPlans } from '@/modules/billing/subscription.service'
import { ok, serverError } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const plans = await listPlans()
    return ok({ plans })
  } catch {
    return serverError('en')
  }
}
