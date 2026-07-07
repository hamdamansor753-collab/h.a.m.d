/**
 * Phase 7 — Branding & Business Templates service.
 *
 * Per /upload/product-customization.md:
 *  - BrandSettings is a per-tenant visual customization layer (logo, colors,
 *    invoice footer). It is OPTIONAL — a tenant without a BrandSettings row
 *    keeps working with the H.A.M.D default navy/cyan identity. No
 *    `if (businessType === ...)` branches in business code.
 *  - `getBusinessTypeSeedExtras(businessType)` is the ONLY place where the
 *    business-type affects the system. It returns extra chart-of-accounts
 *    seeds for newly-onboarded tenants (retail/restaurant/clinic/services/
 *    manufacturing). It is a PURE function used only at onboarding time;
 *    it does NOT mutate state and has NO DB access.
 *
 * Permission model:
 *  - Reading branding: any authenticated user in the tenant (no permission
 *    check — branding must render for the cashier at the POS, etc.).
 *  - Updating branding: requires `tenant:manage` (admin only).
 *
 * Tenant isolation:
 *  - BrandSettings is a tenant-scoped model (PK = tenantId) but it is NOT in
 *    the `TENANT_SCOPED_DELEGATES` set in `@/lib/db` (because the proxy only
 *    auto-injects tenantId for the standard CRUD delegates). We therefore
 *    use `dbRaw.brandSettings` for reads/writes and pass `tenantId`
 *    explicitly — the `tenantId` we pass is ALWAYS the one from the active
 *    tenant context (`requireTenantContext`), so isolation is preserved.
 *    (Phase 0 design rule: per-tenant extended clients are only built for
 *    models with `tenantId` columns that participate in CRUD list flows.
 *    BrandSettings is a singleton-per-tenant and was intentionally left out
 *    of the proxy set; doing so now would risk regenerating the cache.)
 */
import { dbRaw } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import type { AccountType, BrandSettings, TenantModuleOverride } from '@prisma/client'
import { getEffectiveModules as resolveEffectiveModules } from './industry-modules'

// ---------- Types ----------

export interface BrandSettingsInput {
  logoUrl?: string | null
  primaryColor?: string
  accentColor?: string
  invoiceFooterText?: string | null
}

export interface BrandSettingsView {
  tenantId: string
  logoUrl: string | null
  primaryColor: string
  accentColor: string
  invoiceFooterText: string | null
  updatedAt: string
}

/** H.A.M.D default identity (per /upload/01-brand-identity.md). */
export const DEFAULT_PRIMARY_COLOR = '#0f172a' // navy
export const DEFAULT_ACCENT_COLOR = '#06b6d4'  // cyan

/** A pure seed-extra entry: a chart-of-accounts row to add for a tenant. */
export interface BusinessTypeSeedAccount {
  /** Stable dotted i18n key — must exist in the Translation table. */
  nameKey: string
  /** Account type for the new row. */
  type: AccountType
  /** Parent account code (under expense/revenue root). Resolved by caller. */
  parentCode: string
  /** Suggested code suffix for the new account (caller appends to tenant prefix). */
  codeSuffix: string
}

// ---------- Service ----------

/**
 * Return the BrandSettings for the current tenant, or `null` if the tenant
 * has not customized branding (caller should fall back to H.A.M.D defaults).
 */
export async function getBranding(
  tenantId: string
): Promise<BrandSettingsView | null> {
  const row = await dbRaw.brandSettings.findUnique({
    where: { tenantId },
  })
  return row ? toView(row) : null
}

/**
 * Update (or create) the BrandSettings for the current tenant.
 *
 * Requires `tenant:manage`. Only the supplied fields are touched; omitted
 * fields keep their current value (or the schema default on first create).
 *
 * Validation (color hex format, URL shape) is enforced by the Zod schema in
 * `@/lib/validations` at the API boundary. The service trusts the parsed
 * payload but defensively trims/falls back for empty strings.
 */
export async function updateBranding(
  tenantId: string,
  input: BrandSettingsInput
): Promise<BrandSettingsView> {
  requirePermission('tenant:manage')

  // Coerce: treat empty-string inputs as null/undefined so the upsert `update`
  // map doesn't overwrite existing values with empties when the user clears
  // the field in the UI.
  const data: Record<string, unknown> = {}
  if (input.logoUrl !== undefined) {
    data.logoUrl = input.logoUrl && input.logoUrl.trim().length > 0 ? input.logoUrl.trim() : null
  }
  if (input.primaryColor !== undefined && input.primaryColor.trim().length > 0) {
    data.primaryColor = input.primaryColor.trim()
  }
  if (input.accentColor !== undefined && input.accentColor.trim().length > 0) {
    data.accentColor = input.accentColor.trim()
  }
  if (input.invoiceFooterText !== undefined) {
    data.invoiceFooterText =
      input.invoiceFooterText && input.invoiceFooterText.trim().length > 0
        ? input.invoiceFooterText.trim()
        : null
  }

  const updated = await dbRaw.brandSettings.upsert({
    where: { tenantId },
    // On a fresh create, fill required defaults for any field the caller
    // didn't supply so the row is always valid. `updatedAt` has no
    // `@updatedAt`/`@default` in the current schema, so we set it explicitly
    // here (and on every update below) to keep the column meaningful.
    create: {
      tenantId,
      logoUrl: (data.logoUrl as string | null) ?? null,
      primaryColor: (data.primaryColor as string) ?? DEFAULT_PRIMARY_COLOR,
      accentColor: (data.accentColor as string) ?? DEFAULT_ACCENT_COLOR,
      invoiceFooterText: (data.invoiceFooterText as string | null) ?? null,
      updatedAt: new Date(),
    },
    // On update, only patch the supplied fields. Always bump `updatedAt`
    // so the panel can show "last saved at".
    update: { ...data, updatedAt: new Date() },
  })

  return toView(updated)
}

// ---------- Business-type seed extras (PURE) ----------

/**
 * Return the EXTRA chart-of-accounts rows that should be seeded for a tenant
 * with the given business type, on top of the general starter chart.
 *
 * PURE function — no I/O, no side effects. The onboarding flow calls this
 * once per new tenant, resolves the parent account by code, and inserts the
 * extra rows.
 *
 * Per /upload/product-customization.md:
 *  - retail → account.salesDiscounts (EXPENSE)
 *  - restaurant → account.kitchenWaste (EXPENSE)
 *  - clinic → account.consultationFees (REVENUE)
 *  - services → [] (the general starter chart is sufficient)
 *  - general → []
 *  - manufacturing → [] (manufacturing accounts are already in the seed)
 *
 * Unknown business types safely return [] (no throw) — onboarding continues
 * with the general chart.
 */
export function getBusinessTypeSeedExtras(
  businessType: string
): BusinessTypeSeedAccount[] {
  switch (businessType) {
    case 'retail':
      return [
        {
          nameKey: 'account.salesDiscounts',
          type: 'EXPENSE' as AccountType,
          parentCode: '5000', // expense root — caller resolves per-tenant
          codeSuffix: '5099',
        },
      ]
    case 'restaurant':
      return [
        {
          nameKey: 'account.kitchenWaste',
          type: 'EXPENSE' as AccountType,
          parentCode: '5000',
          codeSuffix: '5098',
        },
      ]
    case 'clinic':
      return [
        {
          nameKey: 'account.consultationFees',
          type: 'REVENUE' as AccountType,
          parentCode: '4000', // revenue root
          codeSuffix: '4099',
        },
      ]
    case 'services':
    case 'general':
    case 'manufacturing':
      return []
    default:
      return []
  }
}

// ---------- Active-module resolver (Phase 9 — Industry Activation) ----------
//
// Phase 9 swaps the previous "always return the full module set" stub with a
// real resolver backed by `INDUSTRY_MODULE_MAP` + `TenantModuleOverride`.
// See `./industry-modules.ts` for the static map and the override logic.
//
// Architecture rule (per /upload/industry-activation.md):
//  - businessType controls NAV VISIBILITY only. No business code branches on
//    it. Every API route stays functional for every tenant regardless of
//    whether the module appears in the nav.
//  - Manual overrides (`TenantModuleOverride`) take precedence over the
//    industry-map defaults. The admin sets them via PATCH /api/tenant/modules.

export const ALL_MODULES = [
  'pos',
  'inventory',
  'purchases',
  'manufacturing',
  'hr',
  'crm',
  'invoices',
  'journal',
  'reports',
] as const

export type ModuleKey = (typeof ALL_MODULES)[number]

/**
 * Return the list of active module keys for a tenant, applying the industry
 * map + any manual overrides. Delegates to `getEffectiveModules` in
 * `./industry-modules.ts`.
 *
 * Phase 9: real resolution (was a no-op stub in Phase 7).
 */
export async function getActiveModules(
  tenantId: string,
  businessType: string
): Promise<string[]> {
  return resolveEffectiveModules(tenantId, businessType)
}

// ---------- Module overrides (Phase 9 admin API) ----------
//
// `TenantModuleOverride` is a singleton-per-tenant-by-composite-PK table
// (tenantId + moduleKey). Like BrandSettings, it is intentionally NOT in
// `TENANT_SCOPED_DELEGATES` — we access it via `dbRaw` with the caller's
// tenantId. The route handler always derives `tenantId` from the JWT context
// (never from the request body), so tenant A can never write tenant B's
// overrides.

/**
 * Return all manual overrides for a tenant. The settings UI diffs this
 * list against `INDUSTRY_MODULE_MAP[businessType]` to compute checkbox
 * state — entries absent from this list inherit the industry default.
 */
export async function getModuleOverrides(
  tenantId: string
): Promise<TenantModuleOverride[]> {
  return dbRaw.tenantModuleOverride.findMany({
    where: { tenantId },
  })
}

/**
 * Create or update a single module override for the current tenant.
 *
 * Requires `tenant:manage` (admin only) — enforced server-side. The
 * `tenantId` is taken from the active tenant context, so the caller
 * cannot forge it via the request body.
 *
 * Idempotent: setting the same `{moduleKey, enabled}` twice is a no-op
 * (upsert with the same value).
 */
export async function setModuleOverride(
  tenantId: string,
  moduleKey: string,
  enabled: boolean
): Promise<TenantModuleOverride> {
  requirePermission('tenant:manage')

  return dbRaw.tenantModuleOverride.upsert({
    where: {
      tenantId_moduleKey: { tenantId, moduleKey },
    },
    create: { tenantId, moduleKey, enabled },
    update: { enabled },
  })
}

/**
 * Read the tenant's `businessType` from the Tenant row.
 *
 * Used by the GET /api/tenant/modules route so the client can show the
 * current business type alongside the module grid (and by the dashboard
 * to compute effective modules for nav filtering). Returns 'general'
 * if the tenant row is missing or the field is unset — never throws.
 */
export async function getBusinessType(
  tenantId: string
): Promise<string> {
  const tenant = await dbRaw.tenant.findUnique({
    where: { id: tenantId },
    select: { businessType: true },
  })
  return tenant?.businessType ?? 'general'
}

// ---------- Helpers ----------

function toView(row: BrandSettings): BrandSettingsView {
  return {
    tenantId: row.tenantId,
    logoUrl: row.logoUrl,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    invoiceFooterText: row.invoiceFooterText,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Convenience for the API layer: read the active tenant id from context.
 * Throws if no context (defensive — should never happen inside a route
 * handler wrapped by `withTenantContext`, but protects against direct
 * service-layer misuse).
 */
export function currentTenantId(): string {
  const ctx = getTenantContext()
  if (!ctx) {
    throw new Error('branding: no tenant context — call inside withTenantContext')
  }
  return ctx.tenantId
}
