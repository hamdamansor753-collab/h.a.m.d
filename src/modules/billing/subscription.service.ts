/**
 * Phase 8 — SaaS Billing & Subscriptions service.
 *
 * This module manages the H.A.M.D platform's OWN subscriptions (i.e. the
 * tenants are the customers here, NOT the tenant's customers). It is
 * therefore fundamentally cross-tenant and uses `dbRaw` for ALL Prisma
 * access — never the tenant-scoped `db` Proxy. See /upload/saas-billing.md
 * and /tmp/speckit/speckit/ai-guide/phase8-prompt.md.
 *
 * Central enforcement contract (per spec §"نقطة تنفيذ واحدة، نفس فلسفة RLS"):
 *  - `requireActiveSubscription(subscription, method)` is the SINGLE place
 *    that decides whether a request may proceed based on subscription state.
 *  - It is called once from `withTenantContext` in `src/core/auth/session.ts`
 *    — NEVER duplicated in any other service.
 *
 * State matrix:
 *   TRIALING  → allow all
 *   ACTIVE    → allow all
 *   PAST_DUE  → allow all (UI shows a warning banner; grace period)
 *   SUSPENDED → GET allowed (data is the customer's property); writes throw
 *               SubscriptionSuspendedError → HTTP 402
 *   CANCELLED → throw on ALL methods (no access at all)
 */
import { dbRaw } from '@/lib/db'
import type { Subscription, Plan, SubscriptionStatus, Tenant, PaymentRecord } from '@prisma/client'

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown by `requireActiveSubscription` when a write is attempted on a
 * SUSPENDED subscription, or ANY access on a CANCELLED subscription.
 * Mapped to HTTP 402 Payment Required by `mapError` in `src/lib/api.ts`.
 */
export class SubscriptionSuspendedError extends Error {
  statusCode = 402 as const
  code: 'SUSPENDED' | 'CANCELLED'
  constructor(
    code: 'SUSPENDED' | 'CANCELLED',
    message = 'Subscription is suspended or cancelled'
  ) {
    super(message)
    this.name = 'SubscriptionSuspendedError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** Subscription with its Plan included — the shape returned by getSubscription. */
export type SubscriptionWithPlan = Subscription & { plan: Plan }

/** A tenant row joined with its subscription + plan, for the super-admin list. */
export interface TenantWithSubscription {
  id: string
  name: string
  defaultLocale: string
  country: string
  businessType: string
  createdAt: Date
  subscription: (Subscription & { plan: Plan }) | null
}

export interface RecordPaymentInput {
  subscriptionId: string
  amount: number
  method: string // 'bank_transfer' | 'instapay' | 'cash' | 'vodafone_cash'
  recordedByUserId: string
}

export interface RecordPaymentResult {
  paymentRecord: PaymentRecord
  subscription: SubscriptionWithPlan
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Length of the free trial for newly-created tenants, in days. */
export const TRIAL_DAYS = 14

/** Default plan key used when none is specified for a new tenant. */
export const DEFAULT_PLAN_KEY = 'starter'

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Get the subscription for a tenant, with its plan. Returns null if the
 * tenant has no subscription row yet (pre-Phase 8 tenants, or a brand-new
 * tenant before `createSubscriptionForNewTenant` has run).
 *
 * Uses `dbRaw` because Subscription is a platform-level table (cross-tenant
 * by design — the super-admin must be able to read every tenant's subscription).
 */
export async function getSubscription(tenantId: string): Promise<SubscriptionWithPlan | null> {
  const sub = await dbRaw.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  })
  return sub
}

/**
 * Get a subscription by its primary key (used by recordPayment which receives
 * subscriptionId from the super-admin panel).
 */
export async function getSubscriptionById(
  subscriptionId: string
): Promise<SubscriptionWithPlan | null> {
  return dbRaw.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  })
}

// ---------------------------------------------------------------------------
// Central enforcement
// ---------------------------------------------------------------------------

/**
 * THE single enforcement point for subscription state.
 *
 * Called once from `withTenantContext` (in src/core/auth/session.ts) for
 * every authenticated request. Throws `SubscriptionSuspendedError` (→ 402)
 * when the caller's subscription state disallows the requested HTTP method.
 *
 *   TRIALING / ACTIVE / PAST_DUE → return (allow)
 *   SUSPENDED  + GET  → return (allow read; customer's data is their own)
 *   SUSPENDED  + write → throw SubscriptionSuspendedError('SUSPENDED')
 *   CANCELLED  (any)  → throw SubscriptionSuspendedError('CANCELLED')
 */
export function requireActiveSubscription(
  subscription: Subscription,
  method: HttpMethod
): void {
  const status: SubscriptionStatus = subscription.status
  if (status === 'TRIALING' || status === 'ACTIVE' || status === 'PAST_DUE') {
    return
  }
  if (status === 'SUSPENDED') {
    if (method === 'GET') return // read-only access allowed
    throw new SubscriptionSuspendedError('SUSPENDED')
  }
  // CANCELLED — no access at all, regardless of method
  throw new SubscriptionSuspendedError('CANCELLED')
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Record a manual payment for a subscription. This:
 *  1. Loads the current subscription (with plan).
 *  2. Computes the new period end = max(currentPeriodEnd, now) + 1 month.
 *     (If the previous period already lapsed, we start the new month from
 *      now; otherwise we extend from the existing end so the customer
 *      doesn't lose paid days.)
 *  3. Creates a PaymentRecord row (audit trail).
 *  4. Updates the subscription: status → ACTIVE, currentPeriodEnd → new end.
 *
 * All in a single `dbRaw.$transaction` so the audit row and the state
 * change commit atomically.
 */
export async function recordPayment(
  input: RecordPaymentInput
): Promise<RecordPaymentResult> {
  const { subscriptionId, amount, method, recordedByUserId } = input

  return dbRaw.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    })
    if (!sub) {
      throw new SubscriptionSuspendedError('CANCELLED', 'Subscription not found')
    }

    const now = new Date()
    const base = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now
    const newPeriodEnd = new Date(base)
    // Add exactly one calendar month. Setting month+1 handles year rollover
    // correctly via JS Date semantics (month is 0-indexed, setter normalizes).
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1)

    const paymentRecord = await tx.paymentRecord.create({
      data: {
        subscriptionId,
        amount,
        method,
        recordedByUserId,
        periodExtendedTo: newPeriodEnd,
      },
    })

    const updated = await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'ACTIVE',
        currentPeriodEnd: newPeriodEnd,
      },
      include: { plan: true },
    })

    return { paymentRecord, subscription: updated }
  })
}

/**
 * Create a TRIALING subscription for a new tenant. Called from the tenant
 * onboarding flow (or the seed script for pre-existing tenants that should
 * now have subscriptions).
 *
 * - Default plan: 'starter' (overridable via planKey).
 * - Trial length: TRIAL_DAYS (14) days from now.
 * - currentPeriodEnd is set to trialEndsAt; once the trial ends, the
 *   super-admin records the first payment to flip status → ACTIVE and
 *   extend currentPeriodEnd by 1 month.
 *
 * Idempotent: if the tenant already has a subscription, returns the
 * existing one unchanged.
 */
export async function createSubscriptionForNewTenant(
  tenantId: string,
  planKey: string = DEFAULT_PLAN_KEY
): Promise<SubscriptionWithPlan> {
  const existing = await dbRaw.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  })
  if (existing) return existing

  const plan = await dbRaw.plan.findUnique({ where: { key: planKey } })
  if (!plan) {
    throw new Error(`Plan not found: ${planKey}. Seed the Plan table first.`)
  }

  const now = new Date()
  const trialEndsAt = new Date(now)
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS)

  return dbRaw.subscription.create({
    data: {
      tenantId,
      planId: plan.id,
      status: 'TRIALING',
      currentPeriodEnd: trialEndsAt,
      trialEndsAt,
    },
    include: { plan: true },
  })
}

// ---------------------------------------------------------------------------
// Super-admin reads (platform:admin only — enforced at the route layer)
// ---------------------------------------------------------------------------

/**
 * List ALL tenants with their subscription + plan. Used by the super-admin
 * billing panel. This is a cross-tenant read — uses `dbRaw` directly.
 *
 * Tenants without a subscription appear with `subscription: null` (so the
 * UI can show them and offer to create one).
 */
export async function listAllTenantsWithSubscriptions(): Promise<TenantWithSubscription[]> {
  const tenants = await dbRaw.tenant.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      subscription: { include: { plan: true } },
    },
  })
  return tenants.map((t: Tenant & { subscription: (Subscription & { plan: Plan }) | null }) => ({
    id: t.id,
    name: t.name,
    defaultLocale: t.defaultLocale,
    country: t.country,
    businessType: t.businessType,
    createdAt: t.createdAt,
    subscription: t.subscription,
  }))
}

/**
 * List all plans, ordered by monthlyPrice ascending. Used by the public
 * pricing endpoint and the super-admin panel's plan overview.
 */
export async function listPlans(): Promise<Plan[]> {
  return dbRaw.plan.findMany({
    orderBy: { monthlyPrice: 'asc' },
  })
}
