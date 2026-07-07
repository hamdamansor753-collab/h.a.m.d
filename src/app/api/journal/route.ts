/**
 * GET  /api/journal          — list journal entries for current tenant
 * POST /api/journal          — create balanced journal entry
 *
 * The POST handler ENFORCES the double-entry invariant in the service
 * layer BEFORE any DB write. An unbalanced entry is rejected with 400
 * and a translated error message (see /api/tests for the runtime test).
 *
 * runtime = 'nodejs' (Prisma). Zod-validated. Service-only Prisma.
 */
import { withTenantContext } from '@/core/auth/session'
import { listJournalEntries, createJournalEntry } from '@/core/ledger/journal-entry.service'
import { createJournalEntrySchema } from '@/lib/validations'
import { ok, mapError, badRequest } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async () => {
      return listJournalEntries()
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
    const parsed = createJournalEntrySchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }
    const data = {
      date: new Date(parsed.data.date),
      description: parsed.data.description,
      sourceModule: parsed.data.sourceModule,
      sourceRefId: parsed.data.sourceRefId,
      lines: parsed.data.lines.map((l) => ({
        accountId: l.accountId,
        debit: Number(l.debit),
        credit: Number(l.credit),
      })),
    }
    const result = await withTenantContext(async () => {
      return createJournalEntry(data)
    }, 'POST')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result, 201)
  } catch (err) {
    return mapError(err, 'en')
  }
}
