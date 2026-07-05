/**
 * HR module — Payroll service.
 *
 * Per /upload/hr.md:
 *  - createPayrollRun(period): gathers ACTIVE employees, calculates payroll
 *    for each via PayrollRuleProvider, creates PayrollLine per employee.
 *  - postPayrollRun(id): creates ONE balanced JournalEntry (aggregated)
 *    + updates status to POSTED, all in a SINGLE db.$transaction (same
 *    atomicity pattern as posSale after the Phase 3 fix).
 *
 * Account resolution (by nameKey convention):
 *  - account.salaries (EXPENSE) — debited for grossSalary + employerInsurance
 *  - account.payrollPayable (LIABILITY) — credited for total netPay
 *  - account.payrollTax (LIABILITY) — credited for total incomeTax
 *  - account.socialInsurance (LIABILITY) — credited for employee + employer insurance
 *
 * Permission: payroll:run.
 */
import { db } from '@/lib/db'
import { dbRaw } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import { createJournalEntryOn, type JournalEntryInput } from '@/core/ledger/journal-entry.service'
import { getPayrollProvider, type PayrollResult } from '@/core/payroll/provider'
import { HrConfigError, PayrollStateError } from '@/lib/api'
import type { PayrollRun, PayrollLine, Employee, Prisma } from '@prisma/client'

// ---------- Types ----------

export interface PayrollRunWithLines extends PayrollRun {
  lines: PayrollLine[]
}

// ---------- Account resolution ----------

const SALARIES_NAME_KEY = 'account.salaries'
const PAYROLL_PAYABLE_NAME_KEY = 'account.payrollPayable'
const PAYROLL_TAX_NAME_KEY = 'account.payrollTax'
const SOCIAL_INSURANCE_NAME_KEY = 'account.socialInsurance'

async function resolvePayrollAccounts(
  client: Prisma.TransactionClient | typeof db = db,
  tenantId?: string
) {
  const where = (nameKey: string) => tenantId ? { nameKey, tenantId } : { nameKey }
  const [salaries, payable, tax, insurance] = await Promise.all([
    (client as typeof db).account.findFirst({ where: where(SALARIES_NAME_KEY) }),
    (client as typeof db).account.findFirst({ where: where(PAYROLL_PAYABLE_NAME_KEY) }),
    (client as typeof db).account.findFirst({ where: where(PAYROLL_TAX_NAME_KEY) }),
    (client as typeof db).account.findFirst({ where: where(SOCIAL_INSURANCE_NAME_KEY) }),
  ])
  if (!salaries || !payable || !tax || !insurance) {
    throw new HrConfigError(
      'Missing required payroll accounts. Ensure the seed created accounts with nameKeys: ' +
        `${SALARIES_NAME_KEY}, ${PAYROLL_PAYABLE_NAME_KEY}, ${PAYROLL_TAX_NAME_KEY}, ${SOCIAL_INSURANCE_NAME_KEY}`
    )
  }
  return { salaries, payable, tax, insurance }
}

// ---------- CRUD ----------

/**
 * List all payroll runs for the current tenant.
 * Permission: hr:read.
 */
export async function listPayrollRuns(): Promise<PayrollRun[]> {
  requirePermission('hr:read')
  return db.payrollRun.findMany({
    orderBy: { createdAt: 'desc' },
    include: { lines: true },
  })
}

/**
 * Get a single payroll run by ID (scoped to current tenant).
 * Permission: hr:read.
 */
export async function getPayrollRun(id: string): Promise<PayrollRunWithLines | null> {
  requirePermission('hr:read')
  return db.payrollRun.findUnique({
    where: { id },
    include: { lines: true },
  })
}

/**
 * Create a new DRAFT payroll run for the given period.
 * Permission: payroll:run.
 *
 * Steps:
 *  1. Verify no existing run for this period (@@unique enforces this).
 *  2. Fetch all ACTIVE employees.
 *  3. Get the tenant's PayrollRuleProvider.
 *  4. For each employee: calculate payroll → create PayrollLine.
 *  5. Create the PayrollRun with all lines.
 *
 * Does NOT post to the ledger — that's a separate step (postPayrollRun).
 */
export async function createPayrollRun(period: string): Promise<PayrollRunWithLines> {
  requirePermission('payroll:run')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  // 1. Get the tenant's country to select the PayrollRuleProvider
  const tenant = await dbRaw.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { country: true },
  })
  const provider = getPayrollProvider(tenant?.country ?? 'EG')
  if (!provider) {
    throw new HrConfigError(`No PayrollProvider registered for country ${tenant?.country}`)
  }

  // 2. Fetch all ACTIVE employees (internal — payroll:run implies salary access)
  const employees = await db.employee.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  })

  if (employees.length === 0) {
    throw new HrConfigError('No active employees to run payroll for')
  }

  // 3. Calculate payroll for each employee
  const lines = employees.map((emp) => {
    const grossSalary = Number(emp.baseSalary)
    const result: PayrollResult = provider.calculatePayroll({
      countryCode: provider.countryCode,
      grossSalary,
    })
    return {
      employeeId: emp.id,
      grossSalary: result.grossSalary,
      incomeTax: result.incomeTax,
      employeeInsurance: result.employeeInsurance,
      employerInsurance: result.employerInsurance,
      netPay: result.netPay,
    }
  })

  // 4. Create the PayrollRun + all PayrollLines
  return db.payrollRun.create({
    data: {
      period,
      status: 'DRAFT',
      lines: {
        create: lines,
      },
    },
    include: { lines: true },
  })
}

// ---------- Posting ----------

/**
 * Post a DRAFT payroll run to the ledger.
 *
 * Per /upload/hr.md: creates ONE balanced JournalEntry (aggregated, not
 * per-employee) representing the entire payroll:
 *   Debit  Salaries Expense = sum(grossSalary) + sum(employerInsurance)
 *   Credit Payroll Payable  = sum(netPay)
 *   Credit Payroll Tax      = sum(incomeTax)
 *   Credit Social Insurance = sum(employeeInsurance) + sum(employerInsurance)
 *
 * All inside a SINGLE db.$transaction (same pattern as posSale after the
 * Phase 3 atomicity fix). If any step fails, the entire transaction rolls
 * back — no JE, no status change.
 *
 * Permission: payroll:run.
 */
export async function postPayrollRun(
  id: string
): Promise<{ payrollRun: PayrollRunWithLines; journalEntryId: string }> {
  requirePermission('payroll:run')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  // 1. Fetch + verify DRAFT (outside the transaction — read-only)
  const run = await db.payrollRun.findUnique({
    where: { id },
    include: { lines: true },
  })
  if (!run) throw new PayrollStateError('NOT_DRAFT', 'Payroll run not found')
  if (run.status !== 'DRAFT') {
    throw new PayrollStateError('ALREADY_POSTED', `Cannot post payroll run in status ${run.status}`)
  }
  if (run.lines.length === 0) {
    throw new PayrollStateError('NOT_DRAFT', 'Cannot post payroll run with no lines')
  }

  // 2. Resolve accounts (read-only, outside tx)
  const { salaries, payable, tax, insurance } = await resolvePayrollAccounts(db, ctx.tenantId)

  // 3. Aggregate totals from all PayrollLines
  let totalGross = 0
  let totalIncomeTax = 0
  let totalEmployeeInsurance = 0
  let totalEmployerInsurance = 0
  let totalNetPay = 0

  for (const line of run.lines) {
    totalGross += Number(line.grossSalary)
    totalIncomeTax += Number(line.incomeTax)
    totalEmployeeInsurance += Number(line.employeeInsurance)
    totalEmployerInsurance += Number(line.employerInsurance)
    totalNetPay += Number(line.netPay)
  }

  // Round to 2 decimals to avoid float drift
  const round2 = (n: number) => Math.round(n * 100) / 100
  totalGross = round2(totalGross)
  totalIncomeTax = round2(totalIncomeTax)
  totalEmployeeInsurance = round2(totalEmployeeInsurance)
  totalEmployerInsurance = round2(totalEmployerInsurance)
  totalNetPay = round2(totalNetPay)

  // 4. Build the balanced JournalEntry
  //    Debit: Salaries Expense = totalGross + totalEmployerInsurance
  //    Credit: Payroll Payable = totalNetPay
  //    Credit: Payroll Tax = totalIncomeTax
  //    Credit: Social Insurance = totalEmployeeInsurance + totalEmployerInsurance
  //
  //    Balance check: debit = gross + employerIns
  //                   credit = netPay + incomeTax + empIns + employerIns
  //                          = (gross - incomeTax - empIns) + incomeTax + empIns + employerIns
  //                          = gross + employerIns ✓ (always balanced)
  const totalInsurance = totalEmployeeInsurance + totalEmployerInsurance
  const salariesExpense = totalGross + totalEmployerInsurance

  const jeInput: JournalEntryInput = {
    date: new Date(),
    description: `Payroll — ${run.period}`,
    sourceModule: 'hr',
    sourceRefId: run.id,
    lines: [
      // Debit Salaries Expense
      { accountId: salaries.id, debit: salariesExpense, credit: 0 },
      // Credit Payroll Payable (net pay owed to employees)
      { accountId: payable.id, debit: 0, credit: totalNetPay },
      // Credit Payroll Tax (income tax withheld, owed to tax authority)
      { accountId: tax.id, debit: 0, credit: totalIncomeTax },
      // Credit Social Insurance (employee + employer shares, owed to insurance authority)
      { accountId: insurance.id, debit: 0, credit: totalInsurance },
    ],
  }

  // 5. ATOMIC: create JE + update payroll run status in ONE transaction
  const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const je = await createJournalEntryOn(tx, jeInput)
    const updated = await tx.payrollRun.update({
      where: { id, tenantId: ctx.tenantId },
      data: {
        status: 'POSTED',
        journalEntryId: je.id,
      },
      include: { lines: true },
    })
    return { payrollRun: updated, journalEntryId: je.id }
  })

  return result
}
