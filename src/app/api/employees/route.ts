/**
 * GET  /api/employees  — list employees (salary fields filtered by permission)
 * POST /api/employees  — create a new employee
 *
 * Salary field filtering:
 *  - hr:read alone → baseSalary and nationalId are STRIPPED from the response
 *  - hr:read + hr:salary:read → all fields included
 *
 * runtime = 'nodejs' (Prisma). Zod-validated. Service-only Prisma.
 */
import { withTenantContext } from '@/core/auth/session'
import { listEmployees, createEmployee, getEmployee } from '@/modules/hr/employee.service'
import { createEmployeeSchema } from '@/lib/validations'
import { ok, mapError, badRequest } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    const result = await withTenantContext(async (ctx) => {
      const canReadSalary = ctx.permissionKeys.includes('hr:salary:read')
      if (id) {
        return getEmployee(id, canReadSalary)
      }
      return listEmployees(canReadSalary)
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
    const parsed = createEmployeeSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }
    const result = await withTenantContext(async () =>
      createEmployee({
        fullName: parsed.data.fullName,
        nationalId: parsed.data.nationalId,
        hireDate: new Date(parsed.data.hireDate),
        baseSalary: parsed.data.baseSalary,
        status: parsed.data.status,
      })
    )
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result, 201)
  } catch (err) {
    return mapError(err, 'en')
  }
}
