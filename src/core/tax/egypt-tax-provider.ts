/**
 * Egypt Tax Provider (ETA) — Phase 1 simplified scope.
 *
 * Implements the TaxProvider interface from /upload/03-architecture-decisions.md
 * Decision 6. Per /upload/accounting.md:
 *  - Phase 1 = tax CALCULATION only (14% default, customizable per line)
 *  - generateCompliantDocument returns a PLACEHOLDER clearly marked as
 *    incomplete — NOT a fake UBL XML that looks ready.
 *  - Full ETA XML signing + submission is a future module.
 *
 * Registration: this module self-registers on import. The auth options
 * module imports it at server start so the registry is warm before the
 * first invoice is posted.
 */
import {
  type TaxProvider,
  type InvoiceInput,
  type TaxResult,
  type CompliantDocument,
  registerTaxProvider,
} from '@/core/ledger/tax-provider'

/** Egypt standard VAT rate (14% as of 2024). */
const EG_DEFAULT_VAT_RATE = 0.14

/** Round to 2 decimal places (cent precision) to avoid float drift. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export const egyptTaxProvider: TaxProvider = {
  countryCode: 'EG',

  /**
   * Calculate tax per line. Each line may override the default 14% rate
   * via its `taxRate` field. Uses cent-precision rounding to avoid
   * floating-point drift in financial calculations.
   */
  calculateTax(invoice: InvoiceInput): TaxResult {
    const lines = invoice.lines.map((line) => {
      const rate = line.taxRate ?? EG_DEFAULT_VAT_RATE
      const base = round2(line.amount)
      const tax = round2(base * rate)
      return { base, tax, rate }
    })

    const totalBase = round2(lines.reduce((s, l) => s + l.base, 0))
    const totalTax = round2(lines.reduce((s, l) => s + l.tax, 0))

    return {
      totalBase,
      totalTax,
      total: round2(totalBase + totalTax),
      lines,
    }
  },

  /**
   * Phase 1 placeholder. Does NOT produce a valid ETA-compliant XML document.
   * The real implementation (future module) will generate a signed UBL XML
   * and submit it to the Egyptian Tax Authority's ETA portal.
   *
   * Returning a placeholder (not a fake document) ensures no downstream
   * code accidentally treats this as a real compliant document.
   */
  generateCompliantDocument(_invoice: InvoiceInput & TaxResult): CompliantDocument {
    return {
      format: 'ETA_XML_PLACEHOLDER',
      payload: JSON.stringify({
        status: 'NOT_IMPLEMENTED',
        message:
          'ETA compliant document generation is not implemented in Phase 1. ' +
          'This is a placeholder — do not use as a real tax document. ' +
          'Full ETA XML signing + submission is a future module.',
        plannedFormat: 'ETA_XML_UBL_2.1',
        invoice: {
          totalBase: _invoice.totalBase,
          totalTax: _invoice.totalTax,
          total: _invoice.total,
        },
      }),
    }
  },
}

// Self-register on module import.
registerTaxProvider(egyptTaxProvider)
