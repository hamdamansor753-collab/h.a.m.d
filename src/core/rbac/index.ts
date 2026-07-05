/**
 * RBAC service-layer enforcement.
 *
 * Per /upload/03-architecture-decisions.md Decision 4 and
 * /upload/05-security-baseline.md section 3:
 *  - Permission checks happen in the SERVICE LAYER, not just the UI.
 *  - The UI hides buttons, but the API refuses the request if the caller
 *    lacks the required permission.
 *  - No silent super-admin backdoor.
 *
 * Usage:
 *   import { requirePermission } from '@/core/rbac'
 *   await requirePermission('journal:create')
 *   // throws RbacError if the current context lacks the permission.
 */
import { getTenantContext } from '@/core/tenancy/context'

export class RbacError extends Error {
  constructor(
    public code: 'FORBIDDEN' | 'NO_CONTEXT',
    message: string
  ) {
    super(message)
    this.name = 'RbacError'
  }
}

/**
 * Require that the current tenant context has the given permission key.
 * Throws RbacError('NO_CONTEXT') if called outside a request,
 * RbacError('FORBIDDEN') if the user lacks the permission.
 */
export function requirePermission(permissionKey: string): void {
  const ctx = getTenantContext()
  if (!ctx) {
    throw new RbacError('NO_CONTEXT', 'RBAC check outside of a request context')
  }
  if (!ctx.permissionKeys.includes(permissionKey)) {
    throw new RbacError('FORBIDDEN', `Missing permission: ${permissionKey}`)
  }
}

/**
 * Boolean check (no throw) — useful for conditional UI rendering on the
 * server, or for the client-side mirror in `src/core/rbac/client.ts`.
 */
export function hasPermission(permissionKey: string): boolean {
  const ctx = getTenantContext()
  if (!ctx) return false
  return ctx.permissionKeys.includes(permissionKey)
}

/**
 * Convenience: require ANY of the given permissions.
 */
export function requireAnyPermission(permissionKeys: string[]): void {
  const ctx = getTenantContext()
  if (!ctx) {
    throw new RbacError('NO_CONTEXT', 'RBAC check outside of a request context')
  }
  const ok = permissionKeys.some((k) => ctx.permissionKeys.includes(k))
  if (!ok) {
    throw new RbacError('FORBIDDEN', `Missing any of: ${permissionKeys.join(', ')}`)
  }
}
