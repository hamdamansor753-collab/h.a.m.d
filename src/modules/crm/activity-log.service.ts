/**
 * CRM module — ActivityLog service.
 *
 * Per /upload/crm.md: ActivityLog is created AUTOMATICALLY by other services
 * (invoice.service, appointment.service) — there is NO public endpoint to
 * create it manually. This prevents forgetting to log an interaction.
 *
 * The `logActivity` function accepts an optional `tx` so it can run inside
 * the caller's transaction (same pattern as createJournalEntryOn).
 */
import { getTenantContext } from '@/core/tenancy/context'
import type { Prisma } from '@prisma/client'

export type ActivityType = 'invoice_created' | 'appointment_scheduled'

/**
 * Create an ActivityLog entry. Designed to be called from inside a
 * transaction (invoice.service, appointment.service) — accepts `tx`.
 *
 * When `tx` is provided: uses it directly with explicit tenantId.
 * When `tx` is NOT provided: uses db (with middleware).
 *
 * This function does NOT do a permission check — the caller (invoice/
 * appointment service) has already checked its own permissions.
 */
export async function logActivity(
  input: {
    customerId: string
    type: ActivityType
    refId: string
  },
  tx?: Prisma.TransactionClient
): Promise<void> {
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context for logActivity')

  const client = tx ?? (await import('@/lib/db')).db
  await (client as import('@prisma/client').PrismaClient).activityLog.create({
    data: {
      tenantId: ctx.tenantId, // explicit — required for tx, harmless for db
      customerId: input.customerId,
      type: input.type,
      refId: input.refId,
    },
  })
}

/**
 * List activity logs for a specific customer (or all customers if no ID).
 * Permission: crm:read.
 */
export async function listActivityLogs(customerId?: string) {
  const { requirePermission } = await import('@/core/rbac')
  const { db } = await import('@/lib/db')
  requirePermission('crm:read')
  return db.activityLog.findMany({
    where: customerId ? { customerId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { customer: { select: { id: true, name: true } } },
  })
}
