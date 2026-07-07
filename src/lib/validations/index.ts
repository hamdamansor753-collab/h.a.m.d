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

// ---------------- HR / Payroll (Phase 4) ----------------
export const createEmployeeSchema = z.object({
  fullName: z.string().min(1).max(200),
  nationalId: z.string().min(1).max(50),
  hireDate: z.string().datetime(),
  baseSalary: z.coerce.number().min(0),
})

export const createPayrollRunSchema = z.object({
  period: z
    .string()
    .min(1)
    .max(7)
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be in YYYY-MM format'),
  employeeIds: z
    .array(z.string().min(1))
    .min(1, 'a payroll run needs at least 1 employee'),
})

// ---------------- CRM (Phase 5) ----------------
export const createCustomerSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
})

export const createAppointmentSchema = z.object({
  customerId: z.string().min(1),
  scheduledAt: z.string().datetime(),
  note: z.string().max(2000).optional().nullable(),
})

// SCHEDULED is the initial state created by the service; the PATCH endpoint
// only accepts terminal transitions.
export const updateAppointmentStatusSchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED', 'NO_SHOW']),
})

// ---------------- Branding (Phase 7) ----------------
// Color fields must be valid 7-char hex (#RRGGBB). Logo URL must be a
// (possibly empty) http(s) URL. Invoice footer is free-text up to 1000 chars.
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a #RRGGBB hex color');

export const updateBrandingSchema = z.object({
  logoUrl: z
    .string()
    .max(500)
    .url('must be a valid URL')
    .optional()
    .nullable()
    .or(z.literal('')),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  invoiceFooterText: z.string().max(1000).optional().nullable().or(z.literal('')),
});

export const businessTypeSchema = z.enum([
  'general',
  'retail',
  'restaurant',
  'clinic',
  'services',
  'manufacturing',
]);

// ---------------- SaaS Billing (Phase 8) ----------------
// Payment recording by the platform super-admin. `amount` is a positive
// number; `method` is one of the supported manual payment channels (no
// real payment gateway integration in Phase 8 — manual recording only).
export const paymentMethodSchema = z.enum([
  'bank_transfer',
  'instapay',
  'cash',
  'vodafone_cash',
]);

export const recordPaymentSchema = z.object({
  subscriptionId: z.string().min(1),
  amount: z.coerce.number().min(0.01, 'amount must be positive'),
  method: paymentMethodSchema,
});

// ---------------- Industry Activation (Phase 9) ----------------
// Body of PATCH /api/tenant/modules. `moduleKey` must be one of the
// toggleable module keys (kept in sync with ALL_MODULE_KEYS in
// src/modules/branding/industry-modules.ts). `enabled` toggles the
// override — true forces the module visible, false hides it.
export const moduleKeySchema = z.enum([
  'pos',
  'accounts',
  'journal',
  'invoices',
  'inventory',
  'purchases',
  'manufacturing',
  'hr',
  'crm',
  'reports',
  'tests',
  'branding',
]);

export const setModuleOverrideSchema = z.object({
  moduleKey: moduleKeySchema,
  enabled: z.boolean(),
});
