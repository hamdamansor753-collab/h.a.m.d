/**
 * Ledger — Account service (Chart of Accounts).
 *
 * Tree-structured accounts. Every function runs INSIDE a tenant context
 * (enforced by the Prisma middleware), so we never read or write a row
 * from another tenant.
 *
 * Per /upload/03-architecture-decisions.md Decision 3: services are the
 * ONLY entry point to the database. API routes must not call Prisma
 * directly.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import type { Account, AccountType } from '@prisma/client'

export interface AccountNode extends Account {
  children: AccountNode[]
}

/**
 * List all accounts for the current tenant, ordered by code.
 * Permission: account:read.
 */
export async function listAccounts(): Promise<Account[]> {
  requirePermission('account:read')
  return db.account.findMany({ orderBy: { code: 'asc' } })
}

/**
 * Build a tree from the flat account list (rooted at parentId=null).
 */
export function buildAccountTree(accounts: Account[]): AccountNode[] {
  const byId = new Map<string, AccountNode>()
  for (const a of accounts) {
    byId.set(a.id, { ...a, children: [] })
  }
  const roots: AccountNode[] = []
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/**
 * Create a new account in the current tenant.
 * Permission: account:create.
 *
 * The `tenantId` is injected by the Prisma middleware — the caller does
 * not pass it and cannot override it.
 */
export async function createAccount(input: {
  code: string
  nameKey: string
  type: AccountType
  parentId?: string | null
}): Promise<Account> {
  requirePermission('account:create')
  return db.account.create({
    data: {
      code: input.code,
      nameKey: input.nameKey,
      type: input.type,
      parentId: input.parentId ?? null,
    },
  })
}

/**
 * Find an account by ID within the current tenant. Returns null if not
 * found or if the ID belongs to a different tenant (the middleware will
 * filter it out automatically).
 */
export async function getAccount(id: string): Promise<Account | null> {
  requirePermission('account:read')
  return db.account.findUnique({ where: { id } })
}
