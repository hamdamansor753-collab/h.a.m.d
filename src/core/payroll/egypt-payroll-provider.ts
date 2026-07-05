/**
 * Egypt Payroll Rule Provider — Phase 4 SIMPLIFIED scope.
 *
 * ==================================================================
 * IMPORTANT: This is a SIMPLIFIED approximation, NOT a production-ready
 * implementation of Egyptian payroll tax law. The real Egyptian income
 * tax law has multiple progressive brackets (10%, 15%, 20%, 22.5%, 25%),
 * a personal exemption of 9,000 EGP/year, and complex social insurance
 * calculations with caps. Full accuracy is a future module.
 *
 * This provider uses:
 *  - A SINGLE flat tax rate (10%) on gross salary above a threshold —
 *    a rough approximation of the lowest bracket.
 *  - A FIXED social insurance rate: employee 14% / employer 11% of gross
 *    (roughly matching the current Egyptian rates, without caps).
 *
 * These are clearly marked as placeholders. Replace before production.
 * ==================================================================
 */
import {
  type PayrollRuleProvider,
  type PayrollInput,
  type PayrollResult,
  registerPayrollProvider,
} from './provider'

/** Simplified flat income tax rate (placeholder for progressive brackets). */
const EG_FLAT_TAX_RATE = 0.10

/** Monthly personal exemption threshold (no tax below this). */
const EG_TAX_THRESHOLD = 5000 // EGP/month — simplified

/** Employee social insurance rate (roughly 14% in Egypt). */
const EG_EMPLOYEE_INSURANCE_RATE = 0.14

/** Employer social insurance rate (roughly 11% in Egypt). */
const EG_EMPLOYER_INSURANCE_RATE = 0.11

/** Round to 2 decimal places (cent precision). */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export const egyptPayrollProvider: PayrollRuleProvider = {
  countryCode: 'EG',

  /**
   * Simplified payroll calculation:
   *  1. Employee insurance = gross × 14% (deducted from employee)
   *  2. Employer insurance = gross × 11% (extra cost on employer)
   *  3. Taxable income = gross - employee insurance - threshold
   *     (if taxable <= 0, no tax)
   *  4. Income tax = taxable × 10% (flat, placeholder for brackets)
   *  5. Net pay = gross - employee insurance - income tax
   */
  calculatePayroll(input: PayrollInput): PayrollResult {
    const gross = round2(input.grossSalary)

    // 1. Social insurance (employee share)
    const employeeInsurance = round2(gross * EG_EMPLOYEE_INSURANCE_RATE)

    // 2. Social insurance (employer share — NOT deducted from employee)
    const employerInsurance = round2(gross * EG_EMPLOYER_INSURANCE_RATE)

    // 3. Taxable income after insurance deduction + personal threshold
    const taxableIncome = Math.max(0, gross - employeeInsurance - EG_TAX_THRESHOLD)

    // 4. Income tax (simplified flat rate)
    const incomeTax = round2(taxableIncome * EG_FLAT_TAX_RATE)

    // 5. Net pay
    const netPay = round2(gross - employeeInsurance - incomeTax)

    return {
      grossSalary: gross,
      incomeTax,
      employeeInsurance,
      employerInsurance,
      netPay,
    }
  },
}

// Self-register on module import.
registerPayrollProvider(egyptPayrollProvider)
