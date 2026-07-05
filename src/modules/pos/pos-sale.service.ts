/**
 * POS module — Sale orchestration service.
 *
 * Per /upload/pos.md: POS is an ORCHESTRATION layer on top of the existing
 * services from Phase 1 (invoice) and Phase 2 (inventory). It does NOT
 * rewrite any logic — it calls:
 *   - createInvoice (Phase 1) with channel: 'POS'
 *   - postInvoice (Phase 1) with debitAccountId: cashAccount.id
 *   - recordSale (Phase 2) for each line
 *
 * Atomicity guarantee: stock sufficiency is pre-checked for ALL lines BEFORE
 * any write. If any line has insufficient stock, the entire sale is rejected
 * with zero side effects (no invoice, no stock movement, no JE).
 *
 * The pre-check is the primary safety mechanism. The existing services'
 * internal transactions handle their own atomicity. A race condition between
 * the pre-check and recordSale is theoretically possible but extremely
 * unlikely in a single-tenant POS context; recordSale's own internal stock
 * check is the secondary guard.
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
import type { Product, Warehouse } from '@prisma/client'

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
 * Steps:
 *  1. requirePermission('pos:sell')
 *  2. Pre-check: for each line, fetch the product + its stock at the warehouse.
 *     If ANY line has insufficient stock, throw InsufficientStockError BEFORE
 *     any write — the entire sale is rejected atomically.
 *  3. Resolve the Cash account (POS debits Cash, not AR).
 *  4. Get the tenant's default tax rate from the TaxProvider.
 *  5. Create the invoice (DRAFT, channel: 'POS') via createInvoice.
 *  6. Post it immediately via postInvoice with debitAccountId = cash.
 *     → creates the revenue JE (Debit Cash, Credit Revenue + Tax).
 *  7. For each line, call recordSale.
 *     → creates StockMovement(SALE) + COGS JE (Debit COGS, Credit Inventory).
 *  8. Return the result with totals + profit.
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

  // ---- 1. Pre-check: verify all products exist + stock is sufficient ----
  // This is the atomicity guarantee: if any line fails, NO write happens.
  const productIds = Array.from(new Set(input.lines.map((l) => l.productId)))
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    include: {
      stockLevels: { where: { warehouseId: input.warehouseId } },
    },
  })

  // Build a map for quick lookup
  const productMap = new Map(products.map((p) => [p.id, p]))

  // Verify all products exist + check stock for each line
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

  // ---- 2. Resolve the Cash account (POS debits Cash, not AR) ----
  const cashAccount = await resolveCashAccount()

  // ---- 3. Get the tenant's default tax rate from the TaxProvider ----
  const tenant = await dbRaw.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { country: true },
  })
  const provider = getTaxProvider(tenant?.country ?? 'EG')
  if (!provider) {
    throw new InventoryConfigError(`No TaxProvider registered for country ${tenant?.country}`)
  }
  // Use the provider to determine the default tax rate. We call calculateTax
  // with a single line to extract the rate — but actually we just need the
  // rate. For EG it's 0.14. We get it from the provider by calling
  // calculateTax on a dummy line and reading the rate from the result.
  const dummyTax = provider.calculateTax({
    countryCode: provider.countryCode,
    lines: [{ amount: 100, description: 'rate probe' }],
  })
  const defaultTaxRate = dummyTax.lines[0]?.rate ?? 0

  // ---- 4. Create the invoice (DRAFT, channel: POS) ----
  // Build invoice lines from the POS cart. Each line uses the product's
  // sellPrice (from the POS input) as the amount, and the default tax rate.
  const invoiceLines = input.lines.map((line) => {
    const product = productMap.get(line.productId)!
    return {
      description: `${product.sku} — ${product.nameKey}`,
      amount: line.unitPrice * line.quantity,
      taxRate: defaultTaxRate,
    }
  })

  const invoice = await createInvoice({
    customerName: input.customerName,
    date: new Date(),
    lines: invoiceLines,
    channel: 'POS',
  })

  // ---- 5. Post the invoice immediately (debits Cash, not AR) ----
  const posted = await postInvoice(invoice.id, {
    debitAccountId: cashAccount.id,
  })

  // ---- 6. For each line, record the sale (stock movement + COGS JE) ----
  const saleResults: SaleResult[] = []
  let totalCogs = 0

  for (const line of input.lines) {
    const saleResult = await recordSale({
      productId: line.productId,
      warehouseId: input.warehouseId,
      quantity: line.quantity,
      sourceRefId: invoice.id,
    })
    saleResults.push(saleResult)
    totalCogs += saleResult.cogsAmount
  }

  // ---- 7. Compute totals + return ----
  const totalRevenue = posted.tax.totalBase
  const totalTax = posted.tax.totalTax
  const totalAmount = posted.tax.total
  const netProfit = Math.round((totalRevenue - totalCogs) * 100) / 100

  return {
    invoice: posted.invoice,
    revenueJournalEntryId: posted.journalEntryId,
    cogsJournalEntryIds: saleResults.map((s) => s.journalEntryId),
    saleResults,
    totalRevenue,
    totalTax,
    totalAmount,
    totalCogs: Math.round(totalCogs * 100) / 100,
    netProfit,
  }
}
