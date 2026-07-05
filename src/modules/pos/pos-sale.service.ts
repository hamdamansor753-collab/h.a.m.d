/**
 * POS module — Sale orchestration service.
 *
 * Per /upload/pos.md: POS is an ORCHESTRATION layer on top of the existing
 * services from Phase 1 (invoice) and Phase 2 (inventory). It does NOT
 * rewrite any logic — it calls:
 *   - createInvoice (Phase 1) with channel: 'POS' + tx
 *   - postInvoice (Phase 1) with debitAccountId: cashAccount.id + tx
 *   - recordSale (Phase 2) for each line + tx
 *
 * ATOMICITY (Phase 3 fix): ALL steps run inside a SINGLE db.$transaction().
 * If ANY step fails (including the internal stock check in recordSale →
 * recordMovement), the ENTIRE transaction rolls back — no invoice, no JE,
 * no stock movement. This is the guarantee that was missing in the initial
 * Phase 3 implementation (which used separate transactions per service).
 *
 * The pre-check (step 1) is an optimization to fail fast BEFORE starting
 * the transaction. The real atomicity guarantee comes from the single
 * $transaction wrapping all writes.
 *
 * Payment: Phase 3 is CASH ONLY. The sale debits the Cash account (not AR)
 * by passing debitAccountId to postInvoice.
 */
import { db } from '@/lib/db'
import { dbRaw } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import { createInvoice, postInvoice, type InvoiceWithLines } from '@/modules/accounting/invoice.service'
import { recordSale, type SaleResult } from '@/modules/inventory/sales-movement.service'
import { getTaxProvider } from '@/core/ledger/tax-provider'
import { InsufficientStockError, InventoryConfigError } from '@/lib/api'
import type { Prisma } from '@prisma/client'

// ---------- Types ----------

export interface PosSaleLineInput {
  productId: string
  quantity: number
  unitPrice: number // the sell price at time of sale (from product.sellPrice)
}

export interface PosSaleInput {
  warehouseId: string
  customerName: string
  lines: PosSaleLineInput[]
}

export interface PosSaleResult {
  invoice: InvoiceWithLines
  revenueJournalEntryId: string // the sales JE (Debit Cash, Credit Revenue+Tax)
  cogsJournalEntryIds: string[] // one COGS JE per line
  saleResults: SaleResult[] // per-line sale details (movement + COGS)
  totalRevenue: number // pre-tax
  totalTax: number
  totalAmount: number // revenue + tax
  totalCogs: number
  netProfit: number // totalRevenue - totalCogs
}

// ---------- Account resolution ----------

const CASH_NAME_KEY = 'account.cash'

async function resolveCashAccount() {
  const cash = await db.account.findFirst({ where: { nameKey: CASH_NAME_KEY } })
  if (!cash) {
    throw new InventoryConfigError(
      `Missing Cash account. Ensure the seed created an account with nameKey: ${CASH_NAME_KEY}`
    )
  }
  return cash
}

// ---------- posSale ----------

/**
 * Execute a POS sale: create + post invoice, record stock movements + COGS.
 *
 * ALL steps run inside a SINGLE db.$transaction() — if any step fails,
 * the entire sale rolls back (no invoice, no JE, no stock movement).
 *
 * Steps:
 *  1. requirePermission('pos:sell')
 *  2. Pre-check (read-only, outside the transaction): verify all products
 *     exist + stock is sufficient. This is an optimization to fail fast
 *     before starting the transaction. The REAL atomicity guarantee comes
 *     from the single $transaction below.
 *  3. Resolve the Cash account + get the default tax rate (reads, outside tx).
 *  4. Start db.$transaction(tx => ...):
 *     a. createInvoice({ channel: 'POS' }, tx) — Phase 1 service
 *     b. postInvoice(id, { debitAccountId: cash }, tx) — Phase 1 service
 *     c. For each line: recordSale({ ... }, tx) — Phase 2 service
 *        (recordSale internally calls recordMovement which checks stock
 *         sufficiency INSIDE the tx — a failure here rolls back everything)
 *  5. Return the result with totals + profit.
 *
 * Permission: pos:sell.
 */
export async function posSale(input: PosSaleInput): Promise<PosSaleResult> {
  requirePermission('pos:sell')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  if (input.lines.length === 0) {
    throw new Error('POS sale requires at least 1 line')
  }

  // ---- 1. Pre-check (read-only, outside the transaction) ----
  // This is an optimization to fail fast. The real safety comes from the
  // single $transaction below — even if the pre-check passes but a
  // mid-transaction failure occurs (e.g., line 1 reduces stock so line 2
  // can't be fulfilled), the entire transaction rolls back.
  const productIds = Array.from(new Set(input.lines.map((l) => l.productId)))
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    include: {
      stockLevels: { where: { warehouseId: input.warehouseId } },
    },
  })

  const productMap = new Map(products.map((p) => [p.id, p]))

  // Verify all products exist + check stock for each line INDIVIDUALLY.
  // NOTE: this does NOT aggregate quantities for the same product across
  // lines — that's intentional. The per-line check here is a fast-fail
  // optimization. The authoritative check happens inside the transaction
  // via recordMovement, which sees the UPDATED stock after each line.
  for (const line of input.lines) {
    const product = productMap.get(line.productId)
    if (!product) {
      throw new InventoryConfigError(`Product ${line.productId} not found`)
    }
    const stockLevel = product.stockLevels[0]
    const available = stockLevel ? Number(stockLevel.quantity) : 0
    if (available < line.quantity) {
      throw new InsufficientStockError(
        line.productId,
        input.warehouseId,
        line.quantity,
        available
      )
    }
  }

  // ---- 2. Resolve Cash account + tax rate (reads, outside tx) ----
  const cashAccount = await resolveCashAccount()

  const tenant = await dbRaw.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { country: true },
  })
  const provider = getTaxProvider(tenant?.country ?? 'EG')
  if (!provider) {
    throw new InventoryConfigError(`No TaxProvider registered for country ${tenant?.country}`)
  }
  // Extract the default tax rate from the provider
  const dummyTax = provider.calculateTax({
    countryCode: provider.countryCode,
    lines: [{ amount: 100, description: 'rate probe' }],
  })
  const defaultTaxRate = dummyTax.lines[0]?.rate ?? 0

  // Build invoice lines from the POS cart
  const invoiceLines = input.lines.map((line) => {
    const product = productMap.get(line.productId)!
    return {
      description: `${product.sku} — ${product.nameKey}`,
      amount: line.unitPrice * line.quantity,
      taxRate: defaultTaxRate,
    }
  })

  // ---- 3. ATOMIC: all writes inside ONE transaction ----
  // If any step fails, the ENTIRE transaction rolls back.
  // - createInvoice fails → no invoice created
  // - postInvoice fails → invoice creation rolls back too
  // - recordSale for line N fails → invoice + posting + lines 1..N-1 all roll back
  const txResult = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    // a. Create the invoice (DRAFT, channel: POS)
    const invoice = await createInvoice({
      customerName: input.customerName,
      date: new Date(),
      lines: invoiceLines,
      channel: 'POS',
    }, tx)

    // b. Post the invoice immediately (debits Cash, not AR)
    const posted = await postInvoice(invoice.id, {
      debitAccountId: cashAccount.id,
    }, tx)

    // c. For each line, record the sale (stock movement + COGS JE)
    //    recordSale → recordMovement checks stock sufficiency INSIDE this tx.
    //    If line 2 fails (e.g., line 1 already reduced stock below line 2's
    //    requested qty), the entire tx rolls back — no invoice, no JE, no movement.
    const saleResults: SaleResult[] = []
    let totalCogs = 0

    for (const line of input.lines) {
      const saleResult = await recordSale({
        productId: line.productId,
        warehouseId: input.warehouseId,
        quantity: line.quantity,
        sourceRefId: invoice.id,
      }, tx)
      saleResults.push(saleResult)
      totalCogs += saleResult.cogsAmount
    }

    return {
      invoice: posted.invoice,
      revenueJournalEntryId: posted.journalEntryId,
      tax: posted.tax,
      saleResults,
      totalCogs,
    }
  })

  // ---- 4. Compute totals + return ----
  const totalRevenue = txResult.tax.totalBase
  const totalTax = txResult.tax.totalTax
  const totalAmount = txResult.tax.total
  const netProfit = Math.round((totalRevenue - txResult.totalCogs) * 100) / 100

  return {
    invoice: txResult.invoice,
    revenueJournalEntryId: txResult.revenueJournalEntryId,
    cogsJournalEntryIds: txResult.saleResults.map((s) => s.journalEntryId),
    saleResults: txResult.saleResults,
    totalRevenue,
    totalTax,
    totalAmount,
    totalCogs: Math.round(txResult.totalCogs * 100) / 100,
    netProfit,
  }
}
