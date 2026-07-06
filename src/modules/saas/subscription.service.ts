/**
 * SaaS Billing — Subscription service.
 *
 * Per /upload/saas-billing.md:
 *  - Central enforcement via requireActiveSubscription() — called ONCE in
 *    withTenantContext, NOT in every service.
 *  - SUSPENDED: GET allowed, writes rejected (402).
 *  - CANCELLED: all access rejected (402).
 *  - TRIALING / ACTIVE / PAST_DUE: full access.
 *
 * Usage limits (maxUsers, maxInvoicesPerMonth) are checked separately in
 * the relevant services (user creation, invoice creation) — they are
 * quantitative limits, not subscription state.
 */
import { db, dbRaw } from '@/lib/db'
import type { Subscription, Plan, SubscriptionStatus } from '@prisma/client'

/** Thrown when a tenant's subscription doesn't allow writes. */
export class SubscriptionSuspendedError extends Error {
  constructor(public status: SubscriptionStatus) {
    super(`Subscription is ${status} — ${status === 'SUSPENDED' ? 'read-only mode' : 'no access'}`)
    this.name = 'SubscriptionSuspendedError'
  }
}

/**
 * Central enforcement function. Called ONCE per request in withTenantContext.
 *
 * - TRIALING / ACTIVE / PAST_DUE → allow all
 * - SUSPENDED → allow GET, reject writes (throw → 402)
 * - CANCELLED → reject everything (throw → 402)
 */
export function requireActiveSubscription(
  subscription: Subscription | null,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
): void {
  if (!subscription) {
    // No subscription record → allow (backward compat for tenants created
    // before Phase 8, or during testing). In production, every tenant should
    // have a subscription created during onboarding.
    return
  }

  switch (subscription.status) {
    case 'TRIALING':
    case 'ACTIVE':
    case 'PAST_DUE':
      return // full access
    case 'SUSPENDED':
      if (method === 'GET') return // read-only allowed
      throw new SubscriptionSuspendedError('SUSPENDED')
    case 'CANCELLED':
      throw new SubscriptionSuspendedError('CANCELLED')
  }
}

/**
 * Get the subscription for a tenant (via dbRaw to bypass tenant scoping —
 * the Subscription table is platform-level, not tenant-scoped).
 *
 * On PostgreSQL with RLS enabled, the Subscription table has RLS policies
 * that filter by tenant context. Since Subscription is platform-level
 * (not tenant-scoped), we need to bypass RLS. We do this by running the
 * query with `SET LOCAL row_security = off` before the query.
 */
export async function getSubscription(tenantId: string): Promise<Subscription | null> {
  try {
    // Temporarily disable RLS for this platform-level query
    await dbRaw.$executeRawUnsafe('SET LOCAL row_security = off')
  } catch {
    // SQLite or no RLS — ignore
  }
  return dbRaw.subscription.findUnique({
    where: { tenantId },
  })
}

/**
 * Create a subscription for a new tenant.
 * Called during tenant onboarding (NOT during normal operation).
 */
export async function createSubscription(input: {
  tenantId: string
  planId: string
  trialDays?: number
}): Promise<Subscription> {
  const trialDays = input.trialDays ?? 14
  const now = new Date()
  const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)

  return dbRaw.subscription.create({
    data: {
      tenantId: input.tenantId,
      planId: input.planId,
      status: 'TRIALING',
      currentPeriodEnd: trialEnd,
      trialEndsAt: trialEnd,
    },
  })
}

/**
 * Record a manual payment and extend the subscription.
 * Called by super-admin only via /api/admin/payments.
 */
export async function recordPayment(input: {
  subscriptionId: string
  amount: number
  method: string
  recordedByUserId: string
  extendMonths: number
}): Promise<{ subscription: Subscription; payment: import('@prisma/client').PaymentRecord }> {
  const sub = await dbRaw.subscription.findUnique({
    where: { id: input.subscriptionId },
  })
  if (!sub) throw new Error('Subscription not found')

  // Extend from current period end (or now if expired)
  const base = sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date()
  const newPeriodEnd = new Date(base.getTime() + input.extendMonths * 30 * 24 * 60 * 60 * 1000)

  const payment = await dbRaw.paymentRecord.create({
    data: {
      subscriptionId: input.subscriptionId,
      amount: input.amount,
      method: input.method,
      recordedByUserId: input.recordedByUserId,
      periodExtendedTo: newPeriodEnd,
    },
  })

  const updated = await dbRaw.subscription.update({
    where: { id: input.subscriptionId },
    data: {
      status: 'ACTIVE',
      currentPeriodEnd: newPeriodEnd,
    },
  })

  return { subscription: updated, payment }
}

/**
 * Get all tenants with their subscription status (super-admin only).
 * Uses dbRaw to bypass tenant scoping entirely.
 */
export async function listAllTenantsWithSubscriptions() {
  const tenants = await dbRaw.tenant.findMany({
    include: {
      subscription: {
        include: { plan: true },
      },
      _count: { select: { users: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return tenants
}

/**
 * Get a plan by key (e.g., "starter").
 */
export async function getPlanByKey(key: string): Promise<Plan | null> {
  return dbRaw.plan.findUnique({ where: { key } })
}

// ---------- Usage limits ----------

/**
 * Check if a tenant can create more users (maxUsers limit).
 * Returns true if allowed, false if limit reached.
 */
export async function checkMaxUsers(tenantId: string): Promise<{ allowed: boolean; current: number; max: number }> {
  const sub = await getSubscription(tenantId)
  if (!sub) return { allowed: true, current: 0, max: Infinity }

  const plan = await dbRaw.plan.findUnique({ where: { id: sub.planId } })
  if (!plan) return { allowed: true, current: 0, max: Infinity }

  const userCount = await dbRaw.user.count({ where: { tenantId } })
  return {
    allowed: userCount < plan.maxUsers,
    current: userCount,
    max: plan.maxUsers,
  }
}

/**
 * Check if a tenant can create more invoices this month (maxInvoicesPerMonth limit).
 * Returns true if allowed, false if limit reached.
 */
export async function checkMaxInvoices(tenantId: string): Promise<{ allowed: boolean; current: number; max: number | null }> {
  const sub = await getSubscription(tenantId)
  if (!sub) return { allowed: true, current: 0, max: null }

  const plan = await dbRaw.plan.findUnique({ where: { id: sub.planId } })
  if (!plan || plan.maxInvoicesPerMonth === null) return { allowed: true, current: 0, max: null }

  // Count invoices created this month
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const invoiceCount = await dbRaw.invoice.count({
    where: {
      tenantId,
      createdAt: { gte: monthStart },
    },
  })

  return {
    allowed: invoiceCount < plan.maxInvoicesPerMonth,
    current: invoiceCount,
    max: plan.maxInvoicesPerMonth,
  }
}
