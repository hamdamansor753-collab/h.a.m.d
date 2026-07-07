import { withTenantContext } from '@/core/auth/session'
import { listBOMs, createBOM } from '@/modules/manufacturing/production.service'
import { ok, mapError, badRequest } from '@/lib/api'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async () => listBOMs())
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) { return mapError(err, 'en') }
}

const bomComponentSchema = z.object({ rawMaterialProductId: z.string().min(1), quantityPerUnit: z.coerce.number().min(0.01) })
const createBOMSchema = z.object({
  finishedProductId: z.string().min(1),
  laborCostPerUnit: z.coerce.number().min(0).optional(),
  components: z.array(bomComponentSchema).min(1),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = createBOMSchema.safeParse(body)
    if (!parsed.success) return badRequest('en', 'common.error', parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })))
    const result = await withTenantContext(async () => createBOM({ finishedProductId: parsed.data.finishedProductId, laborCostPerUnit: parsed.data.laborCostPerUnit, components: parsed.data.components }), 'POST')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result, 201)
  } catch (err) { return mapError(err, 'en') }
}
