/**
 * Egypt Payroll Rule Provider — Production Hardening (7 progressive brackets).
 *
 * ==================================================================
 * ⚠️  LEGAL DISCLAIMER:
 * The tax brackets and insurance rates below are based on Egyptian
 * Income Tax Law No. 91 of 2005 as amended by Law No. 7 of 2024,
 * effective 2026. They MUST be verified with a certified accountant
 * before use with real payroll — tax laws change by ministerial decree,
 * and details (personal exemption, insurance caps) may differ from
 * the latest published rates.
 *
 * Source: Egyptian Tax Authority + Ministry of Finance publications.
 * Last reviewed: July 2026.
 * ==================================================================
 *
 * Per /upload/production-hardening.md:
 *  - 7 progressive annual tax brackets
 *  - Social insurance: employee 11% / employer 19%, capped at 10,500 EGP/month
 *  - Tax calculated ANNUALLY then divided by 12 (not monthly brackets)
 */
import {
  type PayrollRuleProvider,
  type PayrollInput,
  type PayrollResult,
  registerPayrollProvider,
} from './provider'

// =====================================================================
// TAX BRACKETS — ANNUAL (EGP/year)
// Per Law 7/2024. Edit these constants if rates change.
// ⚠️ Verify with a certified accountant before production use.
// =====================================================================

interface TaxBracket {
  /** Upper limit of this bracket (annual, EGP). Infinity for the top bracket. */
  upTo: number
  /** Tax rate for this bracket (e.g., 0.10 = 10%). */
  rate: number
}

const EG_TAX_BRACKETS: TaxBracket[] = [
  { upTo: 40_000,      rate: 0.00 },   // Exempt
  { upTo: 55_000,      rate: 0.10 },   // 10%
  { upTo: 70_000,      rate: 0.15 },   // 15%
  { upTo: 200_000,     rate: 0.20 },   // 20%
  { upTo: 400_000,     rate: 0.225 },  // 22.5%
  { upTo: 1_200_000,   rate: 0.25 },   // 25%
  { upTo: Infinity,    rate: 0.275 },  // 27.5%
]

// =====================================================================
// SOCIAL INSURANCE — Per Law 148 of 2019 as amended.
// ⚠️ Verify with a certified accountant before production use.
// =====================================================================

/** Employee's share of social insurance (percentage of insured salary). */
const EG_EMPLOYEE_INSURANCE_RATE = 0.11 // 11%

/** Employer's share of social insurance (percentage of insured salary). */
const EG_EMPLOYER_INSURANCE_RATE = 0.19 // 19%

/** Maximum monthly insured salary (cap for insurance calculation). */
const EG_INSURANCE_SALARY_CAP = 10_500 // EGP/month — any salary above this is capped

/** Round to 2 decimal places (cent precision). */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Calculate progressive income tax on an ANNUAL taxable income.
 * Each bracket is taxed at its own rate (not a flat rate on the total).
 *
 * Example: annual taxable = 50,000
 *   Bracket 1: 0–40,000 @ 0%   = 0
 *   Bracket 2: 40,001–50,000 @ 10% = 1,000
 *   Total annual tax = 1,000 → monthly = 83.33
 */
function calculateProgressiveTax(annualTaxableIncome: number): number {
  let tax = 0
  let remaining = annualTaxableIncome
  let prevLimit = 0

  for (const bracket of EG_TAX_BRACKETS) {
    if (remaining <= 0) break

    const bracketWidth = bracket.upTo - prevLimit
    const taxedInThisBracket = Math.min(remaining, bracketWidth)
    tax += taxedInThisBracket * bracket.rate
    remaining -= taxedInThisBracket
    prevLimit = bracket.upTo
  }

  return round2(tax)
}

export const egyptPayrollProvider: PayrollRuleProvider = {
  countryCode: 'EG',

  /**
   * Production-grade payroll calculation:
   *  1. Social insurance is calculated on the CAPPED insured salary
   *     (min(gross, 10,500 EGP/month)).
   *  2. Employee insurance = cappedSalary × 11% (deducted from employee).
   *  3. Employer insurance = cappedSalary × 19% (extra cost, NOT deducted).
   *  4. Annual taxable income = (gross - employeeInsurance) × 12.
   *  5. Annual income tax = progressive calculation across 7 brackets.
   *  6. Monthly income tax = annual tax / 12.
   *  7. Net pay = gross - employeeInsurance - monthlyTax.
   *
   * Key principle: tax is calculated ANNUALLY (not per-month) and then
   * divided by 12. This matches how the Egyptian Tax Authority processes
   * payroll — the annual bracket structure applies, not a monthly one.
   */
  calculatePayroll(input: PayrollInput): PayrollResult {
    const monthlyGross = round2(input.grossSalary)

    // 1. Cap the insured salary for insurance calculation
    const insuredSalary = Math.min(monthlyGross, EG_INSURANCE_SALARY_CAP)

    // 2. Social insurance (employee share — deducted from gross)
    const employeeInsurance = round2(insuredSalary * EG_EMPLOYEE_INSURANCE_RATE)

    // 3. Social insurance (employer share — extra cost, NOT deducted from employee)
    const employerInsurance = round2(insuredSalary * EG_EMPLOYER_INSURANCE_RATE)

    // 4. Calculate annual taxable income
    //    = (monthly gross - monthly employee insurance) × 12 months
    const monthlyTaxableIncome = Math.max(0, monthlyGross - employeeInsurance)
    const annualTaxableIncome = monthlyTaxableIncome * 12

    // 5. Calculate annual tax using progressive brackets
    const annualTax = calculateProgressiveTax(annualTaxableIncome)

    // 6. Convert to monthly tax
    const incomeTax = round2(annualTax / 12)

    // 7. Net pay = gross - employee insurance - income tax
    const netPay = round2(monthlyGross - employeeInsurance - incomeTax)

    return {
      grossSalary: monthlyGross,
      incomeTax,
      employeeInsurance,
      employerInsurance,
      netPay,
    }
  },
}

// Self-register on module import.
registerPayrollProvider(egyptPayrollProvider)
