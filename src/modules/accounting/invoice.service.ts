/**
 * Accounting module — Invoice service.
 *
 * Implements /upload/accounting.md:
 *  - CRUD for DRAFT invoices (free edit/delete while DRAFT)
 *  - postInvoice: calculate tax via TaxProvider → build balanced JE via
 *    prepareJournalEntry (reused from Phase 0) → atomic update in a single
 *    transaction. No direct tax calculation or balance logic here.
 *  - voidInvoice: reversing JE (debit↔credit swap), no deletion
 *  - POSTED invoices are immutable — any edit/delete is rejected
 *
 * Per /upload/05-security-baseline.md: permission checks happen in the
 * service layer, not just the UI. No direct Prisma access from routes.
 */
import { db } from '@/lib/db'
import { dbRaw } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import { prepareJournalEntry, createJournalEntryOn, type JournalEntryInput } from '@/core/ledger/journal-entry.service'
import { getTaxProvider, type TaxResult } from '@/core/ledger/tax-provider'
import { getNextSequenceValue, formatSequenceNumber } from '@/core/sequence/service'
import { InvoiceStateError, InvoiceConfigError } from '@/lib/api'
import type { Invoice, InvoiceLine, Prisma } from '@prisma/client'

// ---------- Types ----------

export interface InvoiceWithLines extends Invoice {
  lines: InvoiceLine[]
}

export interface InvoiceWithDetails extends Invoice {
  lines: InvoiceLine[]
  journalEntry?: { id: string; description: string; date: Date } | null
  voidJournalEntry?: { id: string; description: string; date: Date } | null
}

// ---------- Account resolution ----------
//
// The invoice service needs 3 ledger accounts to post an invoice:
//   1. AR (Accounts Receivable) — ASSET — debited for the full total
//   2. Revenue — REVENUE — credited for the base (pre-tax) amount
//   3. Sales Tax Payable — LIABILITY — credited for the tax amount
//
// Phase 1 resolves these by nameKey convention (the seed creates exactly
// one account per nameKey per tenant). A future phase will add an explicit
// "default accounts" config per tenant.

const AR_NAME_KEY = 'account.receivable'
const REVENUE_NAME_KEY = 'account.revenue'
const TAX_NAME_KEY = 'account.salesTax'

async function resolvePostingAccounts(
  client: Prisma.TransactionClient | typeof db = db,
  tenantId?: string
) {
  const where = (nameKey: string) => tenantId ? { nameKey, tenantId } : { nameKey }
  const [ar, revenue, tax] = await Promise.all([
    (client as typeof db).account.findFirst({ where: where(AR_NAME_KEY) }),
    (client as typeof db).account.findFirst({ where: where(REVENUE_NAME_KEY) }),
    (client as typeof db).account.findFirst({ where: where(TAX_NAME_KEY) }),
  ])

  if (!ar || !revenue || !tax) {
    throw new InvoiceConfigError(
      'Missing required posting accounts. Ensure the seed created accounts with nameKeys: ' +
        `${AR_NAME_KEY}, ${REVENUE_NAME_KEY}, ${TAX_NAME_KEY}`
    )
  }

  return { ar, revenue, tax }
}

// ---------- Sequential numbering ----------

/**
 * Generate the next sequential invoice number for the current tenant.
 * Format: INV-0001, INV-0002, ...
 *
 * Production Hardening: uses the atomic SequenceCounter (UPDATE...RETURNING)
 * instead of the old count()+1 pattern. This is race-free under concurrency.
 *
 * Accepts an optional client (tx or db) + tenantId. When using tx, the
 * tenantId MUST be passed explicitly (tx has no middleware).
 */
async function nextInvoiceNumber(
  client: Prisma.TransactionClient | typeof db = db
): Promise<string> {
  const value = await getNextSequenceValue('invoice', client)
  return formatSequenceNumber('INV', value)
}

// ---------- CRUD: DRAFT ----------

/**
 * List all invoices for the current tenant, most recent first.
 * Permission: invoice:read.
 */
export async function listInvoices(): Promise<InvoiceWithLines[]> {
  requirePermission('invoice:read')
  return db.invoice.findMany({
    orderBy: { createdAt: 'desc' },
    include: { lines: true },
  })
}

/**
 * Get a single invoice by ID (scoped to current tenant).
 * Permission: invoice:read.
 */
export async function getInvoice(id: string): Promise<InvoiceWithDetails | null> {
  requirePermission('invoice:read')
  return db.invoice.findUnique({
    where: { id },
    include: {
      lines: true,
      journalEntry: { select: { id: true, description: true, date: true } },
      voidJournalEntry: { select: { id: true, description: true, date: true } },
    },
  })
}

/**
 * Create a new DRAFT invoice.
 * Permission: invoice:create (skipped when tx is provided — caller handles it).
 *
 * Phase 3 addition: optional `channel` parameter (defaults to MANUAL).
 * Phase 3 atomicity fix: optional `tx` parameter. When provided, the
 * function runs inside the caller's transaction (no own permission check,
 * uses tx with explicit tenantId). When not provided, uses db (with
 * middleware) as before.
 * Phase 5 addition: optional `customerId` parameter. When provided, an
 * ActivityLog entry (type: 'invoice_created') is created automatically
 * inside the same transaction. When not provided (walk-in sale), no
 * ActivityLog is created — the invoice still works exactly as before.
 */
export async function createInvoice(
  input: {
    customerName: string
    date: Date
    lines: Array<{ description: string; amount: number; taxRate?: number }>
    channel?: 'MANUAL' | 'POS'
    customerId?: string
  },
  tx?: Prisma.TransactionClient
): Promise<InvoiceWithLines> {
  if (!tx) requirePermission('invoice:create')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  const client = tx ?? db
  const number = await nextInvoiceNumber(client)

  const invoice = await (client as typeof db).invoice.create({
    data: {
      tenantId: ctx.tenantId, // explicit — required for tx, harmless for db
      number,
      customerName: input.customerName,
      date: input.date,
      status: 'DRAFT',
      channel: input.channel ?? 'MANUAL',
      // Phase 5: optional customer link (null for walk-in sales)
      customerId: input.customerId ?? null,
      lines: {
        create: input.lines.map((l) => ({
          description: l.description,
          amount: l.amount,
          taxRate: l.taxRate ?? 0,
        })),
      },
    },
    include: { lines: true },
  })

  // Phase 5: if a customer is linked, log the activity automatically.
  // This runs inside the same transaction (tx) if provided, ensuring
  // atomicity: if the invoice creation rolls back, the activity log
  // rolls back too.
  if (input.customerId) {
    // Dynamic import to avoid circular dependency at module load time
    const { logActivity } = await import('@/modules/crm/activity-log.service')
    await logActivity(
      {
        customerId: input.customerId,
        type: 'invoice_created',
        refId: invoice.id,
      },
      tx
    )
  }

  return invoice
}

/**
 * Update a DRAFT invoice. Refuses if the invoice is POSTED or VOID.
 * Permission: invoice:create (editing a draft is the same permission as
 * creating one).
 */
export async function updateInvoice(
  id: string,
  input: {
    customerName?: string
    date?: Date
    lines?: Array<{ description: string; amount: number; taxRate?: number }>
  }
): Promise<InvoiceWithLines> {
  requirePermission('invoice:create')

  // Fetch and verify DRAFT status. The findUnique is scoped by the
  // middleware — if the ID belongs to another tenant, returns null → 404.
  const existing = await db.invoice.findUnique({
    where: { id },
    include: { lines: true },
  })
  if (!existing) throw new InvoiceStateError('NOT_DRAFT', 'Invoice not found')
  if (existing.status !== 'DRAFT') {
    throw new InvoiceStateError('NOT_DRAFT', `Cannot edit invoice in status ${existing.status}`)
  }

  // Build the update data. If lines are provided, replace all existing lines.
  const data: Record<string, unknown> = {}
  if (input.customerName !== undefined) data.customerName = input.customerName
  if (input.date !== undefined) data.date = input.date
  if (input.lines !== undefined) {
    // Delete old lines and create new ones in the same update.
    data.lines = {
      deleteMany: {},
      create: input.lines.map((l) => ({
        description: l.description,
        amount: l.amount,
        taxRate: l.taxRate ?? 0,
      })),
    }
  }

  return db.invoice.update({
    where: { id },
    data,
    include: { lines: true },
  })
}

/**
 * Delete a DRAFT invoice. Refuses if POSTED or VOID.
 * Permission: invoice:create (same as edit — if you can create, you can
 * delete your own draft).
 */
export async function deleteInvoice(id: string): Promise<void> {
  requirePermission('invoice:create')
  const existing = await db.invoice.findUnique({ where: { id } })
  if (!existing) throw new InvoiceStateError('NOT_DRAFT', 'Invoice not found')
  if (existing.status !== 'DRAFT') {
    throw new InvoiceStateError('NOT_DRAFT', `Cannot delete invoice in status ${existing.status}`)
  }
  await db.invoice.delete({ where: { id } })
}

// ---------- Posting ----------

/**
 * Post a DRAFT invoice to the ledger.
 *
 * Phase 3 atomicity fix: optional `tx` parameter. When provided:
 *  - Skips permission check (caller — e.g. posSale — handles permissions)
 *  - Uses tx for all reads + writes (with explicit tenantId)
 *  - Does NOT start its own $transaction — runs inside the caller's tx
 * When not provided: standalone behavior (permission check + own $transaction)
 *
 * Permission: invoice:post (skipped when tx is provided).
 */
export async function postInvoice(
  id: string,
  options?: { debitAccountId?: string },
  tx?: Prisma.TransactionClient
): Promise<{ invoice: InvoiceWithLines; journalEntryId: string; tax: TaxResult }> {
  if (!tx) requirePermission('invoice:post')

  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  const client = tx ?? db

  // 1. Fetch + verify DRAFT (explicit tenantId for tx)
  const invoice = await (client as typeof db).invoice.findUnique({
    where: { id, tenantId: ctx.tenantId },
    include: { lines: true },
  })
  if (!invoice) throw new InvoiceStateError('NOT_DRAFT', 'Invoice not found')
  if (invoice.status !== 'DRAFT') {
    throw new InvoiceStateError('NOT_DRAFT', `Cannot post invoice in status ${invoice.status}`)
  }
  if (invoice.lines.length === 0) {
    throw new InvoiceStateError('NOT_DRAFT', 'Cannot post invoice with no lines')
  }

  // 2. Resolve accounts (pass client + tenantId for tx)
  const { ar, revenue, tax: taxAccount } = await resolvePostingAccounts(client, ctx.tenantId)
  const debitAccount = options?.debitAccountId ? { id: options.debitAccountId } : ar

  // 3. Get the tenant's country to select the TaxProvider
  const tenant = await dbRaw.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { country: true },
  })
  const provider = getTaxProvider(tenant?.country ?? 'EG')
  if (!provider) {
    throw new InvoiceConfigError(`No TaxProvider registered for country ${tenant?.country}`)
  }

  // 4. Calculate tax via the provider — no direct tax math in this service
  const taxResult = provider.calculateTax({
    countryCode: provider.countryCode,
    lines: invoice.lines.map((l) => ({
      amount: Number(l.amount),
      taxRate: Number(l.taxRate) || undefined,
      description: l.description,
    })),
  })

  // 5. Build the balanced JE input
  const jeInput: JournalEntryInput = {
    date: invoice.date,
    description: `Invoice ${invoice.number} — ${invoice.customerName}`,
    sourceModule: 'accounting',
    sourceRefId: invoice.id,
    lines: [
      // Debit {debitAccount} (AR for manual, Cash for POS) for the full total
      { accountId: debitAccount.id, debit: taxResult.total, credit: 0 },
      // Credit Revenue for the base
      { accountId: revenue.id, debit: 0, credit: taxResult.totalBase },
      // Credit Tax Payable for the tax (only if tax > 0)
      ...(taxResult.totalTax > 0
        ? [{ accountId: taxAccount.id, debit: 0, credit: taxResult.totalTax }]
        : []),
    ],
  }

  // 6. Create JE + update invoice.
  //    When tx is provided: use it directly (we're inside the caller's tx).
  //    When tx is NOT provided: start our own $transaction.
  //    In both cases, tenantId is explicit in the where clause (tx has no middleware).
  const doPost = async (c: Prisma.TransactionClient): Promise<{ invoice: InvoiceWithLines; journalEntryId: string }> => {
    const je = await createJournalEntryOn(c, jeInput)
    const updated = await c.invoice.update({
      where: { id, tenantId: ctx.tenantId },
      data: {
        status: 'POSTED',
        journalEntryId: je.id,
      },
      include: { lines: true },
    })
    return { invoice: updated, journalEntryId: je.id }
  }

  const result = tx ? await doPost(tx) : await db.$transaction(doPost)
  return { ...result, tax: taxResult }
}

// ---------- Voiding ----------

/**
 * Void a POSTED invoice with a reversing journal entry.
 *
 * Creates a new JournalEntry that is the exact mirror of the original
 * (debit↔credit swapped), then sets invoice.status = VOID and links
 * voidJournalEntryId. The original JE is NOT deleted — it stays for audit.
 *
 * Permission: invoice:void.
 */
export async function voidInvoice(id: string): Promise<{ invoice: InvoiceWithLines; voidJournalEntryId: string }> {
  requirePermission('invoice:void')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  // 1. Fetch + verify POSTED
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: { lines: true, journalEntry: { include: { lines: true } } },
  })
  if (!invoice) throw new InvoiceStateError('NOT_POSTED', 'Invoice not found')
  if (invoice.status !== 'POSTED') {
    throw new InvoiceStateError('NOT_POSTED', `Cannot void invoice in status ${invoice.status}`)
  }
  if (invoice.status === 'VOID') {
    throw new InvoiceStateError('ALREADY_VOID', 'Invoice is already voided')
  }
  if (!invoice.journalEntry) {
    throw new InvoiceStateError('NOT_POSTED', 'Invoice has no posted journal entry')
  }

  // 2. Build the reversing JE: swap debit/credit on every line
  const originalLines = invoice.journalEntry.lines
  const reversingInput: JournalEntryInput = {
    date: new Date(),
    description: `VOID — Reversal of ${invoice.number}`,
    sourceModule: 'accounting',
    sourceRefId: invoice.id,
    lines: originalLines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.credit), // swap
      credit: Number(l.debit), // swap
    })),
  }

  // 3. Atomic: create reversing JE + update invoice to VOID.
  //    Same tenantId-in-where requirement as postInvoice (tx has no middleware).
  const result = await db.$transaction(async (tx) => {
    const voidJe = await createJournalEntryOn(tx, reversingInput)
    const updated = await tx.invoice.update({
      where: { id, tenantId: ctx.tenantId },
      data: {
        status: 'VOID',
        voidJournalEntryId: voidJe.id,
      },
      include: { lines: true },
    })
    return { invoice: updated, voidJournalEntryId: voidJe.id }
  })

  return result
}
