/**
 * Zod validation schemas for ALL user inputs that reach the service layer.
 * Per /upload/05-security-baseline.md section 2: "every user input is
 * validated by a Zod schema before reaching the service layer — no
 * exceptions".
 *
 * Per /upload/05-security-baseline.md section 6: we use `.issues` (not
 * `.errors`) when reading Zod results — this is the Zod 4 API.
 */
import { z } from 'zod'

// ---------------- Auth ----------------
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
})

// ---------------- Accounts ----------------
export const accountTypeSchema = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'])

export const createAccountSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[0-9]+(\.[0-9]+)*$/, 'code must be dot-separated digits'),
  nameKey: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(\.[a-z0-9]+)+$/, 'nameKey must be a dotted translation key'),
  type: accountTypeSchema,
  parentId: z.string().uuid().optional().nullable(),
})

// ---------------- Journal ----------------
export const journalLineInputSchema = z.object({
  accountId: z.string().uuid(),
  debit: z.string().or(z.number()).default(0),
  credit: z.string().or(z.number()).default(0),
})

export const createJournalEntrySchema = z.object({
  date: z.string().datetime(),
  description: z.string().min(1).max(500),
  sourceModule: z.enum(['accounting', 'inventory', 'pos', 'hr']).default('accounting'),
  sourceRefId: z.string().min(1).max(100),
  lines: z.array(journalLineInputSchema).min(2, 'a journal entry needs at least 2 lines'),
})

// ---------------- Locale ----------------
export const localeSchema = z.enum(['ar-EG', 'ar-SA', 'en'])

// ---------------- Invoices (Phase 1) ----------------
export const invoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  amount: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(1).default(0),
})

export const createInvoiceSchema = z.object({
  customerName: z.string().min(1).max(200),
  date: z.string().datetime(),
  lines: z.array(invoiceLineSchema).min(1, 'an invoice needs at least 1 line'),
})

export const updateInvoiceSchema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  date: z.string().datetime().optional(),
  lines: z.array(invoiceLineSchema).min(1).optional(),
})

// ---------------- Inventory (Phase 2) ----------------
export const createProductSchema = z.object({
  sku: z.string().min(1).max(50),
  nameKey: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(\.[a-z0-9]+)+$/, 'nameKey must be a dotted translation key'),
  sellPrice: z.coerce.number().min(0),
})

export const createWarehouseSchema = z.object({
  nameKey: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(\.[a-z0-9]+)+$/, 'nameKey must be a dotted translation key'),
  isDefault: z.boolean().optional(),
})

export const purchaseOrderLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().min(0.01, 'quantity must be positive'),
  unitCost: z.coerce.number().min(0),
  warehouseId: z.string().min(1),
})

export const createPurchaseOrderSchema = z.object({
  supplierName: z.string().min(1).max(200),
  date: z.string().datetime(),
  lines: z.array(purchaseOrderLineSchema).min(1, 'a purchase order needs at least 1 line'),
})

// ---------------- POS (Phase 3) ----------------
export const posSaleLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().min(0.01, 'quantity must be positive'),
  unitPrice: z.coerce.number().min(0),
})

export const posSaleSchema = z.object({
  warehouseId: z.string().min(1),
  customerName: z.string().min(1).max(200),
  lines: z.array(posSaleLineSchema).min(1, 'a POS sale needs at least 1 line'),
})

// ---------------- HR & Payroll (Phase 4) ----------------
export const createEmployeeSchema = z.object({
  fullName: z.string().min(1).max(200),
  nationalId: z.string().min(1).max(50),
  hireDate: z.string().datetime(),
  baseSalary: z.coerce.number().min(0),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TERMINATED']).optional(),
})

export const createPayrollRunSchema = z.object({
  period: z
    .string()
    .min(1)
    .max(10)
    .regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM format'),
})

// ---------------- CRM (Phase 5) ----------------
export const createCustomerSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(200).optional(),
})

export const scheduleAppointmentSchema = z.object({
  customerId: z.string().min(1),
  scheduledAt: z.string().datetime(),
  note: z.string().max(500).optional(),
})
