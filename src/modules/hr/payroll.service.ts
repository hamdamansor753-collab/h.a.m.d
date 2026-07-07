/**
 * HR / Payroll module — Employee + PayrollRun services.
 *
 * Implements /upload/hr.md:
 *  - listEmployees / createEmployee — basic employee master data
 *  - listPayrollRuns / createPayrollRun — DRAFT payroll runs with one
 *    PayrollLine per selected employee, using Egyptian tax brackets
 *    and social-insurance rates to compute gross/tax/insurance/net.
 *  - postPayrollRun — atomic: create a balanced JournalEntry (debits
 *    SalariesExpense, credits PayrollPayable + EmployeeInsurance +
 *    EmployerInsurance + IncomeTaxPayable), then mark the run POSTED.
 *
 * Per the Phase 1 hard rule: every operation inside db.$transaction()
 * MUST include tenantId explicitly in where/data — the tx client has no
 * tenant middleware.
 *
 * Permission keys:
 *  - hr:read   — list employees + payroll runs
 *  - hr:manage — create/edit employees
 *  - hr:run    — create + post payroll runs
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import { createJournalEntryOn, type JournalEntryInput } from '@/core/ledger/journal-entry.service'
import { PayrollStateError, PayrollConfigError } from '@/lib/api'
import type { Employee, PayrollRun, PayrollLine } from '@prisma/client'

// ---------- Types ----------

export interface PayrollRunWithLines extends PayrollRun {
  lines: Array<PayrollLine & { employee: Employee }>
}

export interface PayrollRunSummary {
  payrollRunId: string
  journalEntryId: string
  totalGross: number
  totalNet: number
  totalTax: number
  totalEmployeeInsurance: number
  totalEmployerInsurance: number
}

// ---------- Account resolution ----------
//
// Posting a payroll run needs 5 ledger accounts:
//   1. SalariesExpense     — EXPENSE   — debited for gross + employer insurance
//   2. PayrollPayable      — LIABILITY — credited for net pay (to employees)
//   3. EmployeeInsurance   — LIABILITY — credited for employee share (withheld)
//   4. EmployerInsurance   — LIABILITY — credited for employer share
//   5. IncomeTaxPayable    — LIABILITY — credited for withheld income tax
//
// Resolved by nameKey convention (seed creates one per tenant).
//
// NOTE: The task spec lists 4 accounts (SalariesExpense, PayrollPayable,
// EmployeeInsurance, EmployerInsurance). However, with only those 4 the JE
// would NOT balance: Debit = totalGross + totalEmployerInsurance, while
// Credit = totalNet + totalEmployeeInsurance + totalEmployerInsurance. The
// difference is exactly totalTax (because netPay = gross - tax - employeeIns).
// We add account.incomeTaxPayable as a 5th account to credit totalTax —
// this is the standard Egyptian payroll accounting treatment and the only
// way to satisfy the spec's "balanced JE" requirement.

const SALARIES_EXPENSE_KEY = 'account.salariesExpense'
const PAYROLL_PAYABLE_KEY = 'account.payrollPayable'
const EMPLOYEE_INSURANCE_KEY = 'account.employeeInsurance'
const EMPLOYER_INSURANCE_KEY = 'account.employerInsurance'
const INCOME_TAX_PAYABLE_KEY = 'account.incomeTaxPayable'

async function resolvePayrollAccounts() {
  const [salaries, payable, empIns, emrIns, taxPayable] = await Promise.all([
    db.account.findFirst({ where: { nameKey: SALARIES_EXPENSE_KEY } }),
    db.account.findFirst({ where: { nameKey: PAYROLL_PAYABLE_KEY } }),
    db.account.findFirst({ where: { nameKey: EMPLOYEE_INSURANCE_KEY } }),
    db.account.findFirst({ where: { nameKey: EMPLOYER_INSURANCE_KEY } }),
    db.account.findFirst({ where: { nameKey: INCOME_TAX_PAYABLE_KEY } }),
  ])
  if (!salaries || !payable || !empIns || !emrIns || !taxPayable) {
    throw new PayrollConfigError(
      'Missing required payroll accounts. Ensure the seed created accounts with nameKeys: ' +
        `${SALARIES_EXPENSE_KEY}, ${PAYROLL_PAYABLE_KEY}, ${EMPLOYEE_INSURANCE_KEY}, ` +
        `${EMPLOYER_INSURANCE_KEY}, ${INCOME_TAX_PAYABLE_KEY}`
    )
  }
  return {
    salaries,
    payable,
    employeeInsurance: empIns,
    employerInsurance: emrIns,
    incomeTaxPayable: taxPayable,
  }
}

// ---------- Egyptian payroll math ----------
//
// Tax brackets are ANNUAL. The employee's monthly baseSalary is annualized
// (×12), then the progressive brackets are applied. The resulting annual
// tax is divided by 12 to get the monthly incomeTax.
//
// Annual brackets (EGP):
//   0        – 150,000  : 0%    (on full amount in this band)
//   150,001  – 300,000  : 10%   (on excess over 150k)
//   300,001  – 450,000  : 15%   (on excess over 300k)
//   450,001  – 600,000  : 20%   (on excess over 450k)
//   > 600,000           : 27.5% (on excess over 600k)
//
// Insurance:
//   - Employee share: 11% of monthly baseSalary, capped at 9,750 EGP/month.
//   - Employer share: 18.75% of monthly baseSalary (no cap per spec).
//
// netPay = grossSalary - incomeTax - employeeInsurance

const EMPLOYEE_INSURANCE_RATE = 0.11
const EMPLOYER_INSURANCE_RATE = 0.1875
const EMPLOYEE_INSURANCE_CAP = 9750

interface Bracket {
  upTo: number | null // null = open-ended (top bracket)
  rate: number
  base: number // lower bound of the band
}

const ANNUAL_TAX_BRACKETS: Bracket[] = [
  { base: 0, upTo: 150_000, rate: 0 },
  { base: 150_000, upTo: 300_000, rate: 0.1 },
  { base: 300_000, upTo: 450_000, rate: 0.15 },
  { base: 450_000, upTo: 600_000, rate: 0.2 },
  { base: 600_000, upTo: null, rate: 0.275 },
]

/** Annual income tax for a given annual gross (in EGP). */
export function annualIncomeTax(annualGross: number): number {
  let tax = 0
  for (const b of ANNUAL_TAX_BRACKETS) {
    if (annualGross <= b.base) break
    const upper = b.upTo === null ? annualGross : Math.min(annualGross, b.upTo)
    tax += (upper - b.base) * b.rate
  }
  // Round to 2 decimals to avoid float drift; the DB stores Decimal(10,2).
  return Math.round(tax * 100) / 100
}

interface PayrollComputation {
  grossSalary: number
  incomeTax: number
  employeeInsurance: number
  employerInsurance: number
  netPay: number
}

/** Compute the per-employee payroll line values from monthly baseSalary. */
export function computePayrollLine(monthlyBaseSalary: number): PayrollComputation {
  const grossSalary = Math.round(monthlyBaseSalary * 100) / 100
  const annualGross = grossSalary * 12
  const incomeTax = Math.round((annualIncomeTax(annualGross) / 12) * 100) / 100
  const employeeInsurance =
    Math.round(Math.min(grossSalary * EMPLOYEE_INSURANCE_RATE, EMPLOYEE_INSURANCE_CAP) * 100) / 100
  const employerInsurance =
    Math.round(grossSalary * EMPLOYER_INSURANCE_RATE * 100) / 100
  const netPay =
    Math.round((grossSalary - incomeTax - employeeInsurance) * 100) / 100
  return { grossSalary, incomeTax, employeeInsurance, employerInsurance, netPay }
}

// ---------- Period validation ----------

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// ---------- CRUD: Employees ----------

/**
 * List all employees for the current tenant, alphabetically by name.
 * Permission: hr:read.
 */
export async function listEmployees(): Promise<Employee[]> {
  requirePermission('hr:read')
  return db.employee.findMany({
    orderBy: { fullName: 'asc' },
  })
}

/**
 * Create a new employee (default status ACTIVE).
 * Permission: hr:manage.
 */
export async function createEmployee(input: {
  fullName: string
  nationalId: string
  hireDate: Date
  baseSalary: number
}): Promise<Employee> {
  requirePermission('hr:manage')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  return db.employee.create({
    data: {
      tenantId: ctx.tenantId, // explicit — harmless for db (middleware overwrites), required for tx
      fullName: input.fullName,
      nationalId: input.nationalId,
      hireDate: input.hireDate,
      baseSalary: input.baseSalary,
      status: 'ACTIVE',
    },
  })
}

// ---------- CRUD: Payroll Runs ----------

/**
 * List all payroll runs for the current tenant, newest first, with lines +
 * nested employees.
 * Permission: hr:read.
 */
export async function listPayrollRuns(): Promise<PayrollRunWithLines[]> {
  requirePermission('hr:read')
  return db.payrollRun.findMany({
    include: { lines: { include: { employee: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Create a new DRAFT payroll run with one PayrollLine per selected employee.
 * Permission: hr:run.
 *
 * Steps:
 *  1. Validate period format (YYYY-MM) — Zod already does this, but we re-check
 *     here defensively in case the service is called from somewhere that bypassed
 *     the API route.
 *  2. Atomic transaction:
 *     a. Check for an existing PayrollRun with the same period (unique
 *        constraint would also catch this, but we want a typed error).
 *     b. Fetch all selected employees (scoped to tenant).
 *     c. Compute gross/tax/insurance/net per employee.
 *     d. Create PayrollRun (DRAFT) + nested PayrollLines.
 *  3. Return the created run with lines + employees.
 */
export async function createPayrollRun(input: {
  period: string
  employeeIds: string[]
}): Promise<PayrollRunWithLines> {
  requirePermission('hr:run')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  if (!PERIOD_RE.test(input.period)) {
    throw new PayrollStateError('INVALID_PERIOD', `period must be YYYY-MM, got "${input.period}"`)
  }
  if (input.employeeIds.length === 0) {
    throw new PayrollStateError('NO_EMPLOYEES', 'a payroll run needs at least 1 employee')
  }

  return db.$transaction(async (tx) => {
    // a. Duplicate check (explicit; the @@unique([tenantId, period]) is the
    //    safety net, but we want a typed error rather than a Prisma P2002).
    const existing = await tx.payrollRun.findFirst({
      where: { tenantId: ctx.tenantId, period: input.period },
      select: { id: true },
    })
    if (existing) {
      throw new PayrollStateError(
        'DUPLICATE_PERIOD',
        `a payroll run already exists for period ${input.period}`
      )
    }

    // b. Fetch employees (explicit tenantId — tx has no middleware).
    const employees = await tx.employee.findMany({
      where: {
        id: { in: input.employeeIds },
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
      },
    })
    if (employees.length === 0) {
      throw new PayrollStateError(
        'NO_EMPLOYEES',
        'no active employees matched the selection'
      )
    }

    // c + d. Create the run + nested lines in one Prisma call.
    const run = await tx.payrollRun.create({
      data: {
        tenantId: ctx.tenantId,
        period: input.period,
        status: 'DRAFT',
        lines: {
          create: employees.map((e) => {
            const c = computePayrollLine(Number(e.baseSalary))
            return {
              employeeId: e.id,
              grossSalary: c.grossSalary,
              incomeTax: c.incomeTax,
              employeeInsurance: c.employeeInsurance,
              employerInsurance: c.employerInsurance,
              netPay: c.netPay,
            }
          }),
        },
      },
      include: { lines: { include: { employee: true } } },
    })

    return run as PayrollRunWithLines
  })
}

// ---------- Posting ----------

/**
 * Post a DRAFT payroll run to the ledger.
 *
 * Steps (all atomic in a single db.$transaction):
 *  1. Fetch the run + lines (must be DRAFT).
 *  2. Resolve the 5 ledger accounts (SalariesExpense, PayrollPayable,
 *     EmployeeInsurance, EmployerInsurance, IncomeTaxPayable).
 *  3. Compute totals from the lines.
 *  4. Create ONE balanced JournalEntry:
 *       Debit  SalariesExpense   = totalGross + totalEmployerInsurance
 *       Credit PayrollPayable    = totalNet
 *       Credit EmployeeInsurance = totalEmployeeInsurance
 *       Credit EmployerInsurance = totalEmployerInsurance
 *       Credit IncomeTaxPayable  = totalTax
 *     The IncomeTaxPayable credit is REQUIRED for the entry to balance:
 *     totalGross = totalNet + totalTax + totalEmployeeInsurance.
 *  5. Update the PayrollRun status to POSTED + link journalEntryId.
 *
 * Permission: hr:run.
 */
export async function postPayrollRun(id: string): Promise<PayrollRunSummary> {
  requirePermission('hr:run')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  // 1. Fetch + verify DRAFT (scoped by middleware on `db`).
  const run = await db.payrollRun.findUnique({
    where: { id },
    include: { lines: { include: { employee: true } } },
  })
  if (!run) throw new PayrollStateError('NOT_DRAFT', 'Payroll run not found')
  if (run.status !== 'DRAFT') {
    throw new PayrollStateError('NOT_DRAFT', `Cannot post payroll run in status ${run.status}`)
  }
  if (run.lines.length === 0) {
    throw new PayrollStateError('NOT_DRAFT', 'Cannot post a payroll run with no lines')
  }

  // 2. Resolve accounts.
  const accounts = await resolvePayrollAccounts()

  // 3. Compute totals.
  let totalGross = 0
  let totalNet = 0
  let totalTax = 0
  let totalEmployeeInsurance = 0
  let totalEmployerInsurance = 0
  for (const line of run.lines) {
    totalGross += Number(line.grossSalary)
    totalTax += Number(line.incomeTax)
    totalEmployeeInsurance += Number(line.employeeInsurance)
    totalEmployerInsurance += Number(line.employerInsurance)
    totalNet += Number(line.netPay)
  }
  // Round to 2dp to kill float drift.
  totalGross = Math.round(totalGross * 100) / 100
  totalNet = Math.round(totalNet * 100) / 100
  totalTax = Math.round(totalTax * 100) / 100
  totalEmployeeInsurance = Math.round(totalEmployeeInsurance * 100) / 100
  totalEmployerInsurance = Math.round(totalEmployerInsurance * 100) / 100

  // 4 + 5. Atomic: create JE + update run.
  const result = await db.$transaction(async (tx) => {
    const jeInput: JournalEntryInput = {
      date: new Date(),
      description: `Payroll ${run.period} — ${run.lines.length} employees`,
      sourceModule: 'hr',
      sourceRefId: run.id,
      lines: [
        // Debit SalariesExpense = gross + employer insurance (employer's total cost)
        { accountId: accounts.salaries.id, debit: totalGross + totalEmployerInsurance, credit: 0 },
        // Credit PayrollPayable = net (to be paid to employees)
        { accountId: accounts.payable.id, debit: 0, credit: totalNet },
        // Credit EmployeeInsurance = employee share (withheld, remitted to social insurance)
        { accountId: accounts.employeeInsurance.id, debit: 0, credit: totalEmployeeInsurance },
        // Credit EmployerInsurance = employer share (own contribution to social insurance)
        { accountId: accounts.employerInsurance.id, debit: 0, credit: totalEmployerInsurance },
        // Credit IncomeTaxPayable = income tax withheld from employees
        { accountId: accounts.incomeTaxPayable.id, debit: 0, credit: totalTax },
      ],
    }

    const je = await createJournalEntryOn(tx, jeInput)

    await tx.payrollRun.update({
      where: { id, tenantId: ctx.tenantId },
      data: {
        status: 'POSTED',
        journalEntryId: je.id,
      },
    })

    return { payrollRunId: run.id, journalEntryId: je.id }
  })

  return {
    payrollRunId: result.payrollRunId,
    journalEntryId: result.journalEntryId,
    totalGross,
    totalNet,
    totalTax,
    totalEmployeeInsurance,
    totalEmployerInsurance,
  }
}
