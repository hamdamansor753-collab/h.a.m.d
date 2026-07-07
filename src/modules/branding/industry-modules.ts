/**
 * Phase 9 — Industry Activation (Activity-Based Module Activation).
 *
 * Per /upload/industry-activation.md:
 *  - `businessType` controls WHICH modules appear in the navigation. It does
 *    NOT branch business logic — every API route remains functional for
 *    every tenant regardless of business type or module visibility. This
 *    mirrors Phase 7's "visual-only" rule and is the explicit project
 *    decision (see the spec's "القاعدة الإلزامية: تحكم بصري بس، الـ API
 *    يفضل شغال").
 *  - A tenant admin can manually enable a hidden module via
 *    `/api/tenant/modules` (PATCH). The override is stored in
 *    `TenantModuleOverride(tenantId, moduleKey, enabled)`. Overrides take
 *    precedence over the industry-map defaults.
 *
 * Why a static map (not a DB table): a new business type = add ONE line to
 * `INDUSTRY_MODULE_MAP`. The map is shared between the API resolver and the
 * admin settings UI, so a future type appears consistently in both without
 * a migration. The override table is reserved for PER-TENANT deviations.
 *
 * Tenant isolation note:
 *  - `getEffectiveModules` reads `TenantModuleOverride` via `dbRaw`. The
 *    query is scoped to the caller's `tenantId` (passed in from the route
 *    handler, which itself derives it from the JWT context). A tenant can
 *    never read or write another tenant's overrides.
 */

// ---------- The static map ----------

/**
 * businessType → list of module keys that appear in the navigation by
 * default for that business type.
 *
 * Keys are the same strings used as `Section` values in
 * `src/components/hamd/dashboard.tsx`. The set is intentionally closed —
 * adding a new module requires updating this map AND the dashboard's
 * navItems array (which is the single source of truth for the nav).
 */
export const INDUSTRY_MODULE_MAP: Record<string, string[]> = {
  general: [
    'pos', 'accounts', 'journal', 'invoices', 'inventory', 'purchases',
    'manufacturing', 'hr', 'crm', 'reports', 'tests', 'branding',
  ],
  retail: [
    'pos', 'accounts', 'journal', 'invoices', 'inventory', 'purchases',
    'hr', 'crm', 'reports', 'tests', 'branding',
  ],
  services: [
    'accounts', 'journal', 'invoices', 'hr', 'crm', 'reports', 'tests',
    'branding',
  ],
  clinic: [
    'accounts', 'journal', 'invoices', 'hr', 'crm', 'reports', 'tests',
    'branding',
  ],
  manufacturing: [
    'accounts', 'journal', 'invoices', 'inventory', 'purchases',
    'manufacturing', 'hr', 'crm', 'reports', 'tests', 'branding',
  ],
  restaurant: [
    'pos', 'accounts', 'journal', 'invoices', 'inventory', 'purchases',
    'hr', 'reports', 'tests', 'branding',
  ],
}

/**
 * All module keys that CAN be toggled in the settings UI. The admin
 * panel renders a checkbox for each entry; defaults are pre-checked
 * based on the tenant's business type.
 */
export const ALL_MODULE_KEYS = [
  'pos', 'accounts', 'journal', 'invoices', 'inventory', 'purchases',
  'manufacturing', 'hr', 'crm', 'reports', 'tests', 'branding',
] as const

/**
 * System modules that are ALWAYS visible in the navigation regardless of
 * business type. Per /upload/industry-activation.md File 5:
 *  - 'tests', 'branding', 'reports' are always visible.
 * The dashboard uses this to short-circuit the activeModules filter so
 * an admin can always reach the settings + reports + security screens.
 */
export const SYSTEM_MODULE_KEYS: ReadonlySet<string> = new Set([
  'tests',
  'branding',
  'reports',
])

// ---------- Helpers ----------

/**
 * Default module keys for a business type. Unknown types fall back to
 * 'general' so a typo in `tenant.businessType` never strips the nav.
 */
export function getDefaultModules(businessType: string): string[] {
  return INDUSTRY_MODULE_MAP[businessType] ?? INDUSTRY_MODULE_MAP['general']
}

/**
 * Compute the EFFECTIVE set of visible module keys for a tenant:
 *  - Start from the business-type defaults.
 *  - Apply each TenantModuleOverride: `enabled=true` adds the key,
 *    `enabled=false` removes it.
 *  - Return the resulting set as an array (order is the default-map
 *    order with manual additions appended at the end).
 *
 * Reads `dbRaw.tenantModuleOverride` directly. The `tenantId` parameter
 * MUST come from the authenticated tenant context (the route handler
 * derives it from `withTenantContext`) — isolation is preserved by
 * argument, not by the Prisma Proxy, because TenantModuleOverride is
 * intentionally NOT in the scoped-delegate set (singleton-per-tenant
 * by composite PK, accessed explicitly like BrandSettings).
 */
export async function getEffectiveModules(
  tenantId: string,
  businessType: string
): Promise<string[]> {
  const defaults = new Set(getDefaultModules(businessType))

  const { dbRaw } = await import('@/lib/db')
  const overrides = await dbRaw.tenantModuleOverride.findMany({
    where: { tenantId },
  })

  for (const override of overrides) {
    if (override.enabled) {
      defaults.add(override.moduleKey) // manually enable a hidden module
    } else {
      defaults.delete(override.moduleKey) // manually disable a default module
    }
  }

  return Array.from(defaults)
}
