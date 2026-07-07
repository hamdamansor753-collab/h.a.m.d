/**
 * Phase 8 — Platform admin authorization helper.
 *
 * `platform:admin` is NOT a normal RBAC permission — it is a separate,
 * out-of-band grant that lets the H.A.M.D platform owner (you) cross
 * tenant boundaries for billing/subscription management. Per
 * /upload/saas-billing.md §"الصلاحيات الجديدة": this is "منفصلة تمامًا
 * عن RBAC العادي" — completely separate from the per-tenant RBAC system.
 *
 * The list of platform admins is configured via the `PLATFORM_ADMINS` env
 * var (comma-separated emails). Example:
 *
 *   PLATFORM_ADMINS=owner@hamd.test,billing@hamd.test
 *
 * If the env var is unset, NO user has platform:admin access — fail-closed
 * by design. This means the billing panel is invisible and the /api/admin/*
 * routes return 403 for everyone until the env var is configured.
 */
export function isPlatformAdmin(email?: string | null): boolean {
  if (!email) return false
  const list = (process.env.PLATFORM_ADMINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (list.length === 0) return false
  return list.includes(email.toLowerCase())
}
