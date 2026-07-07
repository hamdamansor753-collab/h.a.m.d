/**
 * Pluggable Payroll Rule Provider interface (per /upload/hr.md).
 *
 * Same pluggable philosophy as TaxProvider (Phase 1): country-specific
 * payroll rules (income tax brackets, social insurance rates, etc.) are
 * implemented in separate providers registered in a central registry.
 * The payroll service NEVER contains country-specific calculation logic.
 *
 * Phase 4 ships the Egypt provider only. Saudi/other providers are future.
 */

export interface PayrollInput {
  countryCode: string
  /** The employee's gross monthly salary (base + allowances). */
  grossSalary: number
}

export interface PayrollResult {
  /** Gross salary (echoed for clarity). */
  grossSalary: number
  /** Income tax withheld (0 if no income tax applies). */
  incomeTax: number
  /** Employee's share of social insurance (deducted from gross). */
  employeeInsurance: number
  /** Employer's share of social insurance (extra cost, NOT deducted from employee). */
  employerInsurance: number
  /** Net pay = grossSalary - incomeTax - employeeInsurance. */
  netPay: number
}

export interface PayrollRuleProvider {
  readonly countryCode: string
  calculatePayroll(input: PayrollInput): PayrollResult
}

const registry = new Map<string, PayrollRuleProvider>()

export function registerPayrollProvider(provider: PayrollRuleProvider): void {
  registry.set(provider.countryCode.toUpperCase(), provider)
}

export function getPayrollProvider(countryCode: string): PayrollRuleProvider | undefined {
  return registry.get(countryCode.toUpperCase())
}
