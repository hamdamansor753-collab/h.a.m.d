/**
 * Shared branding constants — safe to import from BOTH client and server.
 *
 * These are pure string constants (no DB access, no Node.js APIs) so they
 * can be bundled into the client without pulling in async_hooks via the
 * branding.service.ts → db.ts → context.ts import chain.
 */

export const DEFAULT_PRIMARY_COLOR = '#0f172a' // navy (H.A.M.D default)
export const DEFAULT_ACCENT_COLOR = '#06b6d4'  // cyan (H.A.M.D default)
