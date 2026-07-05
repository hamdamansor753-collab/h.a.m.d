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
 *
 * Phase 1 addition: `prepareJournalEntry` is exported so that the invoice
 * service can reuse the SAME balance-check + account-verification logic
 * inside a `db.$transaction()` (for atomic invoice posting). The public
 * `createJournalEntry` function is unchanged in behavior — it delegates
 * to `prepareJournalEntry` then creates on `db`.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import { JournalBalanceError } from '@/lib/api'
import type { Prisma, PrismaClient } from '@prisma/client'

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

export interface JournalEntryInput {
  date: Date
  description: string
  sourceModule: string
  sourceRefId: string
  lines: Array<{ accountId: string; debit: number; credit: number }>
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
 * Prepare a journal entry for creation: balance check + account verification.
 * Returns the Prisma `create` parameters (data + include) ready to be passed
 * to `client.journalEntry.create(params)` where `client` is either `db` or
 * a transaction client (`tx`).
 *
 * IMPORTANT: includes `tenantId` explicitly in the data. This is required
 * because transaction clients (`tx` from `db.$transaction`) do NOT have
 * the tenant middleware installed — so `tenantId` must be in the data
 * itself. When using `db` (which has the middleware), the middleware
 * overwrites `tenantId` with the same value — no conflict.
 */
export async function prepareJournalEntry(input: JournalEntryInput): Promise<{
  data: {
    tenantId: string
    date: Date
    description: string
    sourceModule: string
    sourceRefId: string
    lines: { create: Array<{ accountId: string; debit: number; credit: number }> }
  }
  include: { lines: true }
}> {
  const ctx = getTenantContext()
  if (!ctx) {
    throw new JournalBalanceError('0', '0') // no tenant context
  }

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

  return {
    data: {
      tenantId: ctx.tenantId,
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
  }
}

/**
 * Create a balanced journal entry.
 * Permission: journal:create.
 *
 * Delegates to `prepareJournalEntry` for validation, then creates on `db`.
 * The create is a single Prisma operation (entry + nested lines) which
 * Prisma wraps in an implicit transaction.
 */
export async function createJournalEntry(input: JournalEntryInput): Promise<JournalEntryWithLines> {
  requirePermission('journal:create')
  const params = await prepareJournalEntry(input)
  const created = await db.journalEntry.create(params)
  return created as JournalEntryWithLines
}

/**
 * Create a balanced journal entry on a specific Prisma client (either `db`
 * or a transaction client `tx`). Used by `postInvoice` and `voidInvoice`
 * to create the journal entry INSIDE the same transaction as the invoice
 * status update — guaranteeing atomicity.
 *
 * Does NOT do a permission check — the caller (postInvoice/voidInvoice) is
 * responsible for checking `invoice:post` / `invoice:void`. This is by
 * design: the invoice service is the entry point, not the journal service.
 */
export async function createJournalEntryOn(
  client: PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  input: JournalEntryInput
): Promise<JournalEntryWithLines> {
  const params = await prepareJournalEntry(input)
  const created = await client.journalEntry.create(params as Parameters<typeof client.journalEntry.create>[0])
  return created as JournalEntryWithLines
}
