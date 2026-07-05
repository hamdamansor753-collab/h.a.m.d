/**
 * GET  /api/invoices/:id   — get a single invoice (with JE links if posted)
 * PATCH /api/invoices/:id  — update a DRAFT invoice (refuses POSTED/VOID)
 *
 * runtime = 'nodejs' (Prisma). Zod-validated. Service-only Prisma.
 */
import { withTenantContext } from '@/core/auth/session'
import { getInvoice, updateInvoice } from '@/modules/accounting/invoice.service'
import { updateInvoiceSchema } from '@/lib/validations'
import { ok, mapError, badRequest, notFound } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const result = await withTenantContext(async () => {
      return getInvoice(id)
    })
    if (result.status === 401) return ok({ authenticated: false }, 401)
    if (!result) return notFound('en', 'invoice.notFound')
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const parsed = updateInvoiceSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }
    const result = await withTenantContext(async () => {
      return updateInvoice(id, {
        customerName: parsed.data.customerName,
        date: parsed.data.date ? new Date(parsed.data.date) : undefined,
        lines: parsed.data.lines?.map((l) => ({
          description: l.description,
          amount: l.amount,
          taxRate: l.taxRate,
        })),
      })
    })
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
