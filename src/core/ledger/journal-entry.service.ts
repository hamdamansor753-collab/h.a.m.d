/**
 * Ledger — JournalEntry service.
 *
 * MANDATORY rule (per /upload/04-data-model.md note 3 and
 * /upload/05-security-baseline.md): every JournalEntry is verified to
 * satisfy SUM(debit) === SUM(credit) BEFORE any DB write. Unbalanced
 * entries are rejected with JournalBalanceError.
 *
 * The check runs in the service layer (not the DB) so the error is
 * raised before any row is created — no partial state, no cleanup needed.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { JournalBalanceError } from '@/lib/api'
import type { Prisma } from '@prisma/client'

export interface JournalEntryWithLines {
  id: string
  tenantId: string
  date: Date
  description: string
  sourceModule: string
  sourceRefId: string
  createdAt: Date
  lines: Array<{
    id: string
    accountId: string
    debit: Prisma.Decimal
    credit: Prisma.Decimal
  }>
}

/**
 * Verify the double-entry invariant: total debit === total credit.
 * Throws JournalBalanceError on violation. Uses integer-cent math to
 * avoid floating-point drift.
 */
export function assertBalanced(lines: Array<{ debit: number; credit: number }>): void {
  const toCents = (v: number) => Math.round(v * 100)
  const debitCents = lines.reduce((s, l) => s + toCents(l.debit), 0)
  const creditCents = lines.reduce((s, l) => s + toCents(l.credit), 0)
  if (debitCents !== creditCents) {
    throw new JournalBalanceError(
      (debitCents / 100).toFixed(2),
      (creditCents / 100).toFixed(2)
    )
  }
}

/**
 * List journal entries for the current tenant, most recent first.
 * Permission: journal:read.
 */
export async function listJournalEntries(limit = 50): Promise<JournalEntryWithLines[]> {
  requirePermission('journal:read')
  const entries = await db.journalEntry.findMany({
    orderBy: { date: 'desc' },
    take: limit,
    include: { lines: true },
  })
  return entries as JournalEntryWithLines[]
}

/**
 * Create a balanced journal entry.
 * Permission: journal:create.
 *
 * Steps:
 *  1. RBAC check (service-layer).
 *  2. Validate balance (sum debit === sum credit) — reject if not.
 *  3. Verify every line's accountId belongs to the current tenant
 *     (the Prisma middleware scopes the findMany, so accounts in other
 *     tenants simply won't appear — we reject if any are missing).
 *  4. Atomic create (JournalEntry + JournalLines) in a single transaction.
 */
export async function createJournalEntry(input: {
  date: Date
  description: string
  sourceModule: string
  sourceRefId: string
  lines: Array<{ accountId: string; debit: number; credit: number }>
}): Promise<JournalEntryWithLines> {
  requirePermission('journal:create')

  // 1. Balance check BEFORE any DB write.
  assertBalanced(input.lines)

  // 2. Verify all accounts belong to the current tenant.
  const accountIds = Array.from(new Set(input.lines.map((l) => l.accountId)))
  const accounts = await db.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true },
  })
  if (accounts.length !== accountIds.length) {
    // One or more accounts either don't exist or belong to another tenant.
    // Either way: reject. We do NOT echo which IDs were bad — that leaks
    // tenant boundary info.
    throw new JournalBalanceError('0', '0') // reused as a generic rejection
  }

  // 3. Atomic write.
  const created = await db.journalEntry.create({
    data: {
      date: input.date,
      description: input.description,
      sourceModule: input.sourceModule,
      sourceRefId: input.sourceRefId,
      lines: {
        create: input.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
        })),
      },
    },
    include: { lines: true },
  })
  return created as JournalEntryWithLines
}
