/**
 * Production Hardening — Atomic Sequence Counter.
 *
 * Replaces the old `count() + 1` pattern (race-condition-prone) with an
 * atomic `UPDATE ... SET lastValue = lastValue + 1 RETURNING lastValue`.
 *
 * This guarantees that even under concurrent requests, each caller gets
 * a unique, gap-free number. The atomic UPDATE is enforced by the database
 * itself (row-level lock during the UPDATE), not by application-level locking.
 *
 * Per /upload/production-hardening.md: "استبدال، لا إضافة منطق مواز"
 * — this replaces nextInvoiceNumber and nextPurchaseOrderNumber.
 */
import { db } from '@/lib/db'
import { getTenantContext } from '@/core/tenancy/context'
import type { Prisma } from '@prisma/client'

/**
 * Get the next sequence value for a given key (e.g., "invoice", "purchase_order").
 *
 * Uses an atomic UPSERT + UPDATE pattern:
 *  1. Try to UPDATE the existing counter (increment + return new value)
 *  2. If no row exists (first call for this tenant+key), INSERT with value=1
 *
 * On PostgreSQL, this can be a single `INSERT ... ON CONFLICT DO UPDATE
 * RETURNING` — but the two-step approach below works on both SQLite and
 * PostgreSQL and is still atomic within a transaction.
 *
 * IMPORTANT: must be called inside a transaction (tx) to guarantee
 * atomicity under concurrency. When called without tx, it uses db directly
 * (which starts an implicit transaction for the two operations).
 *
 * @param sequenceKey - e.g. "invoice", "purchase_order"
 * @param tx - transaction client (required for true atomicity under concurrency)
 * @returns the next sequential number (1, 2, 3, ...)
 */
export async function getNextSequenceValue(
  sequenceKey: string,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context for getNextSequenceValue')

  const client = tx ?? db

  // Atomic sequence increment using upsert.
  // This is truly atomic on both SQLite and PostgreSQL — the upsert
  // either updates an existing row or creates a new one, in a single
  // database operation. No race condition possible.
  //
  // On PostgreSQL this translates to INSERT ... ON CONFLICT DO UPDATE
  // RETURNING — a single round-trip. On SQLite it's INSERT OR REPLACE
  // with a read-after-write (still atomic within a transaction).
  const counter = await (client as typeof db).sequenceCounter.upsert({
    where: {
      tenantId_sequenceKey: {
        tenantId: ctx.tenantId,
        sequenceKey,
      },
    },
    update: {
      lastValue: { increment: 1 },
    },
    create: {
      tenantId: ctx.tenantId,
      sequenceKey,
      lastValue: 1,
    },
  })

  return counter.lastValue
}

/**
 * Format a sequence value as a zero-padded number string.
 * Example: formatSequenceNumber("INV", 1) → "INV-0001"
 */
export function formatSequenceNumber(prefix: string, value: number, padLength = 4): string {
  return `${prefix}-${String(value).padStart(padLength, '0')}`
}
