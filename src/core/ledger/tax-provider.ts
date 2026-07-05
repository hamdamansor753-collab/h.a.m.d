/**
 * Pluggable Tax Provider interface (per /upload/03-architecture-decisions.md
 * Decision 6). Country-specific implementations register themselves in
 * the registry. The accounting module never contains country-specific
 * tax logic.
 *
 * Phase 0 ships ONLY the interface and registry skeleton — concrete EG/SA
 * implementations (ETA XML, ZATCA UBL) are deferred to later phases.
 */

export interface InvoiceLineInput {
  amount: number
  taxRate?: number
  description?: string
}

export interface InvoiceInput {
  countryCode: string
  lines: InvoiceLineInput[]
}

export interface TaxLine {
  base: number
  tax: number
  rate: number
}

export interface TaxResult {
  totalBase: number
  totalTax: number
  total: number
  lines: TaxLine[]
}

export interface CompliantDocument {
  format: string // "ETA_XML" | "ZATCA_UBL" | ...
  payload: string
}

export interface TaxProvider {
  readonly countryCode: string
  calculateTax(invoice: InvoiceInput): TaxResult
  generateCompliantDocument(invoice: InvoiceInput & TaxResult): CompliantDocument
}

const registry = new Map<string, TaxProvider>()

export function registerTaxProvider(provider: TaxProvider): void {
  registry.set(provider.countryCode.toUpperCase(), provider)
}

export function getTaxProvider(countryCode: string): TaxProvider | undefined {
  return registry.get(countryCode.toUpperCase())
}
