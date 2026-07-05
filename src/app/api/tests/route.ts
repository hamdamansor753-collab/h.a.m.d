/**
 * POST /api/tests
 *
 * Runs the two mandatory Phase 0 security tests and returns structured
 * pass/fail results. Per /upload/05-security-baseline.md section 5:
 * tenant-isolation tests must verify ACTUAL cross-tenant rejection, not
 * a theoretical assumption. Per /upload/04-data-model.md note 3: an
 * unbalanced JournalEntry must be rejected.
 *
 * Test 1 — Tenant isolation:
 *   1. Identify the OTHER tenant (the one the current user does NOT belong to).
 *   2. Using `dbRaw` (the raw Prisma client without tenant middleware —
 *      the auditable cross-tenant escape hatch), read one of the OTHER
 *      tenant's account IDs. (This simulates an attacker
 *      who somehow learned another tenant's account ID.)
 *   3. Try to read that account through the SERVICE LAYER (which is scoped
 *      to the current user's tenant by the Prisma middleware). The service
 *      MUST return null — the middleware silently filters it out.
 *   4. Try to UPDATE that account through the service layer (raw db call
 *      inside the current tenant context). The update MUST affect 0 rows.
 *
 *   The test PASSES if both the read returns null AND the update affects
 *   0 rows. Any other outcome is a critical security failure.
 *
 * Test 2 — Journal balance:
 *   1. Attempt to create a JournalEntry where debit=100, credit=50
 *      (unbalanced). The service MUST throw JournalBalanceError.
 *   2. Attempt to create a balanced entry (debit=100, credit=100). The
 *      service MUST succeed.
 *   3. Clean up the balanced entry.
 *
 *   The test PASSES if the unbalanced attempt throws AND the balanced
 *   attempt succeeds.
 *
 * runtime = 'nodejs' (Prisma). Auth-required.
 */
import { withTenantContext } from '@/core/auth/session'
import { requirePermission } from '@/core/rbac'
import { getAccount } from '@/core/ledger/account.service'
import { createJournalEntry, listJournalEntries } from '@/core/ledger/journal-entry.service'
import {
  createInvoice,
  updateInvoice,
  postInvoice,
  voidInvoice,
  listInvoices,
} from '@/modules/accounting/invoice.service'
import {
  createPurchaseOrder,
  receivePurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrder,
} from '@/modules/inventory/purchase-order.service'
import { recordSale } from '@/modules/inventory/sales-movement.service'
import { listStockMovements, getStockLevel } from '@/modules/inventory/stock-movement.service'
import { listProducts } from '@/modules/inventory/product.service'
import { listWarehouses } from '@/modules/inventory/warehouse.service'
import { posSale } from '@/modules/pos/pos-sale.service'
import { listInvoices as listAllInvoices } from '@/modules/accounting/invoice.service'
import { JournalBalanceError, InvoiceStateError, InsufficientStockError } from '@/lib/api'
import { db, dbRaw } from '@/lib/db'
import { ok, mapError, unauthorized } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TestResult {
  name: string
  passed: boolean
  details: Record<string, unknown>
}

export async function POST() {
  try {
    const results = await withTenantContext(async (ctx) => {
      // Phase 0 fix: only admin (system:test permission) may run security
      // tests. The tests use dbRaw to inspect another tenant's data —
      // granting this to viewer/accountant would leak tenant boundaries.
      requirePermission('system:test')

      const results: TestResult[] = []

      // ---------------- Test 1: Tenant isolation ----------------
      // Find the OTHER tenant's account. We use `dbRaw` (the raw client
      // without tenant middleware) here because this lookup is INTENTIONALLY
      // cross-tenant — it simulates an attacker who somehow learned another
      // tenant's account ID. This is one of the three auditable dbRaw uses.
      const otherTenantAccount = await dbRaw.account.findFirst({
        where: { tenantId: { not: ctx.tenantId } },
        select: { id: true, code: true, tenantId: true },
      })

      if (!otherTenantAccount) {
        results.push({
          name: 'tenant-isolation',
          passed: false,
          details: { reason: 'No other-tenant account found to test against (seed missing?)' },
        })
      } else {
        // (a) Attempt to READ the other tenant's account via the service
        //     layer. The middleware should filter it out → null.
        const leakedRead = await getAccount(otherTenantAccount.id)

        // (b) Attempt to UPDATE the other tenant's account via a direct
        //     Prisma call inside the current tenant context. The middleware
        //     will inject `tenantId = ctx.tenantId` into the where clause,
        //     so the update will affect 0 rows (no matching row in our
        //     tenant with that ID).
        let updateAffected = -1
        try {
          const upd = await db.account.updateMany({
            where: { id: otherTenantAccount.id },
            data: { nameKey: 'account.tampered' },
          })
          updateAffected = upd.count
        } catch {
          updateAffected = -1
        }

        // (c) Attempt to CREATE a JournalEntry referencing the other
        //     tenant's account ID. The journal service verifies every
        //     line's accountId belongs to the current tenant; the other
        //     tenant's account ID will not be found in the scoped
        //     findMany → the service rejects the create.
        let crossTenantCreateBlocked = false
        let crossTenantCreateError: string | null = null
        try {
          await createJournalEntry({
            date: new Date(),
            description: 'cross-tenant attempt',
            sourceModule: 'accounting',
            sourceRefId: 'test-cross-tenant',
            lines: [
              { accountId: otherTenantAccount.id, debit: 10, credit: 0 },
              { accountId: otherTenantAccount.id, debit: 0, credit: 10 },
            ],
          })
          // If we get here, the cross-tenant create was NOT blocked — FAIL.
          crossTenantCreateBlocked = false
        } catch (e) {
          crossTenantCreateBlocked = true
          crossTenantCreateError = e instanceof Error ? e.name : 'unknown'
        }

        const passed =
          leakedRead === null &&
          updateAffected === 0 &&
          crossTenantCreateBlocked === true

        results.push({
          name: 'tenant-isolation',
          passed,
          details: {
            currentTenantId: ctx.tenantId,
            otherTenantId: otherTenantAccount.tenantId,
            otherTenantAccountCode: otherTenantAccount.code,
            crossTenantReadResult: leakedRead === null ? 'null (blocked)' : 'LEAKED',
            crossTenantUpdateAffected: updateAffected,
            crossTenantJournalCreateBlocked: crossTenantCreateBlocked,
            crossTenantJournalCreateError: crossTenantCreateError,
          },
        })
      }

      // ---------------- Test 2: Journal balance ----------------
      // Find two accounts in the current tenant to use for the test.
      const myAccounts = await db.account.findMany({ take: 2, select: { id: true, code: true } })
      if (myAccounts.length < 2) {
        results.push({
          name: 'journal-balance',
          passed: false,
          details: { reason: 'Need at least 2 accounts in current tenant' },
        })
      } else {
        const [a, b] = myAccounts

        // (a) Unbalanced: debit 100, credit 50 → MUST throw.
        let unbalancedRejected = false
        let unbalancedError: string | null = null
        try {
          await createJournalEntry({
            date: new Date(),
            description: 'unbalanced test',
            sourceModule: 'accounting',
            sourceRefId: 'test-unbalanced',
            lines: [
              { accountId: a.id, debit: 100, credit: 0 },
              { accountId: b.id, debit: 0, credit: 50 },
            ],
          })
          unbalancedRejected = false
        } catch (e) {
          unbalancedRejected = e instanceof JournalBalanceError
          unbalancedError = e instanceof Error ? e.name : 'unknown'
        }

        // (b) Balanced: debit 100, credit 100 → MUST succeed.
        let balancedCreated = false
        let balancedId: string | null = null
        try {
          const entry = await createJournalEntry({
            date: new Date(),
            description: 'balanced test',
            sourceModule: 'accounting',
            sourceRefId: 'test-balanced',
            lines: [
              { accountId: a.id, debit: 100, credit: 0 },
              { accountId: b.id, debit: 0, credit: 100 },
            ],
          })
          balancedCreated = true
          balancedId = entry.id
          // Cleanup — delete within the same tenant context (middleware
          // scopes the delete to the current tenant; the row belongs to
          // us so it succeeds).
          await db.journalEntry.delete({ where: { id: entry.id } })
        } catch (e) {
          balancedCreated = false
          balancedId = null
        }

        const passed = unbalancedRejected && balancedCreated
        results.push({
          name: 'journal-balance',
          passed,
          details: {
            unbalancedRejected,
            unbalancedError,
            balancedCreated,
            balancedId,
            cleanedUp: balancedCreated,
          },
        })
      }

      // =================================================================
      // PHASE 1 TESTS: Invoice posting + immutability + tenant isolation
      // =================================================================

      // ---------------- Test 3: Invoice draft → edit → post → balanced JE ----------------
      let invoicePostPassed = false
      let invoicePostDetails: Record<string, unknown> = {}
      try {
        // (a) Create a DRAFT invoice
        const draft = await createInvoice({
          customerName: 'Test Customer (auto-cleanup)',
          date: new Date(),
          lines: [
            { description: 'Service', amount: 1000, taxRate: 0.14 },
          ],
        })

        // (b) Edit the draft (update customer + add a line)
        const edited = await updateInvoice(draft.id, {
          customerName: 'Test Customer (edited)',
          lines: [
            { description: 'Service A', amount: 1000, taxRate: 0.14 },
            { description: 'Service B', amount: 500, taxRate: 0.14 },
          ],
        })

        // (c) Post the invoice
        const posted = await postInvoice(edited.id)

        // (d) Verify the journal entry exists and is balanced
        const journalEntries = await listJournalEntries(100)
        const je = journalEntries.find((e) => e.id === posted.journalEntryId)
        const debitSum = je ? je.lines.reduce((s, l) => s + Number(l.debit), 0) : -1
        const creditSum = je ? je.lines.reduce((s, l) => s + Number(l.credit), 0) : -1
        const balanced = je ? Math.round(debitSum * 100) === Math.round(creditSum * 100) : false

        // (e) Verify tax was calculated (14% of 1500 = 210)
        const expectedTax = 210 // (1000 + 500) * 0.14
        const expectedTotal = 1710 // 1500 + 210
        const taxCorrect = Math.round(posted.tax.totalTax) === expectedTax
        const totalCorrect = Math.round(posted.tax.total) === expectedTotal

        invoicePostPassed = !!je && balanced && taxCorrect && totalCorrect
        invoicePostDetails = {
          invoiceNumber: edited.number,
          statusAfterPost: posted.invoice.status,
          journalEntryId: posted.journalEntryId,
          journalEntryFound: !!je,
          debitSum: debitSum.toFixed(2),
          creditSum: creditSum.toFixed(2),
          balanced,
          taxCalculated: posted.tax.totalTax,
          taxExpected: expectedTax,
          taxCorrect,
          totalCalculated: posted.tax.total,
          totalExpected: expectedTotal,
          totalCorrect,
        }

        // (f) Cleanup: void the posted invoice (creates reversing entry)
        await voidInvoice(edited.id)
      } catch (e) {
        invoicePostDetails = { error: e instanceof Error ? e.message : String(e) }
      }
      results.push({ name: 'invoice-post-balanced', passed: invoicePostPassed, details: invoicePostDetails })

      // ---------------- Test 4: POSTED invoice is immutable ----------------
      let postedImmutablePassed = false
      let postedImmutableDetails: Record<string, unknown> = {}
      try {
        // Create + post an invoice
        const draft = await createInvoice({
          customerName: 'Immutability Test (auto-cleanup)',
          date: new Date(),
          lines: [{ description: 'Test', amount: 100, taxRate: 0.14 }],
        })
        await postInvoice(draft.id)

        // Attempt to PATCH the POSTED invoice → MUST be rejected
        let editRejected = false
        let editError: string | null = null
        try {
          await updateInvoice(draft.id, { customerName: 'Tampered' })
          editRejected = false
        } catch (e) {
          editRejected = e instanceof InvoiceStateError
          editError = e instanceof Error ? e.name : 'unknown'
        }

        postedImmutablePassed = editRejected
        postedImmutableDetails = {
          invoiceId: draft.id,
          editAttempted: 'PATCH customerName on POSTED invoice',
          editRejected,
          editError,
        }

        // Cleanup: void
        await voidInvoice(draft.id)
      } catch (e) {
        postedImmutableDetails = { error: e instanceof Error ? e.message : String(e) }
      }
      results.push({ name: 'posted-invoice-immutable', passed: postedImmutablePassed, details: postedImmutableDetails })

      // ---------------- Test 5: Invoice tenant isolation ----------------
      // Create an invoice in the OTHER tenant (via dbRaw), then try to
      // read/post it from the CURRENT tenant's context (via service layer).
      let invoiceIsolationPassed = false
      let invoiceIsolationDetails: Record<string, unknown> = {}
      try {
        // Create a draft invoice in the other tenant using dbRaw
        const otherInvoice = await dbRaw.invoice.create({
          data: {
            tenantId: otherTenantAccount?.tenantId ?? 'tenant-noor',
            number: `TEST-X-${Date.now()}`,
            customerName: 'Other Tenant Customer',
            date: new Date(),
            status: 'DRAFT',
            lines: {
              create: [{ description: 'Test', amount: 100, taxRate: 0.14 }],
            },
          },
          include: { lines: true },
        })

        // (a) Try to READ the other tenant's invoice via the service layer
        //     (scoped to current tenant → should return null)
        const leakedRead = await listInvoices().then((list) =>
          list.find((i) => i.id === otherInvoice.id) ?? null
        )

        // (b) Try to POST the other tenant's invoice via the service layer
        //     (should fail — the service can't find it in this tenant)
        let crossPostBlocked = false
        let crossPostError: string | null = null
        try {
          await postInvoice(otherInvoice.id)
          crossPostBlocked = false
        } catch (e) {
          crossPostBlocked = true
          crossPostError = e instanceof Error ? e.name : 'unknown'
        }

        // (c) Try to UPDATE the other tenant's invoice
        let crossUpdateBlocked = false
        let crossUpdateError: string | null = null
        try {
          await updateInvoice(otherInvoice.id, { customerName: 'Tampered' })
          crossUpdateBlocked = false
        } catch (e) {
          crossUpdateBlocked = e instanceof InvoiceStateError
          crossUpdateError = e instanceof Error ? e.name : 'unknown'
        }

        invoiceIsolationPassed = leakedRead === null && crossPostBlocked && crossUpdateBlocked
        invoiceIsolationDetails = {
          currentTenantId: ctx.tenantId,
          otherTenantId: otherInvoice.tenantId,
          otherInvoiceNumber: otherInvoice.number,
          crossTenantReadResult: leakedRead === null ? 'null (blocked)' : 'LEAKED',
          crossTenantPostBlocked: crossPostBlocked,
          crossTenantPostError: crossPostError,
          crossTenantUpdateBlocked: crossUpdateBlocked,
          crossTenantUpdateError: crossUpdateError,
        }

        // Cleanup: delete the other tenant's test invoice
        await dbRaw.invoice.delete({ where: { id: otherInvoice.id } })
      } catch (e) {
        invoiceIsolationDetails = { error: e instanceof Error ? e.message : String(e) }
      }
      results.push({ name: 'invoice-tenant-isolation', passed: invoiceIsolationPassed, details: invoiceIsolationDetails })

      // =================================================================
      // PHASE 2 TESTS: Purchase order receive + stock + JE, insufficient
      // stock rejection, inventory tenant isolation
      // =================================================================

      // ---------------- Test 6: PO receive → stock + balanced JE + movements ----------------
      let poReceivePassed = false
      let poReceiveDetails: Record<string, unknown> = {}
      try {
        // Fetch a product + warehouse for the current tenant
        const products = await listProducts()
        const warehouses = await listWarehouses()
        if (products.length === 0 || warehouses.length === 0) {
          throw new Error('No products or warehouses seeded')
        }
        const product = products[0]
        const warehouse = warehouses[0]

        // Record stock level BEFORE receiving
        const stockBefore = await getStockLevel(product.id, warehouse.id)

        // Create a DRAFT PO with 2 lines
        const po = await createPurchaseOrder({
          supplierName: 'Test Supplier (auto-cleanup)',
          date: new Date(),
          lines: [
            { productId: product.id, quantity: 10, unitCost: 100, warehouseId: warehouse.id },
            { productId: product.id, quantity: 5, unitCost: 120, warehouseId: warehouse.id },
          ],
        })

        // Receive the PO
        const received = await receivePurchaseOrder(po.id)

        // (a) Verify StockLevel increased by the correct amount (10 + 5 = 15)
        const stockAfter = await getStockLevel(product.id, warehouse.id)
        const stockDelta = stockAfter - stockBefore
        const stockCorrect = stockDelta === 15

        // (b) Verify a balanced JournalEntry was created
        const journalEntries = await listJournalEntries(100)
        const je = journalEntries.find((e) => e.id === received.journalEntryId)
        const debitSum = je ? je.lines.reduce((s, l) => s + Number(l.debit), 0) : -1
        const creditSum = je ? je.lines.reduce((s, l) => s + Number(l.credit), 0) : -1
        const balanced = je ? Math.round(debitSum * 100) === Math.round(creditSum * 100) : false

        // (c) Verify total cost = (10×100) + (5×120) = 1000 + 600 = 1600
        const expectedTotal = 1600
        const totalCorrect = Math.round(received.totalCost) === expectedTotal

        // (d) Verify EXACTLY one StockMovement per line (2 movements for 2 lines)
        const movements = await listStockMovements(200)
        const poMovements = movements.filter((m) => m.sourceRefId === po.id)
        const movementsCountCorrect = poMovements.length === 2

        // (e) Verify PO status is RECEIVED
        const poAfter = await getPurchaseOrder(po.id)
        const statusCorrect = poAfter?.status === 'RECEIVED'

        poReceivePassed = stockCorrect && balanced && totalCorrect && movementsCountCorrect && statusCorrect
        poReceiveDetails = {
          poNumber: po.number,
          stockBefore,
          stockAfter,
          stockDelta,
          stockExpected: 15,
          stockCorrect,
          journalEntryId: received.journalEntryId,
          journalEntryFound: !!je,
          debitSum: debitSum.toFixed(2),
          creditSum: creditSum.toFixed(2),
          balanced,
          totalCost: received.totalCost,
          totalExpected: expectedTotal,
          totalCorrect,
          movementsCount: poMovements.length,
          movementsExpected: 2,
          movementsCountCorrect,
          statusAfter: poAfter?.status,
          statusCorrect,
        }
      } catch (e) {
        poReceiveDetails = { error: e instanceof Error ? e.message : String(e) }
      }
      results.push({ name: 'po-receive-stock-je', passed: poReceivePassed, details: poReceiveDetails })

      // ---------------- Test 7: recordSale with insufficient stock → rejected ----------------
      let insufficientStockPassed = false
      let insufficientStockDetails: Record<string, unknown> = {}
      try {
        const products = await listProducts()
        const warehouses = await listWarehouses()
        if (products.length === 0 || warehouses.length === 0) {
          throw new Error('No products or warehouses seeded')
        }
        const product = products[0]
        const warehouse = warehouses[0]

        // Get current stock
        const stockBefore = await getStockLevel(product.id, warehouse.id)

        // Attempt to sell MORE than available (stockBefore + 1000)
        const oversellQty = stockBefore + 1000
        let saleRejected = false
        let saleError: string | null = null
        try {
          await recordSale({
            productId: product.id,
            warehouseId: warehouse.id,
            quantity: oversellQty,
            sourceRefId: 'test-oversell',
          })
          saleRejected = false
        } catch (e) {
          saleRejected = e instanceof InsufficientStockError
          saleError = e instanceof Error ? e.name : 'unknown'
        }

        // Verify stock is UNCHANGED
        const stockAfter = await getStockLevel(product.id, warehouse.id)
        const stockUnchanged = stockBefore === stockAfter

        insufficientStockPassed = saleRejected && stockUnchanged
        insufficientStockDetails = {
          productId: product.id,
          warehouseId: warehouse.id,
          stockBefore,
          oversellQuantity: oversellQty,
          saleRejected,
          saleError,
          stockAfter,
          stockUnchanged,
        }
      } catch (e) {
        insufficientStockDetails = { error: e instanceof Error ? e.message : String(e) }
      }
      results.push({ name: 'insufficient-stock-rejected', passed: insufficientStockPassed, details: insufficientStockDetails })

      // ---------------- Test 8: Inventory tenant isolation ----------------
      let inventoryIsolationPassed = false
      let inventoryIsolationDetails: Record<string, unknown> = {}
      try {
        // Create a product in the OTHER tenant using dbRaw
        const otherProduct = await dbRaw.product.create({
          data: {
            tenantId: otherTenantAccount?.tenantId ?? 'tenant-noor',
            sku: `TEST-X-${Date.now()}`,
            nameKey: 'product.mouse',
            costPrice: 0,
            sellPrice: 100,
          },
        })

        // (a) Try to READ the other tenant's product via the service layer
        const myProducts = await listProducts()
        const leakedProduct = myProducts.find((p) => p.id === otherProduct.id) ?? null

        // (b) Try to RECEIVE a PO referencing the other tenant's product
        //     (should fail — the product doesn't exist in our tenant)
        const myWarehouses = await listWarehouses()
        let crossCreateBlocked = false
        let crossCreateError: string | null = null
        try {
          const po = await createPurchaseOrder({
            supplierName: 'Cross-tenant attempt',
            date: new Date(),
            lines: [
              { productId: otherProduct.id, quantity: 1, unitCost: 10, warehouseId: myWarehouses[0].id },
            ],
          })
          // If create succeeded, try to receive it — should fail
          await receivePurchaseOrder(po.id)
          crossCreateBlocked = false
        } catch (e) {
          crossCreateBlocked = true
          crossCreateError = e instanceof Error ? e.name : 'unknown'
        }

        inventoryIsolationPassed = leakedProduct === null && crossCreateBlocked
        inventoryIsolationDetails = {
          currentTenantId: ctx.tenantId,
          otherTenantId: otherProduct.tenantId,
          otherProductSku: otherProduct.sku,
          crossTenantReadResult: leakedProduct === null ? 'null (blocked)' : 'LEAKED',
          crossTenantPoCreateOrReceiveBlocked: crossCreateBlocked,
          crossTenantError: crossCreateError,
        }

        // Cleanup: delete the other tenant's test product
        await dbRaw.product.delete({ where: { id: otherProduct.id } })
      } catch (e) {
        inventoryIsolationDetails = { error: e instanceof Error ? e.message : String(e) }
      }
      results.push({ name: 'inventory-tenant-isolation', passed: inventoryIsolationPassed, details: inventoryIsolationDetails })

      // =================================================================
      // PHASE 3 TESTS: POS sale creates invoice+stock+2 JEs, insufficient
      // stock rejected before writes, POS tenant isolation
      // =================================================================

      // ---------------- Test 9: POS sale → invoice(POS) + stock reduced + 2 balanced JEs ----------------
      let posSalePassed = false
      let posSaleDetails: Record<string, unknown> = {}
      try {
        const products = await listProducts()
        const warehouses = await listWarehouses()
        if (products.length === 0 || warehouses.length === 0) {
          throw new Error('No products or warehouses seeded')
        }
        const product = products[0]
        const warehouse = warehouses[0]

        // Record stock + invoice count BEFORE the POS sale
        const stockBefore = await getStockLevel(product.id, warehouse.id)
        const invoicesBefore = await listAllInvoices()

        // Execute the POS sale: 2 units at the product's sellPrice
        const sellPrice = Number(product.sellPrice)
        const saleQty = 2
        const result = await posSale({
          warehouseId: warehouse.id,
          customerName: 'POS Test Customer',
          lines: [
            { productId: product.id, quantity: saleQty, unitPrice: sellPrice },
          ],
        })

        // (a) Verify invoice channel = POS
        const channelCorrect = result.invoice.channel === 'POS'

        // (b) Verify StockLevel decreased by saleQty
        const stockAfter = await getStockLevel(product.id, warehouse.id)
        const stockDelta = stockBefore - stockAfter
        const stockCorrect = stockDelta === saleQty

        // (c) Verify a new invoice appeared in /api/invoices
        const invoicesAfter = await listAllInvoices()
        const newInvoice = invoicesAfter.find((inv) => inv.id === result.invoice.id)
        const invoiceFound = !!newInvoice

        // (d) Verify TWO balanced journal entries (revenue + COGS)
        const journalEntries = await listJournalEntries(200)
        const revenueJE = journalEntries.find((e) => e.id === result.revenueJournalEntryId)
        const cogsJE = journalEntries.find((e) => e.id === result.cogsJournalEntryIds[0])

        const revenueDebit = revenueJE ? revenueJE.lines.reduce((s, l) => s + Number(l.debit), 0) : -1
        const revenueCredit = revenueJE ? revenueJE.lines.reduce((s, l) => s + Number(l.credit), 0) : -1
        const revenueBalanced = revenueJE ? Math.round(revenueDebit * 100) === Math.round(revenueCredit * 100) : false

        const cogsDebit = cogsJE ? cogsJE.lines.reduce((s, l) => s + Number(l.debit), 0) : -1
        const cogsCredit = cogsJE ? cogsJE.lines.reduce((s, l) => s + Number(l.credit), 0) : -1
        const cogsBalanced = cogsJE ? Math.round(cogsDebit * 100) === Math.round(cogsCredit * 100) : false

        // (e) Verify COGS = qty × costPrice (not sellPrice)
        const expectedCogs = Number(product.costPrice) * saleQty
        const cogsCorrect = Math.round(result.totalCogs * 100) === Math.round(expectedCogs * 100)

        posSalePassed = channelCorrect && stockCorrect && invoiceFound && revenueBalanced && cogsBalanced && cogsCorrect
        posSaleDetails = {
          invoiceNumber: result.invoice.number,
          invoiceChannel: result.invoice.channel,
          channelCorrect,
          stockBefore,
          stockAfter,
          stockDelta,
          stockExpected: saleQty,
          stockCorrect,
          invoiceFound,
          revenueJE: result.revenueJournalEntryId,
          revenueBalanced,
          revenueDebit: revenueDebit.toFixed(2),
          revenueCredit: revenueCredit.toFixed(2),
          cogsJE: result.cogsJournalEntryIds[0],
          cogsBalanced,
          cogsDebit: cogsDebit.toFixed(2),
          cogsCredit: cogsCredit.toFixed(2),
          totalCogs: result.totalCogs,
          expectedCogs,
          cogsCorrect,
          netProfit: result.netProfit,
        }
      } catch (e) {
        posSaleDetails = { error: e instanceof Error ? e.message : String(e) }
      }
      results.push({ name: 'pos-sale-invoice-stock-je', passed: posSalePassed, details: posSaleDetails })

      // ---------------- Test 10: POS sale with insufficient stock → rejected before any write ----------------
      let posInsufficientPassed = false
      let posInsufficientDetails: Record<string, unknown> = {}
      try {
        const products = await listProducts()
        const warehouses = await listWarehouses()
        if (products.length === 0 || warehouses.length === 0) {
          throw new Error('No products or warehouses seeded')
        }
        const product = products[0]
        const warehouse = warehouses[0]

        // Count invoices + stock BEFORE the attempted sale
        const stockBefore = await getStockLevel(product.id, warehouse.id)
        const invoicesBefore = await listAllInvoices()

        // Attempt to sell WAY more than available
        const oversellQty = stockBefore + 5000
        let saleRejected = false
        let saleError: string | null = null
        try {
          await posSale({
            warehouseId: warehouse.id,
            customerName: 'POS Oversell Test',
            lines: [
              { productId: product.id, quantity: oversellQty, unitPrice: Number(product.sellPrice) },
            ],
          })
          saleRejected = false
        } catch (e) {
          saleRejected = e instanceof InsufficientStockError
          saleError = e instanceof Error ? e.name : 'unknown'
        }

        // Verify NO invoice was created + stock unchanged
        const stockAfter = await getStockLevel(product.id, warehouse.id)
        const invoicesAfter = await listAllInvoices()
        const stockUnchanged = stockBefore === stockAfter
        const invoiceCountUnchanged = invoicesBefore.length === invoicesAfter.length

        posInsufficientPassed = saleRejected && stockUnchanged && invoiceCountUnchanged
        posInsufficientDetails = {
          stockBefore,
          oversellQuantity: oversellQty,
          saleRejected,
          saleError,
          stockAfter,
          stockUnchanged,
          invoicesBefore: invoicesBefore.length,
          invoicesAfter: invoicesAfter.length,
          invoiceCountUnchanged,
        }
      } catch (e) {
        posInsufficientDetails = { error: e instanceof Error ? e.message : String(e) }
      }
      results.push({ name: 'pos-insufficient-stock-rejected', passed: posInsufficientPassed, details: posInsufficientDetails })

      // ---------------- Test 11: POS tenant isolation ----------------
      let posIsolationPassed = false
      let posIsolationDetails: Record<string, unknown> = {}
      try {
        // Create a product in the OTHER tenant using dbRaw
        const otherProduct = await dbRaw.product.create({
          data: {
            tenantId: otherTenantAccount?.tenantId ?? 'tenant-noor',
            sku: `POS-X-${Date.now()}`,
            nameKey: 'product.mouse',
            costPrice: 50,
            sellPrice: 100,
          },
        })
        // Create a warehouse in the other tenant
        const otherWarehouse = await dbRaw.warehouse.create({
          data: {
            tenantId: otherProduct.tenantId,
            nameKey: 'warehouse.main',
            isDefault: false,
          },
        })

        // Attempt a POS sale using the OTHER tenant's product + warehouse
        // via the current tenant's service layer. This should fail because:
        //  1. The pre-check fetches products via db.product (scoped to current
        //     tenant) — the other tenant's product won't be found.
        let crossSaleBlocked = false
        let crossSaleError: string | null = null
        try {
          await posSale({
            warehouseId: otherWarehouse.id,
            customerName: 'Cross-tenant POS attempt',
            lines: [
              { productId: otherProduct.id, quantity: 1, unitPrice: 100 },
            ],
          })
          crossSaleBlocked = false
        } catch (e) {
          crossSaleBlocked = true
          crossSaleError = e instanceof Error ? e.name : 'unknown'
        }

        // Verify no invoice was created with the other tenant's product
        const myInvoices = await listAllInvoices()
        const leakedInvoice = myInvoices.find(
          (inv) => inv.customerName === 'Cross-tenant POS attempt'
        )

        posIsolationPassed = crossSaleBlocked && !leakedInvoice
        posIsolationDetails = {
          currentTenantId: ctx.tenantId,
          otherTenantId: otherProduct.tenantId,
          otherProductSku: otherProduct.sku,
          crossTenantSaleBlocked: crossSaleBlocked,
          crossTenantError: crossSaleError,
          leakedInvoiceFound: !!leakedInvoice,
        }

        // Cleanup
        await dbRaw.product.delete({ where: { id: otherProduct.id } })
        await dbRaw.warehouse.delete({ where: { id: otherWarehouse.id } })
      } catch (e) {
        posIsolationDetails = { error: e instanceof Error ? e.message : String(e) }
      }
      results.push({ name: 'pos-tenant-isolation', passed: posIsolationPassed, details: posIsolationDetails })

      // ---------------- Test 12: POS partial failure → full rollback (atomicity) ----------------
      // This test proves the atomicity fix. It creates a scenario where:
      //  - Line 1: valid product with stock S, sell qty Q1 (S >= Q1 → pre-check passes)
      //  - Line 2: SAME product, sell qty Q2 where Q1 + Q2 > S
      //  - The pre-check passes (each line individually sees stock S, and S >= Q1, S >= Q2)
      //  - But inside the transaction, line 1's recordSale reduces stock to S-Q1,
      //    then line 2's recordSale fails (S-Q1 < Q2 → InsufficientStockError)
      //  - The ENTIRE transaction rolls back: no invoice, no JE, no stock movement
      //
      // With the OLD code (separate transactions), this would leave a PARTIAL STATE:
      // invoice posted + line 1's COGS recorded + line 1's stock reduced,
      // but no line 2. The new atomic code prevents this.
      let posAtomicityPassed = false
      let posAtomicityDetails: Record<string, unknown> = {}
      try {
        const products = await listProducts()
        const warehouses = await listWarehouses()
        if (products.length === 0 || warehouses.length === 0) {
          throw new Error('No products or warehouses seeded')
        }
        const product = products[0]
        const warehouse = warehouses[0]

        // Get current stock
        const stockBefore = await getStockLevel(product.id, warehouse.id)

        // Only run this test if there's stock to work with
        if (stockBefore < 2) {
          throw new Error(`Need at least 2 units in stock for this test (current: ${stockBefore})`)
        }

        // Design the sale so each line individually passes the pre-check,
        // but the combined quantity exceeds stock:
        //   Line 1: qty = stockBefore (passes pre-check: stockBefore >= stockBefore)
        //   Line 2: qty = stockBefore (passes pre-check: stockBefore >= stockBefore)
        //   Combined: 2 × stockBefore > stockBefore → line 2 fails mid-transaction
        const lineQty = stockBefore
        const invoicesBefore = await listAllInvoices()
        const movementsBefore = await listStockMovements(500)

        let saleRejected = false
        let saleError: string | null = null
        try {
          await posSale({
            warehouseId: warehouse.id,
            customerName: 'POS Atomicity Test (should fail)',
            lines: [
              { productId: product.id, quantity: lineQty, unitPrice: Number(product.sellPrice) },
              { productId: product.id, quantity: lineQty, unitPrice: Number(product.sellPrice) },
            ],
          })
          saleRejected = false
        } catch (e) {
          saleRejected = e instanceof InsufficientStockError
          saleError = e instanceof Error ? e.name : 'unknown'
        }

        // Verify ZERO side effects (full rollback):
        // 1. Stock unchanged
        const stockAfter = await getStockLevel(product.id, warehouse.id)
        const stockUnchanged = stockBefore === stockAfter

        // 2. No new invoice created
        const invoicesAfter = await listAllInvoices()
        const invoiceCountUnchanged = invoicesBefore.length === invoicesAfter.length

        // 3. No new stock movement created
        const movementsAfter = await listStockMovements(500)
        const movementCountUnchanged = movementsBefore.length === movementsAfter.length

        // 4. No "Atomicity Test" invoice leaked
        const leakedInvoice = invoicesAfter.find(
          (inv) => inv.customerName === 'POS Atomicity Test (should fail)'
        )
        const noLeakedInvoice = !leakedInvoice

        posAtomicityPassed = saleRejected && stockUnchanged && invoiceCountUnchanged && movementCountUnchanged && noLeakedInvoice
        posAtomicityDetails = {
          scenario: `2 lines × ${lineQty} units each (stock=${stockBefore}), combined=${lineQty * 2} > stock=${stockBefore}`,
          stockBefore,
          lineQty,
          combinedQty: lineQty * 2,
          saleRejected,
          saleError,
          stockAfter,
          stockUnchanged,
          invoicesBefore: invoicesBefore.length,
          invoicesAfter: invoicesAfter.length,
          invoiceCountUnchanged,
          movementsBefore: movementsBefore.length,
          movementsAfter: movementsAfter.length,
          movementCountUnchanged,
          noLeakedInvoice,
        }
      } catch (e) {
        posAtomicityDetails = { error: e instanceof Error ? e.message : String(e) }
      }
      results.push({ name: 'pos-partial-failure-rollback', passed: posAtomicityPassed, details: posAtomicityDetails })

      return results
    })

    if (results.status === 401) return unauthorized('en')
    return ok({ results, allPassed: results.every((r) => r.passed) })
  } catch (err) {
    return mapError(err, 'en')
  }
}
