/**
 * GET  /api/accounts         — list accounts for current tenant
 * POST /api/accounts         — create account
 *
 * runtime = 'nodejs' (Prisma). All input via Zod. No direct Prisma calls —
 * everything goes through account.service.ts.
 */
import { withTenantContext } from '@/core/auth/session'
import { listAccounts, createAccount, buildAccountTree } from '@/core/ledger/account.service'
import { createAccountSchema } from '@/lib/validations'
import { ok, mapError, badRequest } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async () => {
      const accounts = await listAccounts()
      return { flat: accounts, tree: buildAccountTree(accounts) }
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
    const parsed = createAccountSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }
    const result = await withTenantContext(async () => {
      return createAccount(parsed.data)
    }, 'POST')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result, 201)
  } catch (err) {
    return mapError(err, 'en')
  }
}
