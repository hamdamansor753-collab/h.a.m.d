/**
 * Prisma client setup with tenant isolation.
 *
 * Exports:
 *  - `db`     — a Proxy over PrismaClient. For tenant-scoped models
 *               (user, account, journalEntry), it dispatches to a per-tenant
 *               extended client where `tenantId` is captured in a CLOSURE
 *               (not AsyncLocalStorage — Prisma 6's $extends query handlers
 *               run in a separate async context that ALS does not propagate
 *               into). For non-scoped models (translation, role, permission,
 *               tenant), it dispatches to the raw client directly.
 *
 *               FAIL-CLOSED: accessing a scoped model delegate without an
 *               active tenant context throws immediately.
 *
 *  - `dbRaw`  — the raw PrismaClient with NO middleware. Used ONLY by:
 *               * the auth credentials provider (cross-tenant email lookup)
 *               * the seed script
 *               * the tenant-isolation test endpoint
 *               * future super-admin cross-tenant operations
 *               Every `dbRaw` usage is auditable via grep and documented
 *               at the call site.
 *
 * Why not AsyncLocalStorage inside $extends: Prisma 6's $extends query
 * handlers run in Prisma's internal async context, which does NOT inherit
 * the caller's AsyncLocalStorage store. Capturing tenantId in the closure
 * at extension-creation time is the reliable approach. Per-tenant extended
 * clients are cached so there's no per-request overhead.
 */
import { PrismaClient } from '@prisma/client'
import { getTenantContext } from '@/core/tenancy/context'

const globalForPrisma = globalThis as unknown as {
  prismaRaw: PrismaClient | undefined
  prismaProxy: PrismaClient | undefined
}

function createRawClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
    // Supabase session-mode pooler has a 5s default transaction timeout.
    // Increase to 30s for complex multi-step transactions (POS sale, PO receive, payroll).
    transactionOptions: {
      timeout: 30000,
      maxWait: 10000,
    },
  })
}

/** Raw client — no middleware. */
export const dbRaw = globalForPrisma.prismaRaw ?? createRawClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaRaw = dbRaw

// ---------- Per-tenant extended client cache ----------

const READ_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
  'findMany', 'aggregate', 'groupBy', 'count',
])
const WRITE_OPS = new Set([
  'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
])

function injectTenant<T extends Record<string, unknown>>(args: T, operation: string, tenantId: string): T {
  if (READ_OPS.has(operation)) {
    const where = ((args.where ?? {}) as Record<string, unknown>)
    where.tenantId = tenantId
    args.where = where
  } else if (WRITE_OPS.has(operation)) {
    if (operation === 'create') {
      const data = ((args.data ?? {}) as Record<string, unknown>)
      data.tenantId = tenantId
      args.data = data
    } else if (operation === 'createMany') {
      const data = args.data
      if (Array.isArray(data)) {
        args.data = data.map((d) => ({ ...d, tenantId }))
      } else if (data && typeof data === 'object') {
        args.data = { ...(data as object), tenantId }
      }
    } else if (operation === 'update' || operation === 'updateMany' || operation === 'delete' || operation === 'deleteMany') {
      const where = ((args.where ?? {}) as Record<string, unknown>)
      where.tenantId = tenantId
      args.where = where
      if (operation === 'update' && args.data && typeof args.data === 'object') {
        delete (args.data as Record<string, unknown>).tenantId
      }
    } else if (operation === 'upsert') {
      const where = ((args.where ?? {}) as Record<string, unknown>)
      where.tenantId = tenantId
      args.where = where
      const create = ((args.create ?? {}) as Record<string, unknown>)
      create.tenantId = tenantId
      args.create = create
      if (args.update && typeof args.update === 'object') {
        delete (args.update as Record<string, unknown>).tenantId
      }
    }
  }
  return args
}

function makeScopedHandler(model: string, tenantId: string) {
  return async function (params: { operation: string; args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
    const mutated = injectTenant(params.args as Record<string, unknown>, params.operation, tenantId)
    return params.query(mutated)
  }
}

const scopedClientCache = new Map<string, PrismaClient>()

function getScopedClient(tenantId: string): PrismaClient {
  let cached = scopedClientCache.get(tenantId)
  if (cached) return cached
  // Build a new extended client that captures tenantId in the closure.
  cached = dbRaw.$extends({
    query: {
      user: { $allOperations: makeScopedHandler('user', tenantId) },
      account: { $allOperations: makeScopedHandler('account', tenantId) },
      journalEntry: { $allOperations: makeScopedHandler('journalEntry', tenantId) },
      invoice: { $allOperations: makeScopedHandler('invoice', tenantId) },
      // Phase 2: inventory models with tenantId
      warehouse: { $allOperations: makeScopedHandler('warehouse', tenantId) },
      product: { $allOperations: makeScopedHandler('product', tenantId) },
      stockMovement: { $allOperations: makeScopedHandler('stockMovement', tenantId) },
      purchaseOrder: { $allOperations: makeScopedHandler('purchaseOrder', tenantId) },
      // Phase 4: HR models with tenantId
      employee: { $allOperations: makeScopedHandler('employee', tenantId) },
      payrollRun: { $allOperations: makeScopedHandler('payrollRun', tenantId) },
      // Phase 5: CRM models with tenantId
      customer: { $allOperations: makeScopedHandler('customer', tenantId) },
      appointment: { $allOperations: makeScopedHandler('appointment', tenantId) },
      activityLog: { $allOperations: makeScopedHandler('activityLog', tenantId) },
    },
  }) as unknown as PrismaClient
  scopedClientCache.set(tenantId, cached)
  return cached
}

// ---------- The default `db` Proxy ----------

// Delegate names that require tenant scoping. Any other delegate
// (translation, role, permission, tenant, invoiceLine, journalLine,
//  stockLevel, purchaseOrderLine) passes through to dbRaw. NOTE: the
// unscoped child models (invoiceLine, journalLine, stockLevel,
// purchaseOrderLine) have NO tenantId column — they inherit scope from
// their parent (Invoice / JournalEntry / Product+Warehouse / PurchaseOrder).
// They must ONLY be accessed via nested include/create under their scoped
// parent, never queried directly via db.stockLevel / db.purchaseOrderLine.
const TENANT_SCOPED_DELEGATES = new Set([
  'user', 'account', 'journalEntry', 'invoice',
  'warehouse', 'product', 'stockMovement', 'purchaseOrder',
  'employee', 'payrollRun',
  'customer', 'appointment', 'activityLog',
])

function createDbProxy(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop, _receiver) {
      const name = String(prop)
      // Allow internal/non-model property access (symbols, $ methods, etc.)
      // to fall through to the raw client. Specifically: $transaction,
      // $connect, $disconnect, $on, $use.
      if (typeof prop !== 'string' || name.startsWith('$') || name.startsWith('_')) {
        const val = (dbRaw as unknown as Record<string, unknown>)[name]
        return typeof val === 'function' ? val.bind(dbRaw) : val
      }
      if (TENANT_SCOPED_DELEGATES.has(name)) {
        const ctx = getTenantContext()
        if (!ctx) {
          throw new Error(
            `[tenant-middleware] Refusing to access ${name} without a tenant context. ` +
              `If this is intentional (auth/seed/super-admin), use dbRaw from @/lib/db instead of db.`
          )
        }
        const scoped = getScopedClient(ctx.tenantId)
        return (scoped as unknown as Record<string, unknown>)[name]
      }
      // Non-scoped delegate: pass through to raw client.
      return (dbRaw as unknown as Record<string, unknown>)[name]
    },
  }) as unknown as PrismaClient
}

export const db = globalForPrisma.prismaProxy ?? createDbProxy()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaProxy = db
