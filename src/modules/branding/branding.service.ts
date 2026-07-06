/**
 * Branding module — Brand settings service.
 *
 * Per /upload/product-customization.md:
 *  - getBranding: returns BrandSettings for the current tenant (or null)
 *  - updateBranding: creates/updates BrandSettings
 *  - Tenant without BrandSettings works fine with H.A.M.D defaults
 *
 * Permission: tenant:manage (admin only).
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import type { BrandSettings } from '@prisma/client'

export interface BrandSettingsResult {
  tenantId: string
  logoUrl: string | null
  primaryColor: string
  accentColor: string
  invoiceFooterText: string | null
  updatedAt: Date
  // Echo the tenant's businessType for the UI
  businessType: string
}

/**
 * Get brand settings for the current tenant.
 * Permission: tenant:manage.
 * Returns null if no BrandSettings exist (tenant uses H.A.M.D defaults).
 */
export async function getBranding(): Promise<BrandSettingsResult | null> {
  requirePermission('tenant:manage')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  const settings = await db.brandSettings.findUnique({
    where: { tenantId: ctx.tenantId },
  })

  // Also get the tenant's businessType
  const tenant = await db.tenant.findFirst({
    where: { id: ctx.tenantId },
    select: { businessType: true },
  })

  if (!settings) {
    // Return defaults with businessType
    return {
      tenantId: ctx.tenantId,
      logoUrl: null,
      primaryColor: '#0f172a', // navy — H.A.M.D default
      accentColor: '#06b6d4',  // cyan — H.A.M.D default
      invoiceFooterText: null,
      updatedAt: new Date(),
      businessType: tenant?.businessType ?? 'general',
    }
  }

  return {
    ...settings,
    businessType: tenant?.businessType ?? 'general',
  }
}

/**
 * Create or update brand settings for the current tenant.
 * Permission: tenant:manage.
 */
export async function updateBranding(input: {
  logoUrl?: string | null
  primaryColor?: string
  accentColor?: string
  invoiceFooterText?: string | null
}): Promise<BrandSettings> {
  requirePermission('tenant:manage')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  // Build the update data (only include fields that were provided)
  const data: Record<string, unknown> = {}
  if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl
  if (input.primaryColor !== undefined) data.primaryColor = input.primaryColor
  if (input.accentColor !== undefined) data.accentColor = input.accentColor
  if (input.invoiceFooterText !== undefined) data.invoiceFooterText = input.invoiceFooterText

  // Upsert: create if not exists, update if exists
  return db.brandSettings.upsert({
    where: { tenantId: ctx.tenantId },
    create: {
      tenantId: ctx.tenantId,
      ...data,
    },
    update: data,
  })
}
