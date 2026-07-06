/**
 * Branding module — Business Type Seed Extras.
 *
 * Per /upload/product-customization.md: each businessType gets a slightly
 * different starter chart of accounts (extra accounts common for that
 * industry). This function returns the EXTRA accounts only — the base
 * accounts (assets, liabilities, equity, revenue, expense, COGS, etc.)
 * are always created for every tenant.
 *
 * Used ONLY during tenant onboarding (new tenant creation), NOT during
 * normal operation. There is NO `if (businessType === 'restaurant')`
 * anywhere in the business logic — the difference is purely in seed data.
 */
import type { AccountType } from '@prisma/client'

export interface SeedAccount {
  code: string
  nameKey: string
  type: AccountType
  parentCode?: string
}

/**
 * Returns the EXTRA accounts for a given business type.
 * These are ADDED to the base chart of accounts during onboarding.
 */
export function getBusinessTypeSeedExtras(businessType: string): SeedAccount[] {
  switch (businessType) {
    case 'retail':
      return [
        { code: '5003', nameKey: 'account.salesDiscounts', type: 'EXPENSE', parentCode: '5000' },
      ]

    case 'restaurant':
      return [
        { code: '5003', nameKey: 'account.kitchenWaste', type: 'EXPENSE', parentCode: '5000' },
      ]

    case 'clinic':
      return [
        { code: '4001', nameKey: 'account.consultationFees', type: 'REVENUE', parentCode: '4000' },
      ]

    case 'services':
    case 'general':
    default:
      return [] // no extras — the base chart is sufficient
  }
}
