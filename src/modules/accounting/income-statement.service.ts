/**
 * Accounting module — Income Statement service.
 *
 * Per /upload/accounting.md: "تقرير قائمة دخل مبسّط يُحسب من JournalLine
 * مباشرة (SUM حسب AccountType)، لا جدول منفصل".
 *
 * Computes Revenue - Expenses directly from the ledger (JournalLine joined
 * to Account by type). No separate "report" table — the ledger IS the
 * source of truth.
 *
 * Accounting rules:
 *  - Revenue accounts: balance = sum(credit - debit)  (revenue increases with credit)
 *  - Expense accounts: balance = sum(debit - credit)  (expense increases with debit)
 *  - Net income = total revenue - total expenses
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import type { AccountType } from '@prisma/client'

export interface IncomeStatementAccount {
  id: string
  code: string
  nameKey: string
  balance: number
}

export interface IncomeStatement {
  revenue: {
    total: number
    accounts: IncomeStatementAccount[]
  }
  expenses: {
    total: number
    accounts: IncomeStatementAccount[]
  }
  netIncome: number
}

/**
 * Generate the income statement for the current tenant.
 *
 * Fetches all JournalEntries (tenant-scoped by the middleware) with their
 * lines and accounts, then sums by account type. Accounts with zero
 * balance are excluded for a clean report.
 *
 * Permission: journal:read (reading ledger data).
 */
export async function getIncomeStatement(): Promise<IncomeStatement> {
  requirePermission('journal:read')

  // Fetch all journal entries for this tenant with lines + accounts.
  // journalEntry is tenant-scoped → only this tenant's entries are returned.
  // journalLine is NOT tenant-scoped, but it's included via the scoped
  // journalEntry, so only this tenant's lines are included.
  const entries = await db.journalEntry.findMany({
    include: {
      lines: {
        include: {
          account: true,
        },
      },
    },
  })

  // Aggregate by account
  const accountBalances = new Map<
    string,
    { id: string; code: string; nameKey: string; type: AccountType; debit: number; credit: number }
  >()

  for (const entry of entries) {
    for (const line of entry.lines) {
      const acc = line.account
      const key = acc.id
      let agg = accountBalances.get(key)
      if (!agg) {
        agg = {
          id: acc.id,
          code: acc.code,
          nameKey: acc.nameKey,
          type: acc.type,
          debit: 0,
          credit: 0,
        }
        accountBalances.set(key, agg)
      }
      agg.debit += Number(line.debit)
      agg.credit += Number(line.credit)
    }
  }

  // Build revenue + expense sections
  const revenueAccounts: IncomeStatementAccount[] = []
  const expenseAccounts: IncomeStatementAccount[] = []
  let totalRevenue = 0
  let totalExpenses = 0

  for (const acc of accountBalances.values()) {
    if (acc.type === 'REVENUE') {
      // Revenue: credit - debit (normal credit balance)
      const balance = round2(acc.credit - acc.debit)
      if (balance !== 0) {
        revenueAccounts.push({ id: acc.id, code: acc.code, nameKey: acc.nameKey, balance })
        totalRevenue += balance
      }
    } else if (acc.type === 'EXPENSE') {
      // Expense: debit - credit (normal debit balance)
      const balance = round2(acc.debit - acc.credit)
      if (balance !== 0) {
        expenseAccounts.push({ id: acc.id, code: acc.code, nameKey: acc.nameKey, balance })
        totalExpenses += balance
      }
    }
    // ASSET, LIABILITY, EQUITY are not part of the income statement
  }

  // Sort by code for stable display
  revenueAccounts.sort((a, b) => a.code.localeCompare(b.code))
  expenseAccounts.sort((a, b) => a.code.localeCompare(b.code))

  return {
    revenue: { total: round2(totalRevenue), accounts: revenueAccounts },
    expenses: { total: round2(totalExpenses), accounts: expenseAccounts },
    netIncome: round2(totalRevenue - totalExpenses),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
