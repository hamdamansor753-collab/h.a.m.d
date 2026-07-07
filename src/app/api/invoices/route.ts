/**
 * GET  /api/invoices         — list invoices for current tenant
 * POST /api/invoices         — create a new DRAFT invoice
 *
 * runtime = 'nodejs' (Prisma). Zod-validated. Service-only Prisma.
 */
import { withTenantContext } from '@/core/auth/session'
import { listInvoices, createInvoice } from '@/modules/accounting/invoice.service'
import { createInvoiceSchema } from '@/lib/validations'
import { ok, mapError, badRequest } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async () => {
      return listInvoices()
    })
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = createInvoiceSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }
    const result = await withTenantContext(async () => {
      return createInvoice({
        customerName: parsed.data.customerName,
        date: new Date(parsed.data.date),
        lines: parsed.data.lines.map((l) => ({
          description: l.description,
          amount: l.amount,
          taxRate: l.taxRate,
        })),
      })
    }, 'POST')
    // NOTE: use `result.status === 401` not `'status' in result` — the invoice
    // object has a `status` field (InvoiceStatus) that would false-positive.
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result, 201)
  } catch (err) {
    return mapError(err, 'en')
  }
}
