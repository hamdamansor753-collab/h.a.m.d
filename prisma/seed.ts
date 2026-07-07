/**
 * H.A.M.D ERP — Seed (Phase 0 + Phase 1/2/3/4)
 *
 * Creates:
 *  - 4 roles: admin, accountant, cashier, viewer (with permissions)
 *  - 2 tenants (Tenant A "شركة الأفق", Tenant B "شركة النور") so we can
 *    DEMONSTRATE cross-tenant isolation in the test endpoint.
 *  - For each tenant: admin / accountant / cashier / viewer users (password = "password123")
 *  - A starter chart of accounts per tenant (different codes per tenant to
 *    make the isolation test visually obvious). Includes Manufacturing &
 *    HR/Payroll accounts (Phase 4).
 *  - Sample data: warehouses, products (incl. MFG products), employees,
 *    customers, appointments, and a sample BOM (Phase 4).
 *  - UI translations for ar-EG, ar-SA, en (incl. Manufacturing, HR, CRM).
 *
 * Run with: `bun run db:seed`
 */
import { PrismaClient, AccountType } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('→ Seeding H.A.M.D ERP core data...')
  // Disable RLS for the seed connection — the seed runs as a super-admin
  // (postgres role) and needs cross-tenant access to all tables.
  // 14 tables have RLS enabled (Account, User, JournalEntry, etc.) and
  // without this, upserts silently fail or hang on the pgbouncer pool.
  await prisma.$executeRawUnsafe('SET row_security = off')
  console.log('[step] RLS disabled for seed session')
  console.log('[step] permissions...')

  // ---------- 1. Permissions ----------
  const permissionKeys = [
    'account:read',
    'account:create',
    'account:update',
    'journal:read',
    'journal:create',
    'journal:void',
    'user:read',
    'tenant:manage',
    // Phase 1: invoice + system:test
    'invoice:create',
    'invoice:read',
    'invoice:post',
    'invoice:void',
    'system:test',
    // Phase 2: inventory + purchase
    'inventory:read',
    'inventory:adjust',
    'purchase:create',
    'purchase:receive',
    // Phase 3: POS
    'pos:sell',
    // Phase 4: Manufacturing
    'manufacturing:read',
    'manufacturing:manage',
    'production:run',
    // Phase 4: HR / Payroll
    'hr:read',
    'hr:manage',
    'hr:run',
    // Phase 4: CRM
    'crm:read',
    'crm:manage',
  ]
  const permissions = await Promise.all(
    permissionKeys.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key },
      })
    )
  )
  const permByKey = Object.fromEntries(permissions.map((p) => [p.key, p]))

  console.log('[step] roles...')
  // ---------- 2. Roles ----------
  const roleDefs = [
    {
      name: 'admin',
      perms: [
        'account:read', 'account:create', 'account:update',
        'journal:read', 'journal:create', 'journal:void',
        'user:read', 'tenant:manage',
        'invoice:create', 'invoice:read', 'invoice:post', 'invoice:void',
        'system:test',
        'inventory:read', 'inventory:adjust',
        'purchase:create', 'purchase:receive',
        'pos:sell',
        // Phase 4: Manufacturing, HR/Payroll, CRM (full access)
        'manufacturing:read', 'manufacturing:manage', 'production:run',
        'hr:read', 'hr:manage', 'hr:run',
        'crm:read', 'crm:manage',
      ],
    },
    {
      name: 'accountant',
      perms: [
        'account:read', 'account:create', 'account:update',
        'journal:read', 'journal:create',
        'invoice:create', 'invoice:read', 'invoice:post',
        'inventory:read',
        'purchase:create', 'purchase:receive',
        // Phase 4: read-only access to new modules
        'manufacturing:read', 'hr:read', 'crm:read',
      ],
    },
    {
      name: 'cashier',
      perms: ['pos:sell', 'invoice:read', 'inventory:read'],
    },
    {
      name: 'viewer',
      perms: [
        'account:read', 'journal:read', 'invoice:read', 'inventory:read',
        // Phase 4: read-only access to new modules
        'manufacturing:read', 'hr:read', 'crm:read',
      ],
    },
  ]
  const roles: Record<string, { id: string }> = {}
  for (const def of roleDefs) {
    // Upsert the role, then sync permissions (connect new + disconnect stale).
    // The `update: {}` pattern from Phase 0 did NOT reconnect permissions on
    // existing roles — so adding invoice:* perms in Phase 1 would be silently
    // ignored on re-seed. We now explicitly sync the permission set.
    const role = await prisma.role.upsert({
      where: { name: def.name },
      update: {},
      create: {
        name: def.name,
        permissions: { connect: def.perms.map((k) => ({ id: permByKey[k].id })) },
      },
      include: { permissions: true },
    })
    // Sync permissions: connect any that are missing.
    const existingPermIds = new Set(role.permissions.map((p) => p.id))
    const toConnect = def.perms.filter((k) => !existingPermIds.has(permByKey[k].id))
    if (toConnect.length > 0) {
      await prisma.role.update({
        where: { id: role.id },
        data: {
          permissions: { connect: toConnect.map((k) => ({ id: permByKey[k].id })) },
        },
      })
    }
    roles[def.name] = role
  }

  console.log('[step] tenants...')
  // ---------- 3. Tenants ----------
  const tenants = await Promise.all([
    prisma.tenant.upsert({
      where: { id: 'tenant-afak' },
      update: {},
      create: { id: 'tenant-afak', name: 'شركة الأفق للتجارة', defaultLocale: 'ar-EG', country: 'EG' },
    }),
    prisma.tenant.upsert({
      where: { id: 'tenant-noor' },
      update: {},
      create: { id: 'tenant-noor', name: 'شركة النور للتجارة', defaultLocale: 'ar-SA', country: 'SA' },
    }),
  ])

  console.log('[step] users...')
  // ---------- 4. Users ----------
  const passwordHash = await bcrypt.hash('password123', 10)
  const userDefs = [
    { email: 'admin@afak.test',     name: 'مدير الأفق',   tenantId: 'tenant-afak', role: 'admin' },
    { email: 'accountant@afak.test',name: 'محاسب الأفق',  tenantId: 'tenant-afak', role: 'accountant' },
    { email: 'cashier@afak.test',   name: 'كاشير الأفق',  tenantId: 'tenant-afak', role: 'cashier' },
    { email: 'viewer@afak.test',    name: 'مشاهد الأفق',  tenantId: 'tenant-afak', role: 'viewer' },
    { email: 'admin@noor.test',     name: 'مدير النور',   tenantId: 'tenant-noor', role: 'admin' },
    { email: 'accountant@noor.test',name: 'محاسب النور',  tenantId: 'tenant-noor', role: 'accountant' },
    // Phase 8 — platform owner. Lives in tenant-afak (every user needs a
    // tenantId), but gets cross-tenant super-admin access via the
    // PLATFORM_ADMINS env var. Set PLATFORM_ADMINS=owner@hamd.test in .env
    // to enable the billing panel for this user.
    { email: 'owner@hamd.test',     name: 'مالك المنصة',  tenantId: 'tenant-afak', role: 'admin' },
  ]
  for (const u of userDefs) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: u.tenantId, email: u.email } },
      update: { passwordHash },
      create: {
        tenantId: u.tenantId,
        email: u.email,
        name: u.name,
        passwordHash,
        locale: tenants.find((t) => t.id === u.tenantId)!.defaultLocale,
        roles: { create: { roleId: roles[u.role].id } },
      },
    })
    // Ensure role link exists even on update
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: roles[u.role].id } },
      update: {},
      create: { userId: user.id, roleId: roles[u.role].id },
    })
  }

  console.log('[step] plans+subscriptions...')
  // ---------- 4b. Plans + Subscriptions (Phase 8) ----------
  // Platform-level billing: 3 tiers + an ACTIVE subscription for every
  // existing tenant (per phase8-prompt: "كل tenant موجود يُنشأ له
  // Subscription بحالة ACTIVE"). The platform owner records manual
  // payments via the super-admin billing panel to extend currentPeriodEnd.
  const planDefs = [
    { key: 'starter',    nameKey: 'plan.starter',    monthlyPrice: 299,  maxUsers: 5,  maxInvoicesPerMonth: 200 },
    { key: 'pro',        nameKey: 'plan.pro',        monthlyPrice: 799,  maxUsers: 25, maxInvoicesPerMonth: 2000 },
    { key: 'enterprise', nameKey: 'plan.enterprise', monthlyPrice: 1999, maxUsers: 100, maxInvoicesPerMonth: null },
  ]
  const plans: Record<string, { id: string }> = {}
  for (const p of planDefs) {
    const plan = await prisma.plan.upsert({
      where: { key: p.key },
      update: { nameKey: p.nameKey, monthlyPrice: p.monthlyPrice, maxUsers: p.maxUsers, maxInvoicesPerMonth: p.maxInvoicesPerMonth },
      create: p,
    })
    plans[p.key] = plan
  }
  // Give each existing tenant an ACTIVE subscription on the starter plan.
  // currentPeriodEnd is set 30 days from now; the super-admin can record a
  // payment to extend it by another month.
  const periodEnd = new Date()
  periodEnd.setDate(periodEnd.getDate() + 30)
  for (const tenant of tenants) {
    await prisma.subscription.upsert({
      where: { tenantId: tenant.id },
      update: {},
      create: {
        tenantId: tenant.id,
        planId: plans['starter'].id,
        status: 'ACTIVE',
        currentPeriodEnd: periodEnd,
      },
    })
  }

  console.log('[step] chart of accounts...')
  // ---------- 5. Chart of Accounts ----------
  // Different codes per tenant to make isolation visually obvious in the test.
  const afakAccounts = [
    { code: '1000', nameKey: 'account.assets',    type: AccountType.ASSET,     parentId: null },
    { code: '1001', nameKey: 'account.cash',      type: AccountType.ASSET,     parentCode: '1000' },
    { code: '1002', nameKey: 'account.bank',      type: AccountType.ASSET,     parentCode: '1000' },
    { code: '1003', nameKey: 'account.receivable', type: AccountType.ASSET,    parentCode: '1000' },
    { code: '1004', nameKey: 'account.inventory', type: AccountType.ASSET,     parentCode: '1000' },
    // Phase 4: Manufacturing asset accounts (under assets parent)
    { code: '1402', nameKey: 'account.rawMaterials', type: AccountType.ASSET,   parentCode: '1000' },
    { code: '1403', nameKey: 'account.finishedGoods', type: AccountType.ASSET,  parentCode: '1000' },
    { code: '2000', nameKey: 'account.liabilities',type: AccountType.LIABILITY, parentId: null },
    { code: '2001', nameKey: 'account.salesTax',  type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '2002', nameKey: 'account.payable',   type: AccountType.LIABILITY, parentCode: '2000' },
    // Phase 4: HR/Payroll liability accounts (under liabilities parent)
    { code: '2003', nameKey: 'account.payrollPayable',     type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '2004', nameKey: 'account.employeeInsurance',  type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '2005', nameKey: 'account.employerInsurance',  type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '2006', nameKey: 'account.incomeTaxPayable',   type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '3000', nameKey: 'account.equity',    type: AccountType.EQUITY,    parentId: null },
    { code: '4000', nameKey: 'account.revenue',   type: AccountType.REVENUE,   parentId: null },
    { code: '5000', nameKey: 'account.expense',   type: AccountType.EXPENSE,   parentId: null },
    { code: '5001', nameKey: 'account.cogs',      type: AccountType.EXPENSE,   parentCode: '5000' },
    // Phase 4: Manufacturing & HR expense accounts (under expenses parent)
    { code: '5003', nameKey: 'account.directLabor',     type: AccountType.EXPENSE, parentCode: '5000' },
    { code: '5004', nameKey: 'account.salariesExpense', type: AccountType.EXPENSE, parentCode: '5000' },
  ]
  const noorAccounts = [
    { code: '1100', nameKey: 'account.assets',    type: AccountType.ASSET,     parentId: null },
    { code: '1101', nameKey: 'account.cash',      type: AccountType.ASSET,     parentCode: '1100' },
    { code: '1102', nameKey: 'account.receivable', type: AccountType.ASSET,    parentCode: '1100' },
    { code: '1103', nameKey: 'account.inventory', type: AccountType.ASSET,     parentCode: '1100' },
    // Phase 4: Manufacturing asset accounts (under assets parent)
    { code: '1502', nameKey: 'account.rawMaterials', type: AccountType.ASSET,   parentCode: '1100' },
    { code: '1503', nameKey: 'account.finishedGoods', type: AccountType.ASSET,  parentCode: '1100' },
    { code: '2100', nameKey: 'account.liabilities',type: AccountType.LIABILITY, parentId: null },
    { code: '2101', nameKey: 'account.salesTax',  type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '2102', nameKey: 'account.payable',   type: AccountType.LIABILITY, parentCode: '2100' },
    // Phase 4: HR/Payroll liability accounts (under liabilities parent)
    { code: '2103', nameKey: 'account.payrollPayable',     type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '2104', nameKey: 'account.employeeInsurance',  type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '2105', nameKey: 'account.employerInsurance',  type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '2106', nameKey: 'account.incomeTaxPayable',   type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '3100', nameKey: 'account.equity',    type: AccountType.EQUITY,    parentId: null },
    { code: '4100', nameKey: 'account.revenue',   type: AccountType.REVENUE,   parentId: null },
    { code: '5100', nameKey: 'account.expense',   type: AccountType.EXPENSE,   parentId: null },
    { code: '5101', nameKey: 'account.cogs',      type: AccountType.EXPENSE,   parentCode: '5100' },
    // Phase 4: Manufacturing & HR expense accounts (under expenses parent)
    { code: '5103', nameKey: 'account.directLabor',     type: AccountType.EXPENSE, parentCode: '5100' },
    { code: '5104', nameKey: 'account.salariesExpense', type: AccountType.EXPENSE, parentCode: '5100' },
  ]

  async function seedChart(tenantId: string, accounts: Array<{ code: string; nameKey: string; type: AccountType; parentId?: string | null; parentCode?: string }>) {
    const codeToId: Record<string, string> = {}
    // First pass: parents
    for (const a of accounts.filter((x) => !x.parentCode)) {
      const acc = await prisma.account.upsert({
        where: { tenantId_code: { tenantId, code: a.code } },
        update: { nameKey: a.nameKey, type: a.type },
        create: { tenantId, code: a.code, nameKey: a.nameKey, type: a.type, parentId: null },
      })
      codeToId[a.code] = acc.id
    }
    // Second pass: children
    for (const a of accounts.filter((x) => x.parentCode)) {
      const acc = await prisma.account.upsert({
        where: { tenantId_code: { tenantId, code: a.code } },
        update: { nameKey: a.nameKey, type: a.type, parentId: codeToId[a.parentCode!] },
        create: { tenantId, code: a.code, nameKey: a.nameKey, type: a.type, parentId: codeToId[a.parentCode!] },
      })
      codeToId[a.code] = acc.id
    }
  }
  await seedChart('tenant-afak', afakAccounts)
  await seedChart('tenant-noor', noorAccounts)

  console.log('[step] warehouses+products...')
  // ---------- 5b. Warehouses + Products (Phase 2) ----------
  for (const tenantId of ['tenant-afak', 'tenant-noor']) {
    await prisma.warehouse.upsert({
      where: { id: `${tenantId}-wh-main` },
      update: {},
      create: { id: `${tenantId}-wh-main`, tenantId, nameKey: 'warehouse.main', isDefault: true },
    })
  }

  // Sample products per tenant (different SKUs to make isolation visible)
  const afakProducts = [
    { sku: 'PROD-001', nameKey: 'product.laptop',     sellPrice: 15000 },
    { sku: 'PROD-002', nameKey: 'product.mouse',      sellPrice: 250 },
    { sku: 'PROD-003', nameKey: 'product.keyboard',   sellPrice: 450 },
  ]
  const noorProducts = [
    { sku: 'ITEM-101', nameKey: 'product.laptop',     sellPrice: 16000 },
    { sku: 'ITEM-102', nameKey: 'product.mouse',      sellPrice: 300 },
  ]
  for (const p of afakProducts) {
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: 'tenant-afak', sku: p.sku } },
      update: { nameKey: p.nameKey, sellPrice: p.sellPrice },
      create: { tenantId: 'tenant-afak', sku: p.sku, nameKey: p.nameKey, sellPrice: p.sellPrice, costPrice: 0 },
    })
  }
  for (const p of noorProducts) {
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: 'tenant-noor', sku: p.sku } },
      update: { nameKey: p.nameKey, sellPrice: p.sellPrice },
      create: { tenantId: 'tenant-noor', sku: p.sku, nameKey: p.nameKey, sellPrice: p.sellPrice, costPrice: 0 },
    })
  }

  console.log('[step] mfg products...')
  // ---------- 5c. Manufacturing products (Phase 4) ----------
  // These products back the sample BOM (MFG-CHAIR = 2kg MFG-FABRIC + 4 MFG-LEG).
  // Created on tenant-afak so the BOM below has valid references.
  const afakMfgProducts = [
    { sku: 'MFG-CHAIR',  nameKey: 'product.mfgChair',  sellPrice: 850,  costPrice: 320 },
    { sku: 'MFG-FABRIC', nameKey: 'product.mfgFabric', sellPrice: 60,   costPrice: 35 },
    { sku: 'MFG-LEG',    nameKey: 'product.mfgLeg',    sellPrice: 25,   costPrice: 12 },
  ]
  for (const p of afakMfgProducts) {
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: 'tenant-afak', sku: p.sku } },
      update: { nameKey: p.nameKey, sellPrice: p.sellPrice, costPrice: p.costPrice },
      create: { tenantId: 'tenant-afak', sku: p.sku, nameKey: p.nameKey, sellPrice: p.sellPrice, costPrice: p.costPrice },
    })
  }

  console.log('[step] employees...')
  // ---------- 5d. HR / Payroll sample employees (Phase 4) ----------
  // Employee has no unique constraint on nationalId; use stable surrogate IDs
  // so the seed is idempotent across runs.
  const afakEmployees = [
    { id: 'tenant-afak-emp-1', fullName: 'أحمد محمد علي',         nationalId: '29001011234567', hireDate: new Date('2023-01-15'), baseSalary: 15000 },
    { id: 'tenant-afak-emp-2', fullName: 'فاطمة حسن إبراهيم',     nationalId: '29001027654321', hireDate: new Date('2023-06-01'), baseSalary: 12000 },
    { id: 'tenant-afak-emp-3', fullName: 'خالد سعيد عبدالله',     nationalId: '29001039876543', hireDate: new Date('2022-03-10'), baseSalary: 18000 },
  ]
  for (const e of afakEmployees) {
    await prisma.employee.upsert({
      where: { id: e.id },
      update: { fullName: e.fullName, nationalId: e.nationalId, hireDate: e.hireDate, baseSalary: e.baseSalary },
      create: { id: e.id, tenantId: 'tenant-afak', fullName: e.fullName, nationalId: e.nationalId, hireDate: e.hireDate, baseSalary: e.baseSalary },
    })
  }

  console.log('[step] customers...')
  // ---------- 5e. CRM sample customers (Phase 4) ----------
  // Customer has no natural unique key other than id; use stable surrogate IDs.
  const afakCustomers = [
    { id: 'tenant-afak-cust-1', name: 'شركة النور للتجارة', phone: '01001234567', email: 'info@alnoor.com' },
    { id: 'tenant-afak-cust-2', name: 'مؤسسة الفجر',         phone: '01112345678', email: 'fajr@org.com' },
    { id: 'tenant-afak-cust-3', name: 'محمد عبدالرحمن',      phone: '01223456789', email: null },
  ]
  for (const c of afakCustomers) {
    await prisma.customer.upsert({
      where: { id: c.id },
      update: { name: c.name, phone: c.phone, email: c.email },
      create: { id: c.id, tenantId: 'tenant-afak', name: c.name, phone: c.phone, email: c.email },
    })
  }

  console.log('[step] appointments...')
  // ---------- 5f. CRM sample appointments (Phase 4) ----------
  // Two upcoming appointments linked to the first two customers.
  const afakAppointments = [
    { id: 'tenant-afak-appt-1', customerId: 'tenant-afak-cust-1', scheduledAt: new Date(Date.now() + 86400000),  note: 'اجتماع متابعة طلبية' },
    { id: 'tenant-afak-appt-2', customerId: 'tenant-afak-cust-2', scheduledAt: new Date(Date.now() + 172800000), note: 'عرض منتجات جديدة' },
  ]
  for (const a of afakAppointments) {
    await prisma.appointment.upsert({
      where: { id: a.id },
      update: { customerId: a.customerId, scheduledAt: a.scheduledAt, note: a.note },
      create: { id: a.id, tenantId: 'tenant-afak', customerId: a.customerId, scheduledAt: a.scheduledAt, note: a.note },
    })
  }

  console.log('[step] BOM...')
  // ---------- 5g. Manufacturing sample BOM (Phase 4) ----------
  // BOM for MFG-CHAIR: 1 unit needs 2 (kg) of MFG-FABRIC + 4 of MFG-LEG,
  // plus 50 labor cost per unit. BOMComponent has no unique constraint on
  // (bomId, rawMaterialProductId), so we check-then-create to stay idempotent.
  const mfgChairProduct = await prisma.product.findUnique({
    where: { tenantId_sku: { tenantId: 'tenant-afak', sku: 'MFG-CHAIR' } },
  })
  const mfgFabricProduct = await prisma.product.findUnique({
    where: { tenantId_sku: { tenantId: 'tenant-afak', sku: 'MFG-FABRIC' } },
  })
  const mfgLegProduct = await prisma.product.findUnique({
    where: { tenantId_sku: { tenantId: 'tenant-afak', sku: 'MFG-LEG' } },
  })
  if (mfgChairProduct && mfgFabricProduct && mfgLegProduct) {
    const bom = await prisma.billOfMaterials.upsert({
      where: { tenantId_finishedProductId: { tenantId: 'tenant-afak', finishedProductId: mfgChairProduct.id } },
      update: { laborCostPerUnit: 50 },
      create: {
        tenantId: 'tenant-afak',
        finishedProductId: mfgChairProduct.id,
        laborCostPerUnit: 50,
      },
    })
    // Sync components: ensure both rows exist (create if missing). Re-running the
    // seed must NOT duplicate components or change existing quantities.
    const bomComponents = [
      { rawMaterialProductId: mfgFabricProduct.id, quantityPerUnit: 2 },
      { rawMaterialProductId: mfgLegProduct.id,    quantityPerUnit: 4 },
    ]
    for (const comp of bomComponents) {
      const existing = await prisma.bOMComponent.findFirst({
        where: { bomId: bom.id, rawMaterialProductId: comp.rawMaterialProductId },
      })
      if (!existing) {
        await prisma.bOMComponent.create({
          data: { bomId: bom.id, rawMaterialProductId: comp.rawMaterialProductId, quantityPerUnit: comp.quantityPerUnit },
        })
      } else {
        await prisma.bOMComponent.update({
          where: { id: existing.id },
          data: { quantityPerUnit: comp.quantityPerUnit },
        })
      }
    }
  }

  console.log('[step] translations...')
  // ---------- 6. Translations ----------
  const translations: Array<{ key: string; locale: string; value: string }> = [
    // Brand / app
    { key: 'app.name',           locale: 'ar-EG', value: 'H.A.M.D ERP' },
    { key: 'app.name',           locale: 'ar-SA', value: 'H.A.M.D ERP' },
    { key: 'app.name',           locale: 'en',    value: 'H.A.M.D ERP' },
    { key: 'app.tagline',        locale: 'ar-EG', value: 'نظام تخطيط موارد المؤسسات' },
    { key: 'app.tagline',        locale: 'ar-SA', value: 'نظام تخطيط موارد المنشأة' },
    { key: 'app.tagline',        locale: 'en',    value: 'Enterprise Resource Planning' },

    // Auth
    { key: 'auth.login',         locale: 'ar-EG', value: 'تسجيل الدخول' },
    { key: 'auth.login',         locale: 'ar-SA', value: 'تسجيل الدخول' },
    { key: 'auth.login',         locale: 'en',    value: 'Sign in' },
    { key: 'auth.logout',        locale: 'ar-EG', value: 'تسجيل الخروج' },
    { key: 'auth.logout',        locale: 'ar-SA', value: 'تسجيل الخروج' },
    { key: 'auth.logout',        locale: 'en',    value: 'Sign out' },
    { key: 'auth.email',         locale: 'ar-EG', value: 'البريد الإلكتروني' },
    { key: 'auth.email',         locale: 'ar-SA', value: 'البريد الإلكتروني' },
    { key: 'auth.email',         locale: 'en',    value: 'Email' },
    { key: 'auth.password',      locale: 'ar-EG', value: 'كلمة المرور' },
    { key: 'auth.password',      locale: 'ar-SA', value: 'كلمة المرور' },
    { key: 'auth.password',      locale: 'en',    value: 'Password' },
    { key: 'auth.signInBtn',     locale: 'ar-EG', value: 'دخول' },
    { key: 'auth.signInBtn',     locale: 'ar-SA', value: 'دخول' },
    { key: 'auth.signInBtn',     locale: 'en',    value: 'Sign in' },
    { key: 'auth.invalidCreds',  locale: 'ar-EG', value: 'بيانات الدخول غير صحيحة' },
    { key: 'auth.invalidCreds',  locale: 'ar-SA', value: 'بيانات الدخول غير صحيحة' },
    { key: 'auth.invalidCreds',  locale: 'en',    value: 'Invalid credentials' },
    { key: 'auth.demoAccounts',  locale: 'ar-EG', value: 'حسابات تجريبية' },
    { key: 'auth.demoAccounts',  locale: 'ar-SA', value: 'حسابات تجريبية' },
    { key: 'auth.demoAccounts',  locale: 'en',    value: 'Demo accounts' },

    // Nav
    { key: 'nav.accounts',       locale: 'ar-EG', value: 'شجرة الحسابات' },
    { key: 'nav.accounts',       locale: 'ar-SA', value: 'شجرة الحسابات' },
    { key: 'nav.accounts',       locale: 'en',    value: 'Chart of Accounts' },
    { key: 'nav.journal',        locale: 'ar-EG', value: 'القيود اليومية' },
    { key: 'nav.journal',        locale: 'ar-SA', value: 'القيود اليومية' },
    { key: 'nav.journal',        locale: 'en',    value: 'Journal Entries' },
    { key: 'nav.tests',          locale: 'ar-EG', value: 'اختبارات الأمان' },
    { key: 'nav.tests',          locale: 'ar-SA', value: 'اختبارات الأمان' },
    { key: 'nav.tests',          locale: 'en',    value: 'Security Tests' },

    // Accounts
    { key: 'account.assets',     locale: 'ar-EG', value: 'الأصول' },
    { key: 'account.assets',     locale: 'ar-SA', value: 'الأصول' },
    { key: 'account.assets',     locale: 'en',    value: 'Assets' },
    { key: 'account.cash',       locale: 'ar-EG', value: 'النقدية' },
    { key: 'account.cash',       locale: 'ar-SA', value: 'النقدية' },
    { key: 'account.cash',       locale: 'en',    value: 'Cash' },
    { key: 'account.bank',       locale: 'ar-EG', value: 'البنك' },
    { key: 'account.bank',       locale: 'ar-SA', value: 'البنك' },
    { key: 'account.bank',       locale: 'en',    value: 'Bank' },
    { key: 'account.liabilities',locale: 'ar-EG', value: 'الخصوم' },
    { key: 'account.liabilities',locale: 'ar-SA', value: 'الالتزامات' },
    { key: 'account.liabilities',locale: 'en',    value: 'Liabilities' },
    { key: 'account.equity',     locale: 'ar-EG', value: 'حقوق الملكية' },
    { key: 'account.equity',     locale: 'ar-SA', value: 'حقوق الملكية' },
    { key: 'account.equity',     locale: 'en',    value: 'Equity' },
    { key: 'account.revenue',    locale: 'ar-EG', value: 'الإيرادات' },
    { key: 'account.revenue',    locale: 'ar-SA', value: 'الإيرادات' },
    { key: 'account.revenue',    locale: 'en',    value: 'Revenue' },
    { key: 'account.expense',    locale: 'ar-EG', value: 'المصروفات' },
    { key: 'account.expense',    locale: 'ar-SA', value: 'المصروفات' },
    { key: 'account.expense',    locale: 'en',    value: 'Expenses' },
    { key: 'account.code',       locale: 'ar-EG', value: 'الرمز' },
    { key: 'account.code',       locale: 'ar-SA', value: 'الرمز' },
    { key: 'account.code',       locale: 'en',    value: 'Code' },
    { key: 'account.name',       locale: 'ar-EG', value: 'الاسم' },
    { key: 'account.name',       locale: 'ar-SA', value: 'الاسم' },
    { key: 'account.name',       locale: 'en',    value: 'Name' },
    { key: 'account.type',       locale: 'ar-EG', value: 'النوع' },
    { key: 'account.type',       locale: 'ar-SA', value: 'النوع' },
    { key: 'account.type',       locale: 'en',    value: 'Type' },
    { key: 'account.create',     locale: 'ar-EG', value: 'إضافة حساب' },
    { key: 'account.create',     locale: 'ar-SA', value: 'إضافة حساب' },
    { key: 'account.create',     locale: 'en',    value: 'New Account' },
    { key: 'account.empty',      locale: 'ar-EG', value: 'لا توجد حسابات' },
    { key: 'account.empty',      locale: 'ar-SA', value: 'لا توجد حسابات' },
    { key: 'account.empty',      locale: 'en',    value: 'No accounts' },

    // Account types
    { key: 'type.ASSET',         locale: 'ar-EG', value: 'أصول' },
    { key: 'type.ASSET',         locale: 'ar-SA', value: 'أصول' },
    { key: 'type.ASSET',         locale: 'en',    value: 'Asset' },
    { key: 'type.LIABILITY',     locale: 'ar-EG', value: 'خصوم' },
    { key: 'type.LIABILITY',     locale: 'ar-SA', value: 'التزامات' },
    { key: 'type.LIABILITY',     locale: 'en',    value: 'Liability' },
    { key: 'type.EQUITY',        locale: 'ar-EG', value: 'حقوق ملكية' },
    { key: 'type.EQUITY',        locale: 'ar-SA', value: 'حقوق ملكية' },
    { key: 'type.EQUITY',        locale: 'en',    value: 'Equity' },
    { key: 'type.REVENUE',       locale: 'ar-EG', value: 'إيرادات' },
    { key: 'type.REVENUE',       locale: 'ar-SA', value: 'إيرادات' },
    { key: 'type.REVENUE',       locale: 'en',    value: 'Revenue' },
    { key: 'type.EXPENSE',       locale: 'ar-EG', value: 'مصروفات' },
    { key: 'type.EXPENSE',       locale: 'ar-SA', value: 'مصروفات' },
    { key: 'type.EXPENSE',       locale: 'en',    value: 'Expense' },

    // Journal
    { key: 'journal.date',       locale: 'ar-EG', value: 'التاريخ' },
    { key: 'journal.date',       locale: 'ar-SA', value: 'التاريخ' },
    { key: 'journal.date',       locale: 'en',    value: 'Date' },
    { key: 'journal.description',locale: 'ar-EG', value: 'البيان' },
    { key: 'journal.description',locale: 'ar-SA', value: 'البيان' },
    { key: 'journal.description',locale: 'en',    value: 'Description' },
    { key: 'journal.lines',      locale: 'ar-EG', value: 'البنود' },
    { key: 'journal.lines',      locale: 'ar-SA', value: 'البنود' },
    { key: 'journal.lines',      locale: 'en',    value: 'Lines' },
    { key: 'journal.debit',      locale: 'ar-EG', value: 'مدين' },
    { key: 'journal.debit',      locale: 'ar-SA', value: 'مدين' },
    { key: 'journal.debit',      locale: 'en',    value: 'Debit' },
    { key: 'journal.credit',     locale: 'ar-EG', value: 'دائن' },
    { key: 'journal.credit',     locale: 'ar-SA', value: 'دائن' },
    { key: 'journal.credit',     locale: 'en',    value: 'Credit' },
    { key: 'journal.create',     locale: 'ar-EG', value: 'قيد جديد' },
    { key: 'journal.create',     locale: 'ar-SA', value: 'قيد جديد' },
    { key: 'journal.create',     locale: 'en',    value: 'New Entry' },
    { key: 'journal.empty',      locale: 'ar-EG', value: 'لا توجد قيود' },
    { key: 'journal.empty',      locale: 'ar-SA', value: 'لا توجد قيود' },
    { key: 'journal.empty',      locale: 'en',    value: 'No journal entries' },
    { key: 'journal.unbalanced', locale: 'ar-EG', value: 'القيد غير متوازن: مجموع المدين يجب أن يساوي مجموع الدائن' },
    { key: 'journal.unbalanced', locale: 'ar-SA', value: 'القيد غير متوازن: مجموع المدين يجب أن يساوي مجموع الدائن' },
    { key: 'journal.unbalanced', locale: 'en',    value: 'Unbalanced entry: total debit must equal total credit' },
    { key: 'journal.created',    locale: 'ar-EG', value: 'تم إنشاء القيد بنجاح' },
    { key: 'journal.created',    locale: 'ar-SA', value: 'تم إنشاء القيد بنجاح' },
    { key: 'journal.created',    locale: 'en',    value: 'Journal entry created' },
    { key: 'journal.total',      locale: 'ar-EG', value: 'الإجمالي' },
    { key: 'journal.total',      locale: 'ar-SA', value: 'الإجمالي' },
    { key: 'journal.total',      locale: 'en',    value: 'Total' },
    { key: 'journal.addLine',    locale: 'ar-EG', value: 'إضافة بند' },
    { key: 'journal.addLine',    locale: 'ar-SA', value: 'إضافة بند' },
    { key: 'journal.addLine',    locale: 'en',    value: 'Add line' },
    { key: 'journal.save',       locale: 'ar-EG', value: 'حفظ القيد' },
    { key: 'journal.save',       locale: 'ar-SA', value: 'حفظ القيد' },
    { key: 'journal.save',       locale: 'en',    value: 'Save entry' },
    { key: 'journal.cancel',     locale: 'ar-EG', value: 'إلغاء' },
    { key: 'journal.cancel',     locale: 'ar-SA', value: 'إلغاء' },
    { key: 'journal.cancel',     locale: 'en',    value: 'Cancel' },

    // Invoice (Phase 1)
    { key: 'nav.invoices',       locale: 'ar-EG', value: 'الفواتير' },
    { key: 'nav.invoices',       locale: 'ar-SA', value: 'الفواتير' },
    { key: 'nav.invoices',       locale: 'en',    value: 'Invoices' },
    { key: 'nav.reports',        locale: 'ar-EG', value: 'التقارير' },
    { key: 'nav.reports',        locale: 'ar-SA', value: 'التقارير' },
    { key: 'nav.reports',        locale: 'en',    value: 'Reports' },
    { key: 'invoice.title',      locale: 'ar-EG', value: 'الفواتير' },
    { key: 'invoice.title',      locale: 'ar-SA', value: 'الفواتير' },
    { key: 'invoice.title',      locale: 'en',    value: 'Invoices' },
    { key: 'invoice.number',     locale: 'ar-EG', value: 'رقم الفاتورة' },
    { key: 'invoice.number',     locale: 'ar-SA', value: 'رقم الفاتورة' },
    { key: 'invoice.number',     locale: 'en',    value: 'Invoice No.' },
    { key: 'invoice.customer',   locale: 'ar-EG', value: 'العميل' },
    { key: 'invoice.customer',   locale: 'ar-SA', value: 'العميل' },
    { key: 'invoice.customer',   locale: 'en',    value: 'Customer' },
    { key: 'invoice.date',       locale: 'ar-EG', value: 'التاريخ' },
    { key: 'invoice.date',       locale: 'ar-SA', value: 'التاريخ' },
    { key: 'invoice.date',       locale: 'en',    value: 'Date' },
    { key: 'invoice.status',     locale: 'ar-EG', value: 'الحالة' },
    { key: 'invoice.status',     locale: 'ar-SA', value: 'الحالة' },
    { key: 'invoice.status',     locale: 'en',    value: 'Status' },
    { key: 'invoice.total',      locale: 'ar-EG', value: 'الإجمالي' },
    { key: 'invoice.total',      locale: 'ar-SA', value: 'الإجمالي' },
    { key: 'invoice.total',      locale: 'en',    value: 'Total' },
    { key: 'invoice.create',     locale: 'ar-EG', value: 'فاتورة جديدة' },
    { key: 'invoice.create',     locale: 'ar-SA', value: 'فاتورة جديدة' },
    { key: 'invoice.create',     locale: 'en',    value: 'New Invoice' },
    { key: 'invoice.edit',       locale: 'ar-EG', value: 'تعديل' },
    { key: 'invoice.edit',       locale: 'ar-SA', value: 'تعديل' },
    { key: 'invoice.edit',       locale: 'en',    value: 'Edit' },
    { key: 'invoice.post',       locale: 'ar-EG', value: 'ترحيل' },
    { key: 'invoice.post',       locale: 'ar-SA', value: 'ترحيل' },
    { key: 'invoice.post',       locale: 'en',    value: 'Post' },
    { key: 'invoice.void',       locale: 'ar-EG', value: 'إلغاء الفاتورة' },
    { key: 'invoice.void',       locale: 'ar-SA', value: 'إلغاء الفاتورة' },
    { key: 'invoice.void',       locale: 'en',    value: 'Void' },
    { key: 'invoice.empty',      locale: 'ar-EG', value: 'لا توجد فواتير' },
    { key: 'invoice.empty',      locale: 'ar-SA', value: 'لا توجد فواتير' },
    { key: 'invoice.empty',      locale: 'en',    value: 'No invoices' },
    { key: 'invoice.lines',      locale: 'ar-EG', value: 'بنود الفاتورة' },
    { key: 'invoice.lines',      locale: 'ar-SA', value: 'بنود الفاتورة' },
    { key: 'invoice.lines',      locale: 'en',    value: 'Invoice Lines' },
    { key: 'invoice.description',locale: 'ar-EG', value: 'الوصف' },
    { key: 'invoice.description',locale: 'ar-SA', value: 'الوصف' },
    { key: 'invoice.description',locale: 'en',    value: 'Description' },
    { key: 'invoice.amount',     locale: 'ar-EG', value: 'المبلغ' },
    { key: 'invoice.amount',     locale: 'ar-SA', value: 'المبلغ' },
    { key: 'invoice.amount',     locale: 'en',    value: 'Amount' },
    { key: 'invoice.taxRate',    locale: 'ar-EG', value: 'نسبة الضريبة' },
    { key: 'invoice.taxRate',    locale: 'ar-SA', value: 'نسبة الضريبة' },
    { key: 'invoice.taxRate',    locale: 'en',    value: 'Tax Rate' },
    { key: 'invoice.addLine',    locale: 'ar-EG', value: 'إضافة بند' },
    { key: 'invoice.addLine',    locale: 'ar-SA', value: 'إضافة بند' },
    { key: 'invoice.addLine',    locale: 'en',    value: 'Add line' },
    { key: 'invoice.save',       locale: 'ar-EG', value: 'حفظ الفاتورة' },
    { key: 'invoice.save',       locale: 'ar-SA', value: 'حفظ الفاتورة' },
    { key: 'invoice.save',       locale: 'en',    value: 'Save invoice' },
    { key: 'invoice.cancel',     locale: 'ar-EG', value: 'إلغاء' },
    { key: 'invoice.cancel',     locale: 'ar-SA', value: 'إلغاء' },
    { key: 'invoice.cancel',     locale: 'en',    value: 'Cancel' },
    { key: 'invoice.posted',     locale: 'ar-EG', value: 'تم ترحيل الفاتورة بنجاح' },
    { key: 'invoice.posted',     locale: 'ar-SA', value: 'تم ترحيل الفاتورة بنجاح' },
    { key: 'invoice.posted',     locale: 'en',    value: 'Invoice posted to ledger' },
    { key: 'invoice.voided',     locale: 'ar-EG', value: 'تم إلغاء الفاتورة بقيد عكسي' },
    { key: 'invoice.voided',     locale: 'ar-SA', value: 'تم إلغاء الفاتورة بقيد عكسي' },
    { key: 'invoice.voided',     locale: 'en',    value: 'Invoice voided with reversing entry' },
    { key: 'invoice.created',    locale: 'ar-EG', value: 'تم إنشاء الفاتورة' },
    { key: 'invoice.created',    locale: 'ar-SA', value: 'تم إنشاء الفاتورة' },
    { key: 'invoice.created',    locale: 'en',    value: 'Invoice created' },
    { key: 'invoice.updated',    locale: 'ar-EG', value: 'تم تحديث الفاتورة' },
    { key: 'invoice.updated',    locale: 'ar-SA', value: 'تم تحديث الفاتورة' },
    { key: 'invoice.updated',    locale: 'en',    value: 'Invoice updated' },
    { key: 'invoice.cannotModify',locale: 'ar-EG', value: 'لا يمكن تعديل فاتورة مرحّلة أو ملغاة' },
    { key: 'invoice.cannotModify',locale: 'ar-SA', value: 'لا يمكن تعديل فاتورة مرحّلة أو ملغاة' },
    { key: 'invoice.cannotModify',locale: 'en',    value: 'Cannot modify a posted or voided invoice' },
    { key: 'invoice.notFound',   locale: 'ar-EG', value: 'الفاتورة غير موجودة' },
    { key: 'invoice.notFound',   locale: 'ar-SA', value: 'الفاتورة غير موجودة' },
    { key: 'invoice.notFound',   locale: 'en',    value: 'Invoice not found' },
    { key: 'invoice.configError',locale: 'ar-EG', value: 'خطأ في إعداد الحسابات المطلوبة للترحيل' },
    { key: 'invoice.configError',locale: 'ar-SA', value: 'خطأ في إعداد الحسابات المطلوبة للترحيل' },
    { key: 'invoice.configError',locale: 'en',    value: 'Posting accounts not configured' },
    { key: 'invoice.baseTotal',  locale: 'ar-EG', value: 'إجمالي قبل الضريبة' },
    { key: 'invoice.baseTotal',  locale: 'ar-SA', value: 'إجمالي قبل الضريبة' },
    { key: 'invoice.baseTotal',  locale: 'en',    value: 'Subtotal' },
    { key: 'invoice.taxTotal',   locale: 'ar-EG', value: 'إجمالي الضريبة' },
    { key: 'invoice.taxTotal',   locale: 'ar-SA', value: 'إجمالي الضريبة' },
    { key: 'invoice.taxTotal',   locale: 'en',    value: 'Tax Total' },
    { key: 'invoice.grandTotal', locale: 'ar-EG', value: 'الإجمالي الكلي' },
    { key: 'invoice.grandTotal', locale: 'ar-SA', value: 'الإجمالي الكلي' },
    { key: 'invoice.grandTotal', locale: 'en',    value: 'Grand Total' },

    // Invoice status labels
    { key: 'invoice.status.DRAFT',  locale: 'ar-EG', value: 'مسودة' },
    { key: 'invoice.status.DRAFT',  locale: 'ar-SA', value: 'مسودة' },
    { key: 'invoice.status.DRAFT',  locale: 'en',    value: 'Draft' },
    { key: 'invoice.status.POSTED', locale: 'ar-EG', value: 'مرحّلة' },
    { key: 'invoice.status.POSTED', locale: 'ar-SA', value: 'مرحّلة' },
    { key: 'invoice.status.POSTED', locale: 'en',    value: 'Posted' },
    { key: 'invoice.status.VOID',   locale: 'ar-EG', value: 'ملغاة' },
    { key: 'invoice.status.VOID',   locale: 'ar-SA', value: 'ملغاة' },
    { key: 'invoice.status.VOID',   locale: 'en',    value: 'Void' },

    // Account names (Phase 1 additions)
    { key: 'account.receivable', locale: 'ar-EG', value: 'العملاء (ذمم مدينة)' },
    { key: 'account.receivable', locale: 'ar-SA', value: 'العملاء (ذمم مدينة)' },
    { key: 'account.receivable', locale: 'en',    value: 'Accounts Receivable' },
    { key: 'account.salesTax',   locale: 'ar-EG', value: 'ضريبة القيمة المضافة المستحقة' },
    { key: 'account.salesTax',   locale: 'ar-SA', value: 'ضريبة القيمة المضافة المستحقة' },
    { key: 'account.salesTax',   locale: 'en',    value: 'Sales Tax Payable' },

    // Income statement report
    { key: 'report.incomeStatement',     locale: 'ar-EG', value: 'قائمة الدخل' },
    { key: 'report.incomeStatement',     locale: 'ar-SA', value: 'قائمة الدخل' },
    { key: 'report.incomeStatement',     locale: 'en',    value: 'Income Statement' },
    { key: 'report.revenue',             locale: 'ar-EG', value: 'الإيرادات' },
    { key: 'report.revenue',             locale: 'ar-SA', value: 'الإيرادات' },
    { key: 'report.revenue',             locale: 'en',    value: 'Revenue' },
    { key: 'report.expenses',            locale: 'ar-EG', value: 'المصروفات' },
    { key: 'report.expenses',            locale: 'ar-SA', value: 'المصروفات' },
    { key: 'report.expenses',            locale: 'en',    value: 'Expenses' },
    { key: 'report.netIncome',           locale: 'ar-EG', value: 'صافي الدخل' },
    { key: 'report.netIncome',           locale: 'ar-SA', value: 'صافي الدخل' },
    { key: 'report.netIncome',           locale: 'en',    value: 'Net Income' },
    { key: 'report.totalRevenue',        locale: 'ar-EG', value: 'إجمالي الإيرادات' },
    { key: 'report.totalRevenue',        locale: 'ar-SA', value: 'إجمالي الإيرادات' },
    { key: 'report.totalRevenue',        locale: 'en',    value: 'Total Revenue' },
    { key: 'report.totalExpenses',       locale: 'ar-EG', value: 'إجمالي المصروفات' },
    { key: 'report.totalExpenses',       locale: 'ar-SA', value: 'إجمالي المصروفات' },
    { key: 'report.totalExpenses',       locale: 'en',    value: 'Total Expenses' },
    { key: 'report.account',             locale: 'ar-EG', value: 'الحساب' },
    { key: 'report.account',             locale: 'ar-SA', value: 'الحساب' },
    { key: 'report.account',             locale: 'en',    value: 'Account' },
    { key: 'report.balance',             locale: 'ar-EG', value: 'الرصيد' },
    { key: 'report.balance',             locale: 'ar-SA', value: 'الرصيد' },
    { key: 'report.balance',             locale: 'en',    value: 'Balance' },
    { key: 'report.noData',              locale: 'ar-EG', value: 'لا توجد بيانات مالية' },
    { key: 'report.noData',              locale: 'ar-SA', value: 'لا توجد بيانات مالية' },
    { key: 'report.noData',              locale: 'en',    value: 'No financial data' },

    // Inventory (Phase 2)
    { key: 'nav.inventory',      locale: 'ar-EG', value: 'المخزون' },
    { key: 'nav.inventory',      locale: 'ar-SA', value: 'المخزون' },
    { key: 'nav.inventory',      locale: 'en',    value: 'Inventory' },
    { key: 'nav.purchases',      locale: 'ar-EG', value: 'المشتريات' },
    { key: 'nav.purchases',      locale: 'ar-SA', value: 'المشتريات' },
    { key: 'nav.purchases',      locale: 'en',    value: 'Purchases' },
    { key: 'inventory.title',    locale: 'ar-EG', value: 'المخزون' },
    { key: 'inventory.title',    locale: 'ar-SA', value: 'المخزون' },
    { key: 'inventory.title',    locale: 'en',    value: 'Inventory' },
    { key: 'inventory.products', locale: 'ar-EG', value: 'المنتجات' },
    { key: 'inventory.products', locale: 'ar-SA', value: 'المنتجات' },
    { key: 'inventory.products', locale: 'en',    value: 'Products' },
    { key: 'inventory.warehouses',locale: 'ar-EG', value: 'المخازن' },
    { key: 'inventory.warehouses',locale: 'ar-SA', value: 'المخازن' },
    { key: 'inventory.warehouses',locale: 'en',    value: 'Warehouses' },
    { key: 'inventory.sku',      locale: 'ar-EG', value: 'رمز المنتج' },
    { key: 'inventory.sku',      locale: 'ar-SA', value: 'رمز المنتج' },
    { key: 'inventory.sku',      locale: 'en',    value: 'SKU' },
    { key: 'inventory.name',     locale: 'ar-EG', value: 'الاسم' },
    { key: 'inventory.name',     locale: 'ar-SA', value: 'الاسم' },
    { key: 'inventory.name',     locale: 'en',    value: 'Name' },
    { key: 'inventory.costPrice',locale: 'ar-EG', value: 'تكلفة الوحدة' },
    { key: 'inventory.costPrice',locale: 'ar-SA', value: 'تكلفة الوحدة' },
    { key: 'inventory.costPrice',locale: 'en',    value: 'Cost Price' },
    { key: 'inventory.sellPrice',locale: 'ar-EG', value: 'سعر البيع' },
    { key: 'inventory.sellPrice',locale: 'ar-SA', value: 'سعر البيع' },
    { key: 'inventory.sellPrice',locale: 'en',    value: 'Sell Price' },
    { key: 'inventory.stock',    locale: 'ar-EG', value: 'الكمية' },
    { key: 'inventory.stock',    locale: 'ar-SA', value: 'الكمية' },
    { key: 'inventory.stock',    locale: 'en',    value: 'Stock' },
    { key: 'inventory.createProduct',locale: 'ar-EG', value: 'منتج جديد' },
    { key: 'inventory.createProduct',locale: 'ar-SA', value: 'منتج جديد' },
    { key: 'inventory.createProduct',locale: 'en',    value: 'New Product' },
    { key: 'inventory.createWarehouse',locale: 'ar-EG', value: 'مخزن جديد' },
    { key: 'inventory.createWarehouse',locale: 'ar-SA', value: 'مخزن جديد' },
    { key: 'inventory.createWarehouse',locale: 'en',    value: 'New Warehouse' },
    { key: 'inventory.empty',    locale: 'ar-EG', value: 'لا توجد بيانات' },
    { key: 'inventory.empty',    locale: 'ar-SA', value: 'لا توجد بيانات' },
    { key: 'inventory.empty',    locale: 'en',    value: 'No data' },
    { key: 'inventory.insufficientStock',locale: 'ar-EG', value: 'الكمية المتاحة غير كافية' },
    { key: 'inventory.insufficientStock',locale: 'ar-SA', value: 'الكمية المتاحة غير كافية' },
    { key: 'inventory.insufficientStock',locale: 'en',    value: 'Insufficient stock' },
    { key: 'inventory.configError',locale: 'ar-EG', value: 'خطأ في إعداد حسابات المخزون' },
    { key: 'inventory.configError',locale: 'ar-SA', value: 'خطأ في إعداد حسابات المخزون' },
    { key: 'inventory.configError',locale: 'en',    value: 'Inventory accounts not configured' },
    { key: 'inventory.default',  locale: 'ar-EG', value: 'افتراضي' },
    { key: 'inventory.default',  locale: 'ar-SA', value: 'افتراضي' },
    { key: 'inventory.default',  locale: 'en',    value: 'Default' },

    // Purchase orders (Phase 2)
    { key: 'purchaseOrder.title',     locale: 'ar-EG', value: 'أوامر الشراء' },
    { key: 'purchaseOrder.title',     locale: 'ar-SA', value: 'أوامر الشراء' },
    { key: 'purchaseOrder.title',     locale: 'en',    value: 'Purchase Orders' },
    { key: 'purchaseOrder.number',    locale: 'ar-EG', value: 'رقم الأمر' },
    { key: 'purchaseOrder.number',    locale: 'ar-SA', value: 'رقم الأمر' },
    { key: 'purchaseOrder.number',    locale: 'en',    value: 'PO No.' },
    { key: 'purchaseOrder.supplier',  locale: 'ar-EG', value: 'المورد' },
    { key: 'purchaseOrder.supplier',  locale: 'ar-SA', value: 'المورد' },
    { key: 'purchaseOrder.supplier',  locale: 'en',    value: 'Supplier' },
    { key: 'purchaseOrder.date',      locale: 'ar-EG', value: 'التاريخ' },
    { key: 'purchaseOrder.date',      locale: 'ar-SA', value: 'التاريخ' },
    { key: 'purchaseOrder.date',      locale: 'en',    value: 'Date' },
    { key: 'purchaseOrder.status',    locale: 'ar-EG', value: 'الحالة' },
    { key: 'purchaseOrder.status',    locale: 'ar-SA', value: 'الحالة' },
    { key: 'purchaseOrder.status',    locale: 'en',    value: 'Status' },
    { key: 'purchaseOrder.total',     locale: 'ar-EG', value: 'الإجمالي' },
    { key: 'purchaseOrder.total',     locale: 'ar-SA', value: 'الإجمالي' },
    { key: 'purchaseOrder.total',     locale: 'en',    value: 'Total' },
    { key: 'purchaseOrder.create',    locale: 'ar-EG', value: 'أمر شراء جديد' },
    { key: 'purchaseOrder.create',    locale: 'ar-SA', value: 'أمر شراء جديد' },
    { key: 'purchaseOrder.create',    locale: 'en',    value: 'New Purchase Order' },
    { key: 'purchaseOrder.receive',   locale: 'ar-EG', value: 'استلام' },
    { key: 'purchaseOrder.receive',   locale: 'ar-SA', value: 'استلام' },
    { key: 'purchaseOrder.receive',   locale: 'en',    value: 'Receive' },
    { key: 'purchaseOrder.received',  locale: 'ar-EG', value: 'تم استلام الأمر بنجاح' },
    { key: 'purchaseOrder.received',  locale: 'ar-SA', value: 'تم استلام الأمر بنجاح' },
    { key: 'purchaseOrder.received',  locale: 'en',    value: 'Purchase order received' },
    { key: 'purchaseOrder.empty',     locale: 'ar-EG', value: 'لا توجد أوامر شراء' },
    { key: 'purchaseOrder.empty',     locale: 'ar-SA', value: 'لا توجد أوامر شراء' },
    { key: 'purchaseOrder.empty',     locale: 'en',    value: 'No purchase orders' },
    { key: 'purchaseOrder.lines',     locale: 'ar-EG', value: 'بنود الأمر' },
    { key: 'purchaseOrder.lines',     locale: 'ar-SA', value: 'بنود الأمر' },
    { key: 'purchaseOrder.lines',     locale: 'en',    value: 'Order Lines' },
    { key: 'purchaseOrder.product',   locale: 'ar-EG', value: 'المنتج' },
    { key: 'purchaseOrder.product',   locale: 'ar-SA', value: 'المنتج' },
    { key: 'purchaseOrder.product',   locale: 'en',    value: 'Product' },
    { key: 'purchaseOrder.warehouse', locale: 'ar-EG', value: 'المخزن' },
    { key: 'purchaseOrder.warehouse', locale: 'ar-SA', value: 'المخزن' },
    { key: 'purchaseOrder.warehouse', locale: 'en',    value: 'Warehouse' },
    { key: 'purchaseOrder.quantity',  locale: 'ar-EG', value: 'الكمية' },
    { key: 'purchaseOrder.quantity',  locale: 'ar-SA', value: 'الكمية' },
    { key: 'purchaseOrder.quantity',  locale: 'en',    value: 'Quantity' },
    { key: 'purchaseOrder.unitCost',  locale: 'ar-EG', value: 'تكلفة الوحدة' },
    { key: 'purchaseOrder.unitCost',  locale: 'ar-SA', value: 'تكلفة الوحدة' },
    { key: 'purchaseOrder.unitCost',  locale: 'en',    value: 'Unit Cost' },
    { key: 'purchaseOrder.addLine',   locale: 'ar-EG', value: 'إضافة بند' },
    { key: 'purchaseOrder.addLine',   locale: 'ar-SA', value: 'إضافة بند' },
    { key: 'purchaseOrder.addLine',   locale: 'en',    value: 'Add line' },
    { key: 'purchaseOrder.save',      locale: 'ar-EG', value: 'حفظ الأمر' },
    { key: 'purchaseOrder.save',      locale: 'ar-SA', value: 'حفظ الأمر' },
    { key: 'purchaseOrder.save',      locale: 'en',    value: 'Save order' },
    { key: 'purchaseOrder.cancel',    locale: 'ar-EG', value: 'إلغاء' },
    { key: 'purchaseOrder.cancel',    locale: 'ar-SA', value: 'إلغاء' },
    { key: 'purchaseOrder.cancel',    locale: 'en',    value: 'Cancel' },
    { key: 'purchaseOrder.notFound',  locale: 'ar-EG', value: 'أمر الشراء غير موجود' },
    { key: 'purchaseOrder.notFound',  locale: 'ar-SA', value: 'أمر الشراء غير موجود' },
    { key: 'purchaseOrder.notFound',  locale: 'en',    value: 'Purchase order not found' },
    { key: 'purchaseOrder.cannotModify',locale: 'ar-EG', value: 'لا يمكن تعديل أمر شراء مستلم' },
    { key: 'purchaseOrder.cannotModify',locale: 'ar-SA', value: 'لا يمكن تعديل أمر شراء مستلم' },
    { key: 'purchaseOrder.cannotModify',locale: 'en',    value: 'Cannot modify a received purchase order' },
    { key: 'purchaseOrder.status.DRAFT',    locale: 'ar-EG', value: 'مسودة' },
    { key: 'purchaseOrder.status.DRAFT',    locale: 'ar-SA', value: 'مسودة' },
    { key: 'purchaseOrder.status.DRAFT',    locale: 'en',    value: 'Draft' },
    { key: 'purchaseOrder.status.RECEIVED', locale: 'ar-EG', value: 'مستلم' },
    { key: 'purchaseOrder.status.RECEIVED', locale: 'ar-SA', value: 'مستلم' },
    { key: 'purchaseOrder.status.RECEIVED', locale: 'en',    value: 'Received' },
    { key: 'purchaseOrder.status.CANCELLED',locale: 'ar-EG', value: 'ملغي' },
    { key: 'purchaseOrder.status.CANCELLED',locale: 'ar-SA', value: 'ملغي' },
    { key: 'purchaseOrder.status.CANCELLED',locale: 'en',    value: 'Cancelled' },

    // Account names (Phase 2 additions)
    { key: 'account.inventory',   locale: 'ar-EG', value: 'المخزون' },
    { key: 'account.inventory',   locale: 'ar-SA', value: 'المخزون' },
    { key: 'account.inventory',   locale: 'en',    value: 'Inventory' },
    { key: 'account.payable',     locale: 'ar-EG', value: 'حسابات دائنة (موردون)' },
    { key: 'account.payable',     locale: 'ar-SA', value: 'حسابات دائنة (موردون)' },
    { key: 'account.payable',     locale: 'en',    value: 'Accounts Payable' },
    { key: 'account.cogs',        locale: 'ar-EG', value: 'تكلفة البضاعة المباعة' },
    { key: 'account.cogs',        locale: 'ar-SA', value: 'تكلفة البضاعة المباعة' },
    { key: 'account.cogs',        locale: 'en',    value: 'Cost of Goods Sold' },

    // Product names
    { key: 'product.laptop',      locale: 'ar-EG', value: 'لابتوب' },
    { key: 'product.laptop',      locale: 'ar-SA', value: 'لابتوب' },
    { key: 'product.laptop',      locale: 'en',    value: 'Laptop' },
    { key: 'product.mouse',       locale: 'ar-EG', value: 'ماوس' },
    { key: 'product.mouse',       locale: 'ar-SA', value: 'ماوس' },
    { key: 'product.mouse',       locale: 'en',    value: 'Mouse' },
    { key: 'product.keyboard',    locale: 'ar-EG', value: 'لوحة مفاتيح' },
    { key: 'product.keyboard',    locale: 'ar-SA', value: 'لوحة مفاتيح' },
    { key: 'product.keyboard',    locale: 'en',    value: 'Keyboard' },

    // Warehouse names
    { key: 'warehouse.main',      locale: 'ar-EG', value: 'المخزن الرئيسي' },
    { key: 'warehouse.main',      locale: 'ar-SA', value: 'المخزن الرئيسي' },
    { key: 'warehouse.main',      locale: 'en',    value: 'Main Warehouse' },

    // POS (Phase 3)
    { key: 'nav.pos',             locale: 'ar-EG', value: 'نقطة البيع' },
    { key: 'nav.pos',             locale: 'ar-SA', value: 'نقطة البيع' },
    { key: 'nav.pos',             locale: 'en',    value: 'POS' },
    { key: 'pos.title',           locale: 'ar-EG', value: 'نقطة البيع' },
    { key: 'pos.title',           locale: 'ar-SA', value: 'نقطة البيع' },
    { key: 'pos.title',           locale: 'en',    value: 'Point of Sale' },
    { key: 'pos.searchProducts',  locale: 'ar-EG', value: 'ابحث عن منتج بالاسم أو الرمز' },
    { key: 'pos.searchProducts',  locale: 'ar-SA', value: 'ابحث عن منتج بالاسم أو الرمز' },
    { key: 'pos.searchProducts',  locale: 'en',    value: 'Search products by name or SKU' },
    { key: 'pos.cart',            locale: 'ar-EG', value: 'السلة' },
    { key: 'pos.cart',            locale: 'ar-SA', value: 'السلة' },
    { key: 'pos.cart',            locale: 'en',    value: 'Cart' },
    { key: 'pos.checkout',        locale: 'ar-EG', value: 'إتمام البيع' },
    { key: 'pos.checkout',        locale: 'ar-SA', value: 'إتمام البيع' },
    { key: 'pos.checkout',        locale: 'en',    value: 'Checkout' },
    { key: 'pos.customerName',    locale: 'ar-EG', value: 'اسم العميل' },
    { key: 'pos.customerName',    locale: 'ar-SA', value: 'اسم العميل' },
    { key: 'pos.customerName',    locale: 'en',    value: 'Customer Name' },
    { key: 'pos.warehouse',       locale: 'ar-EG', value: 'المخزن' },
    { key: 'pos.warehouse',       locale: 'ar-SA', value: 'المخزن' },
    { key: 'pos.warehouse',       locale: 'en',    value: 'Warehouse' },
    { key: 'pos.emptyCart',       locale: 'ar-EG', value: 'السلة فارغة' },
    { key: 'pos.emptyCart',       locale: 'ar-SA', value: 'السلة فارغة' },
    { key: 'pos.emptyCart',       locale: 'en',    value: 'Cart is empty' },
    { key: 'pos.subtotal',        locale: 'ar-EG', value: 'الإجمالي قبل الضريبة' },
    { key: 'pos.subtotal',        locale: 'ar-SA', value: 'الإجمالي قبل الضريبة' },
    { key: 'pos.subtotal',        locale: 'en',    value: 'Subtotal' },
    { key: 'pos.tax',             locale: 'ar-EG', value: 'الضريبة' },
    { key: 'pos.tax',             locale: 'ar-SA', value: 'الضريبة' },
    { key: 'pos.tax',             locale: 'en',    value: 'Tax' },
    { key: 'pos.total',           locale: 'ar-EG', value: 'الإجمالي' },
    { key: 'pos.total',           locale: 'ar-SA', value: 'الإجمالي' },
    { key: 'pos.total',           locale: 'en',    value: 'Total' },
    { key: 'pos.saleComplete',    locale: 'ar-EG', value: 'تم إتمام البيع بنجاح' },
    { key: 'pos.saleComplete',    locale: 'ar-SA', value: 'تم إتمام البيع بنجاح' },
    { key: 'pos.saleComplete',    locale: 'en',    value: 'Sale completed successfully' },
    { key: 'pos.receipt',         locale: 'ar-EG', value: 'إيصال' },
    { key: 'pos.receipt',         locale: 'ar-SA', value: 'إيصال' },
    { key: 'pos.receipt',         locale: 'en',    value: 'Receipt' },
    { key: 'pos.invoiceNumber',   locale: 'ar-EG', value: 'رقم الفاتورة' },
    { key: 'pos.invoiceNumber',   locale: 'ar-SA', value: 'رقم الفاتورة' },
    { key: 'pos.invoiceNumber',   locale: 'en',    value: 'Invoice No.' },
    { key: 'pos.cogs',            locale: 'ar-EG', value: 'تكلفة البضاعة المباعة' },
    { key: 'pos.cogs',            locale: 'ar-SA', value: 'تكلفة البضاعة المباعة' },
    { key: 'pos.cogs',            locale: 'en',    value: 'COGS' },
    { key: 'pos.netProfit',       locale: 'ar-EG', value: 'صافي الربح' },
    { key: 'pos.netProfit',       locale: 'ar-SA', value: 'صافي الربح' },
    { key: 'pos.netProfit',       locale: 'en',    value: 'Net Profit' },
    { key: 'pos.newSale',         locale: 'ar-EG', value: 'بيع جديد' },
    { key: 'pos.newSale',         locale: 'ar-SA', value: 'بيع جديد' },
    { key: 'pos.newSale',         locale: 'en',    value: 'New Sale' },
    { key: 'pos.noProducts',      locale: 'ar-EG', value: 'لا توجد منتجات' },
    { key: 'pos.noProducts',      locale: 'ar-SA', value: 'لا توجد منتجات' },
    { key: 'pos.noProducts',      locale: 'en',    value: 'No products' },
    { key: 'pos.addToCart',       locale: 'ar-EG', value: 'إضافة للسلة' },
    { key: 'pos.addToCart',       locale: 'ar-SA', value: 'إضافة للسلة' },
    { key: 'pos.addToCart',       locale: 'en',    value: 'Add to cart' },
    { key: 'pos.qty',             locale: 'ar-EG', value: 'الكمية' },
    { key: 'pos.qty',             locale: 'ar-SA', value: 'الكمية' },
    { key: 'pos.qty',             locale: 'en',    value: 'Qty' },
    { key: 'pos.price',           locale: 'ar-EG', value: 'السعر' },
    { key: 'pos.price',           locale: 'ar-SA', value: 'السعر' },
    { key: 'pos.price',           locale: 'en',    value: 'Price' },
    { key: 'pos.stock',           locale: 'ar-EG', value: 'المتاح' },
    { key: 'pos.stock',           locale: 'ar-SA', value: 'المتاح' },
    { key: 'pos.stock',           locale: 'en',    value: 'Stock' },

    // Invoice channel labels
    { key: 'invoice.channel.MANUAL', locale: 'ar-EG', value: 'يدوية' },
    { key: 'invoice.channel.MANUAL', locale: 'ar-SA', value: 'يدوية' },
    { key: 'invoice.channel.MANUAL', locale: 'en',    value: 'Manual' },
    { key: 'invoice.channel.POS',    locale: 'ar-EG', value: 'نقطة بيع' },
    { key: 'invoice.channel.POS',    locale: 'ar-SA', value: 'نقطة بيع' },
    { key: 'invoice.channel.POS',    locale: 'en',    value: 'POS' },

    // Tests
    { key: 'tests.title',        locale: 'ar-EG', value: 'اختبارات العزل والتوازن' },
    { key: 'tests.title',        locale: 'ar-SA', value: 'اختبارات العزل والتوازن' },
    { key: 'tests.title',        locale: 'en',    value: 'Isolation & Balance Tests' },
    { key: 'tests.run',          locale: 'ar-EG', value: 'تشغيل الاختبارات' },
    { key: 'tests.run',          locale: 'ar-SA', value: 'تشغيل الاختبارات' },
    { key: 'tests.run',          locale: 'en',    value: 'Run tests' },
    { key: 'tests.tenantIsolation', locale: 'ar-EG', value: 'عزل المستأجرين' },
    { key: 'tests.tenantIsolation', locale: 'ar-SA', value: 'عزل المستأجرين' },
    { key: 'tests.tenantIsolation', locale: 'en',    value: 'Tenant isolation' },
    { key: 'tests.journalBalance',  locale: 'ar-EG', value: 'توازن القيود' },
    { key: 'tests.journalBalance',  locale: 'ar-SA', value: 'توازن القيود' },
    { key: 'tests.journalBalance',  locale: 'en',    value: 'Journal balance' },
    { key: 'tests.passed',       locale: 'ar-EG', value: 'نجح' },
    { key: 'tests.passed',       locale: 'ar-SA', value: 'نجح' },
    { key: 'tests.passed',       locale: 'en',    value: 'PASS' },
    { key: 'tests.failed',       locale: 'ar-EG', value: 'فشل' },
    { key: 'tests.failed',       locale: 'ar-SA', value: 'فشل' },
    { key: 'tests.failed',       locale: 'en',    value: 'FAIL' },
    { key: 'tests.running',      locale: 'ar-EG', value: 'جارٍ التشغيل...' },
    { key: 'tests.running',      locale: 'ar-SA', value: 'جارٍ التشغيل...' },
    { key: 'tests.running',      locale: 'en',    value: 'Running...' },
    { key: 'tests.idle',         locale: 'ar-EG', value: 'لم يتم التشغيل بعد' },
    { key: 'tests.idle',         locale: 'ar-SA', value: 'لم يتم التشغيل بعد' },
    { key: 'tests.idle',         locale: 'en',    value: 'Not run yet' },

    // Common
    { key: 'common.welcome',     locale: 'ar-EG', value: 'أهلاً' },
    { key: 'common.welcome',     locale: 'ar-SA', value: 'مرحباً' },
    { key: 'common.welcome',     locale: 'en',    value: 'Welcome' },
    { key: 'common.role',        locale: 'ar-EG', value: 'الدور' },
    { key: 'common.role',        locale: 'ar-SA', value: 'الدور' },
    { key: 'common.role',        locale: 'en',    value: 'Role' },
    { key: 'common.tenant',      locale: 'ar-EG', value: 'المستأجر' },
    { key: 'common.tenant',      locale: 'ar-SA', value: 'المستأجر' },
    { key: 'common.tenant',      locale: 'en',    value: 'Tenant' },
    { key: 'common.language',    locale: 'ar-EG', value: 'اللغة' },
    { key: 'common.language',    locale: 'ar-SA', value: 'اللغة' },
    { key: 'common.language',    locale: 'en',    value: 'Language' },
    { key: 'common.loading',     locale: 'ar-EG', value: 'جارٍ التحميل...' },
    { key: 'common.loading',     locale: 'ar-SA', value: 'جارٍ التحميل...' },
    { key: 'common.loading',     locale: 'en',    value: 'Loading...' },
    { key: 'common.error',       locale: 'ar-EG', value: 'حدث خطأ' },
    { key: 'common.error',       locale: 'ar-SA', value: 'حدث خطأ' },
    { key: 'common.error',       locale: 'en',    value: 'Something went wrong' },
    { key: 'common.forbidden',   locale: 'ar-EG', value: 'ليس لديك صلاحية لتنفيذ هذا الإجراء' },
    { key: 'common.forbidden',   locale: 'ar-SA', value: 'ليس لديك صلاحية لتنفيذ هذا الإجراء' },
    { key: 'common.forbidden',   locale: 'en',    value: 'You do not have permission to perform this action' },
    { key: 'common.unauthorized',locale: 'ar-EG', value: 'يجب تسجيل الدخول أولاً' },
    { key: 'common.unauthorized',locale: 'ar-SA', value: 'يجب تسجيل الدخول أولاً' },
    { key: 'common.unauthorized',locale: 'en',    value: 'Authentication required' },
    { key: 'common.save',        locale: 'ar-EG', value: 'حفظ' },
    { key: 'common.save',        locale: 'ar-SA', value: 'حفظ' },
    { key: 'common.save',        locale: 'en',    value: 'Save' },
    { key: 'common.cancel',      locale: 'ar-EG', value: 'إلغاء' },
    { key: 'common.cancel',      locale: 'ar-SA', value: 'إلغاء' },
    { key: 'common.cancel',      locale: 'en',    value: 'Cancel' },

    // ============== Phase 4: Manufacturing ==============
    { key: 'nav.manufacturing',                  locale: 'ar-EG', value: 'التصنيع' },
    { key: 'nav.manufacturing',                  locale: 'ar-SA', value: 'التصنيع' },
    { key: 'nav.manufacturing',                  locale: 'en',    value: 'Manufacturing' },
    { key: 'manufacturing.title',                locale: 'ar-EG', value: 'التصنيع' },
    { key: 'manufacturing.title',                locale: 'ar-SA', value: 'التصنيع' },
    { key: 'manufacturing.title',                locale: 'en',    value: 'Manufacturing' },
    { key: 'manufacturing.bom',                  locale: 'ar-EG', value: 'قائمة المواد' },
    { key: 'manufacturing.bom',                  locale: 'ar-SA', value: 'قائمة المكونات' },
    { key: 'manufacturing.bom',                  locale: 'en',    value: 'Bill of Materials' },
    { key: 'manufacturing.boms',                 locale: 'ar-EG', value: 'قوائم المواد' },
    { key: 'manufacturing.boms',                 locale: 'ar-SA', value: 'قوائم المكونات' },
    { key: 'manufacturing.boms',                 locale: 'en',    value: 'BOMs' },
    { key: 'manufacturing.createBOM',            locale: 'ar-EG', value: 'إنشاء قائمة مواد' },
    { key: 'manufacturing.createBOM',            locale: 'ar-SA', value: 'إنشاء قائمة مكونات' },
    { key: 'manufacturing.createBOM',            locale: 'en',    value: 'Create BOM' },
    { key: 'manufacturing.finishedProduct',      locale: 'ar-EG', value: 'المنتج النهائي' },
    { key: 'manufacturing.finishedProduct',      locale: 'ar-SA', value: 'المنتج النهائي' },
    { key: 'manufacturing.finishedProduct',      locale: 'en',    value: 'Finished Product' },
    { key: 'manufacturing.laborCostPerUnit',     locale: 'ar-EG', value: 'تكلفة العمالة للوحدة' },
    { key: 'manufacturing.laborCostPerUnit',     locale: 'ar-SA', value: 'تكلفة العمالة للوحدة' },
    { key: 'manufacturing.laborCostPerUnit',     locale: 'en',    value: 'Labor Cost Per Unit' },
    { key: 'manufacturing.components',           locale: 'ar-EG', value: 'المكونات' },
    { key: 'manufacturing.components',           locale: 'ar-SA', value: 'المكونات' },
    { key: 'manufacturing.components',           locale: 'en',    value: 'Components' },
    { key: 'manufacturing.rawMaterial',          locale: 'ar-EG', value: 'المادة الخام' },
    { key: 'manufacturing.rawMaterial',          locale: 'ar-SA', value: 'المادة الخام' },
    { key: 'manufacturing.rawMaterial',          locale: 'en',    value: 'Raw Material' },
    { key: 'manufacturing.quantityPerUnit',      locale: 'ar-EG', value: 'الكمية لكل وحدة' },
    { key: 'manufacturing.quantityPerUnit',      locale: 'ar-SA', value: 'الكمية لكل وحدة' },
    { key: 'manufacturing.quantityPerUnit',      locale: 'en',    value: 'Quantity Per Unit' },
    { key: 'manufacturing.addComponent',         locale: 'ar-EG', value: 'إضافة مكون' },
    { key: 'manufacturing.addComponent',         locale: 'ar-SA', value: 'إضافة مكون' },
    { key: 'manufacturing.addComponent',         locale: 'en',    value: 'Add Component' },
    { key: 'manufacturing.noBOMs',               locale: 'ar-EG', value: 'لا توجد قوائم مواد' },
    { key: 'manufacturing.noBOMs',               locale: 'ar-SA', value: 'لا توجد قوائم مكونات' },
    { key: 'manufacturing.noBOMs',               locale: 'en',    value: 'No BOMs' },
    { key: 'manufacturing.productionOrders',     locale: 'ar-EG', value: 'أوامر الإنتاج' },
    { key: 'manufacturing.productionOrders',     locale: 'ar-SA', value: 'أوامر الإنتاج' },
    { key: 'manufacturing.productionOrders',     locale: 'en',    value: 'Production Orders' },
    { key: 'manufacturing.createProductionOrder',locale: 'ar-EG', value: 'أمر إنتاج جديد' },
    { key: 'manufacturing.createProductionOrder',locale: 'ar-SA', value: 'أمر إنتاج جديد' },
    { key: 'manufacturing.createProductionOrder',locale: 'en',    value: 'Create Production Order' },
    { key: 'manufacturing.quantity',             locale: 'ar-EG', value: 'الكمية' },
    { key: 'manufacturing.quantity',             locale: 'ar-SA', value: 'الكمية' },
    { key: 'manufacturing.quantity',             locale: 'en',    value: 'Quantity' },
    { key: 'manufacturing.warehouse',            locale: 'ar-EG', value: 'المخزن' },
    { key: 'manufacturing.warehouse',            locale: 'ar-SA', value: 'المخزن' },
    { key: 'manufacturing.warehouse',            locale: 'en',    value: 'Warehouse' },
    { key: 'manufacturing.status',               locale: 'ar-EG', value: 'الحالة' },
    { key: 'manufacturing.status',               locale: 'ar-SA', value: 'الحالة' },
    { key: 'manufacturing.status',               locale: 'en',    value: 'Status' },
    { key: 'manufacturing.complete',             locale: 'ar-EG', value: 'إتمام' },
    { key: 'manufacturing.complete',             locale: 'ar-SA', value: 'إتمام' },
    { key: 'manufacturing.complete',             locale: 'en',    value: 'Complete' },
    { key: 'manufacturing.draft',                locale: 'ar-EG', value: 'مسودة' },
    { key: 'manufacturing.draft',                locale: 'ar-SA', value: 'مسودة' },
    { key: 'manufacturing.draft',                locale: 'en',    value: 'Draft' },
    { key: 'manufacturing.completed',            locale: 'ar-EG', value: 'مكتمل' },
    { key: 'manufacturing.completed',            locale: 'ar-SA', value: 'مكتمل' },
    { key: 'manufacturing.completed',            locale: 'en',    value: 'Completed' },
    { key: 'manufacturing.cancelled',            locale: 'ar-EG', value: 'ملغي' },
    { key: 'manufacturing.cancelled',            locale: 'ar-SA', value: 'ملغي' },
    { key: 'manufacturing.cancelled',            locale: 'en',    value: 'Cancelled' },
    { key: 'manufacturing.noProductionOrders',   locale: 'ar-EG', value: 'لا توجد أوامر إنتاج' },
    { key: 'manufacturing.noProductionOrders',   locale: 'ar-SA', value: 'لا توجد أوامر إنتاج' },
    { key: 'manufacturing.noProductionOrders',   locale: 'en',    value: 'No Production Orders' },
    { key: 'manufacturing.totalMaterialCost',    locale: 'ar-EG', value: 'إجمالي تكلفة المواد' },
    { key: 'manufacturing.totalMaterialCost',    locale: 'ar-SA', value: 'إجمالي تكلفة المواد' },
    { key: 'manufacturing.totalMaterialCost',    locale: 'en',    value: 'Total Material Cost' },
    { key: 'manufacturing.totalLaborCost',       locale: 'ar-EG', value: 'إجمالي تكلفة العمالة' },
    { key: 'manufacturing.totalLaborCost',       locale: 'ar-SA', value: 'إجمالي تكلفة العمالة' },
    { key: 'manufacturing.totalLaborCost',       locale: 'en',    value: 'Total Labor Cost' },
    { key: 'manufacturing.totalCost',            locale: 'ar-EG', value: 'الإجمالي الكلي' },
    { key: 'manufacturing.totalCost',            locale: 'ar-SA', value: 'الإجمالي الكلي' },
    { key: 'manufacturing.totalCost',            locale: 'en',    value: 'Total Cost' },
    { key: 'manufacturing.selectProduct',        locale: 'ar-EG', value: 'اختر المنتج' },
    { key: 'manufacturing.selectProduct',        locale: 'ar-SA', value: 'اختر المنتج' },
    { key: 'manufacturing.selectProduct',        locale: 'en',    value: 'Select Product' },
    { key: 'manufacturing.productHasBOM',        locale: 'ar-EG', value: 'للمنتج قائمة مواد موجودة' },
    { key: 'manufacturing.productHasBOM',        locale: 'ar-SA', value: 'للمنتج قائمة مكونات موجودة' },
    { key: 'manufacturing.productHasBOM',        locale: 'en',    value: 'Product already has a BOM' },

    // ============== Phase 4: HR / Payroll ==============
    { key: 'nav.hr',                  locale: 'ar-EG', value: 'الموارد البشرية' },
    { key: 'nav.hr',                  locale: 'ar-SA', value: 'الموارد البشرية' },
    { key: 'nav.hr',                  locale: 'en',    value: 'Human Resources' },
    { key: 'hr.title',                locale: 'ar-EG', value: 'الموارد البشرية والرواتب' },
    { key: 'hr.title',                locale: 'ar-SA', value: 'الموارد البشرية والرواتب' },
    { key: 'hr.title',                locale: 'en',    value: 'HR & Payroll' },
    { key: 'hr.employees',            locale: 'ar-EG', value: 'الموظفون' },
    { key: 'hr.employees',            locale: 'ar-SA', value: 'الموظفون' },
    { key: 'hr.employees',            locale: 'en',    value: 'Employees' },
    { key: 'hr.createEmployee',       locale: 'ar-EG', value: 'إضافة موظف' },
    { key: 'hr.createEmployee',       locale: 'ar-SA', value: 'إضافة موظف' },
    { key: 'hr.createEmployee',       locale: 'en',    value: 'New Employee' },
    { key: 'hr.fullName',             locale: 'ar-EG', value: 'الاسم الكامل' },
    { key: 'hr.fullName',             locale: 'ar-SA', value: 'الاسم الكامل' },
    { key: 'hr.fullName',             locale: 'en',    value: 'Full Name' },
    { key: 'hr.nationalId',           locale: 'ar-EG', value: 'الرقم القومي' },
    { key: 'hr.nationalId',           locale: 'ar-SA', value: 'رقم الهوية' },
    { key: 'hr.nationalId',           locale: 'en',    value: 'National ID' },
    { key: 'hr.hireDate',             locale: 'ar-EG', value: 'تاريخ التعيين' },
    { key: 'hr.hireDate',             locale: 'ar-SA', value: 'تاريخ التعيين' },
    { key: 'hr.hireDate',             locale: 'en',    value: 'Hire Date' },
    { key: 'hr.baseSalary',           locale: 'ar-EG', value: 'الراتب الأساسي' },
    { key: 'hr.baseSalary',           locale: 'ar-SA', value: 'الراتب الأساسي' },
    { key: 'hr.baseSalary',           locale: 'en',    value: 'Base Salary' },
    { key: 'hr.status',               locale: 'ar-EG', value: 'الحالة' },
    { key: 'hr.status',               locale: 'ar-SA', value: 'الحالة' },
    { key: 'hr.status',               locale: 'en',    value: 'Status' },
    { key: 'hr.active',               locale: 'ar-EG', value: 'نشط' },
    { key: 'hr.active',               locale: 'ar-SA', value: 'على رأس العمل' },
    { key: 'hr.active',               locale: 'en',    value: 'Active' },
    { key: 'hr.suspended',            locale: 'ar-EG', value: 'موقوف' },
    { key: 'hr.suspended',            locale: 'ar-SA', value: 'موقوف' },
    { key: 'hr.suspended',            locale: 'en',    value: 'Suspended' },
    { key: 'hr.terminated',           locale: 'ar-EG', value: 'منتهي الخدمة' },
    { key: 'hr.terminated',           locale: 'ar-SA', value: 'منتهي الخدمة' },
    { key: 'hr.terminated',           locale: 'en',    value: 'Terminated' },
    { key: 'hr.noEmployees',          locale: 'ar-EG', value: 'لا يوجد موظفون' },
    { key: 'hr.noEmployees',          locale: 'ar-SA', value: 'لا يوجد موظفون' },
    { key: 'hr.noEmployees',          locale: 'en',    value: 'No Employees' },
    { key: 'hr.payrollRuns',          locale: 'ar-EG', value: 'دفعات الرواتب' },
    { key: 'hr.payrollRuns',          locale: 'ar-SA', value: 'دفعات الرواتب' },
    { key: 'hr.payrollRuns',          locale: 'en',    value: 'Payroll Runs' },
    { key: 'hr.createPayrollRun',     locale: 'ar-EG', value: 'إنشاء دفعة رواتب' },
    { key: 'hr.createPayrollRun',     locale: 'ar-SA', value: 'إنشاء دفعة رواتب' },
    { key: 'hr.createPayrollRun',     locale: 'en',    value: 'Create Payroll Run' },
    { key: 'hr.period',               locale: 'ar-EG', value: 'الفترة' },
    { key: 'hr.period',               locale: 'ar-SA', value: 'الفترة' },
    { key: 'hr.period',               locale: 'en',    value: 'Period' },
    { key: 'hr.selectEmployees',      locale: 'ar-EG', value: 'اختر الموظفين' },
    { key: 'hr.selectEmployees',      locale: 'ar-SA', value: 'اختر الموظفين' },
    { key: 'hr.selectEmployees',      locale: 'en',    value: 'Select Employees' },
    { key: 'hr.post',                 locale: 'ar-EG', value: 'ترحيل' },
    { key: 'hr.post',                 locale: 'ar-SA', value: 'ترحيل' },
    { key: 'hr.post',                 locale: 'en',    value: 'Post' },
    { key: 'hr.posted',               locale: 'ar-EG', value: 'تم الترحيل' },
    { key: 'hr.posted',               locale: 'ar-SA', value: 'تم الترحيل' },
    { key: 'hr.posted',               locale: 'en',    value: 'Posted' },
    { key: 'hr.draft',                locale: 'ar-EG', value: 'مسودة' },
    { key: 'hr.draft',                locale: 'ar-SA', value: 'مسودة' },
    { key: 'hr.draft',                locale: 'en',    value: 'Draft' },
    { key: 'hr.noPayrollRuns',        locale: 'ar-EG', value: 'لا توجد دفعات رواتب' },
    { key: 'hr.noPayrollRuns',        locale: 'ar-SA', value: 'لا توجد دفعات رواتب' },
    { key: 'hr.noPayrollRuns',        locale: 'en',    value: 'No Payroll Runs' },
    { key: 'hr.grossSalary',          locale: 'ar-EG', value: 'الراتب الإجمالي' },
    { key: 'hr.grossSalary',          locale: 'ar-SA', value: 'الراتب الإجمالي' },
    { key: 'hr.grossSalary',          locale: 'en',    value: 'Gross Salary' },
    { key: 'hr.incomeTax',            locale: 'ar-EG', value: 'ضريبة الدخل' },
    { key: 'hr.incomeTax',            locale: 'ar-SA', value: 'ضريبة الدخل' },
    { key: 'hr.incomeTax',            locale: 'en',    value: 'Income Tax' },
    { key: 'hr.employeeInsurance',    locale: 'ar-EG', value: 'تأمين الموظف' },
    { key: 'hr.employeeInsurance',    locale: 'ar-SA', value: 'تأمين الموظف' },
    { key: 'hr.employeeInsurance',    locale: 'en',    value: 'Employee Insurance' },
    { key: 'hr.employerInsurance',    locale: 'ar-EG', value: 'تأمين صاحب العمل' },
    { key: 'hr.employerInsurance',    locale: 'ar-SA', value: 'تأمين صاحب العمل' },
    { key: 'hr.employerInsurance',    locale: 'en',    value: 'Employer Insurance' },
    { key: 'hr.netPay',               locale: 'ar-EG', value: 'صافي المستحق' },
    { key: 'hr.netPay',               locale: 'ar-SA', value: 'صافي المستحق' },
    { key: 'hr.netPay',               locale: 'en',    value: 'Net Pay' },
    { key: 'hr.totalGross',           locale: 'ar-EG', value: 'إجمالي الرواتب' },
    { key: 'hr.totalGross',           locale: 'ar-SA', value: 'إجمالي الرواتب' },
    { key: 'hr.totalGross',           locale: 'en',    value: 'Total Gross' },
    { key: 'hr.totalNet',             locale: 'ar-EG', value: 'إجمالي الصافي' },
    { key: 'hr.totalNet',             locale: 'ar-SA', value: 'إجمالي الصافي' },
    { key: 'hr.totalNet',             locale: 'en',    value: 'Total Net' },
    { key: 'hr.totalTax',             locale: 'ar-EG', value: 'إجمالي الضريبة' },
    { key: 'hr.totalTax',             locale: 'ar-SA', value: 'إجمالي الضريبة' },
    { key: 'hr.totalTax',             locale: 'en',    value: 'Total Tax' },
    { key: 'hr.lines',                locale: 'ar-EG', value: 'بنود الرواتب' },
    { key: 'hr.lines',                locale: 'ar-SA', value: 'بنود الرواتب' },
    { key: 'hr.lines',                locale: 'en',    value: 'Payroll Lines' },
    { key: 'hr.cannotModify',         locale: 'ar-EG', value: 'لا يمكن تعديل دفعة رواتب مرحّلة' },
    { key: 'hr.cannotModify',         locale: 'ar-SA', value: 'لا يمكن تعديل دفعة رواتب مرحّلة' },
    { key: 'hr.cannotModify',         locale: 'en',    value: 'Cannot modify a posted payroll run' },
    { key: 'hr.invalidInput',         locale: 'ar-EG', value: 'المدخلات غير صحيحة' },
    { key: 'hr.invalidInput',         locale: 'ar-SA', value: 'المدخلات غير صحيحة' },
    { key: 'hr.invalidInput',         locale: 'en',    value: 'Invalid input' },
    { key: 'hr.configError',          locale: 'ar-EG', value: 'خطأ في إعداد حسابات الرواتب' },
    { key: 'hr.configError',          locale: 'ar-SA', value: 'خطأ في إعداد حسابات الرواتب' },
    { key: 'hr.configError',          locale: 'en',    value: 'Payroll accounts not configured' },

    // ============== Phase 4: CRM ==============
    { key: 'nav.crm',                       locale: 'ar-EG', value: 'إدارة العملاء' },
    { key: 'nav.crm',                       locale: 'ar-SA', value: 'إدارة العملاء' },
    { key: 'nav.crm',                       locale: 'en',    value: 'CRM' },
    { key: 'crm.title',                     locale: 'ar-EG', value: 'إدارة علاقات العملاء' },
    { key: 'crm.title',                     locale: 'ar-SA', value: 'إدارة علاقات العملاء' },
    { key: 'crm.title',                     locale: 'en',    value: 'Customer Relationship Management' },
    { key: 'crm.customers',                 locale: 'ar-EG', value: 'العملاء' },
    { key: 'crm.customers',                 locale: 'ar-SA', value: 'العملاء' },
    { key: 'crm.customers',                 locale: 'en',    value: 'Customers' },
    { key: 'crm.createCustomer',            locale: 'ar-EG', value: 'إضافة عميل' },
    { key: 'crm.createCustomer',            locale: 'ar-SA', value: 'إضافة عميل' },
    { key: 'crm.createCustomer',            locale: 'en',    value: 'New Customer' },
    { key: 'crm.customerName',              locale: 'ar-EG', value: 'اسم العميل' },
    { key: 'crm.customerName',              locale: 'ar-SA', value: 'اسم العميل' },
    { key: 'crm.customerName',              locale: 'en',    value: 'Customer Name' },
    { key: 'crm.phone',                     locale: 'ar-EG', value: 'الهاتف' },
    { key: 'crm.phone',                     locale: 'ar-SA', value: 'الهاتف' },
    { key: 'crm.phone',                     locale: 'en',    value: 'Phone' },
    { key: 'crm.email',                     locale: 'ar-EG', value: 'البريد الإلكتروني' },
    { key: 'crm.email',                     locale: 'ar-SA', value: 'البريد الإلكتروني' },
    { key: 'crm.email',                     locale: 'en',    value: 'Email' },
    { key: 'crm.noCustomers',               locale: 'ar-EG', value: 'لا يوجد عملاء' },
    { key: 'crm.noCustomers',               locale: 'ar-SA', value: 'لا يوجد عملاء' },
    { key: 'crm.noCustomers',               locale: 'en',    value: 'No Customers' },
    { key: 'crm.appointments',              locale: 'ar-EG', value: 'المواعيد' },
    { key: 'crm.appointments',              locale: 'ar-SA', value: 'المواعيد' },
    { key: 'crm.appointments',              locale: 'en',    value: 'Appointments' },
    { key: 'crm.createAppointment',         locale: 'ar-EG', value: 'إضافة موعد' },
    { key: 'crm.createAppointment',         locale: 'ar-SA', value: 'إضافة موعد' },
    { key: 'crm.createAppointment',         locale: 'en',    value: 'New Appointment' },
    { key: 'crm.customer',                  locale: 'ar-EG', value: 'العميل' },
    { key: 'crm.customer',                  locale: 'ar-SA', value: 'العميل' },
    { key: 'crm.customer',                  locale: 'en',    value: 'Customer' },
    { key: 'crm.scheduledAt',               locale: 'ar-EG', value: 'موعد الزيارة' },
    { key: 'crm.scheduledAt',               locale: 'ar-SA', value: 'موعد الزيارة' },
    { key: 'crm.scheduledAt',               locale: 'en',    value: 'Scheduled At' },
    { key: 'crm.note',                      locale: 'ar-EG', value: 'ملاحظات' },
    { key: 'crm.note',                      locale: 'ar-SA', value: 'ملاحظات' },
    { key: 'crm.note',                      locale: 'en',    value: 'Note' },
    { key: 'crm.status',                    locale: 'ar-EG', value: 'الحالة' },
    { key: 'crm.status',                    locale: 'ar-SA', value: 'الحالة' },
    { key: 'crm.status',                    locale: 'en',    value: 'Status' },
    { key: 'crm.scheduled',                 locale: 'ar-EG', value: 'مجدول' },
    { key: 'crm.scheduled',                 locale: 'ar-SA', value: 'مجدول' },
    { key: 'crm.scheduled',                 locale: 'en',    value: 'Scheduled' },
    { key: 'crm.completed',                 locale: 'ar-EG', value: 'مكتمل' },
    { key: 'crm.completed',                 locale: 'ar-SA', value: 'مكتمل' },
    { key: 'crm.completed',                 locale: 'en',    value: 'Completed' },
    { key: 'crm.cancelled',                 locale: 'ar-EG', value: 'ملغي' },
    { key: 'crm.cancelled',                 locale: 'ar-SA', value: 'ملغي' },
    { key: 'crm.cancelled',                 locale: 'en',    value: 'Cancelled' },
    { key: 'crm.noShow',                    locale: 'ar-EG', value: 'لم يحضر' },
    { key: 'crm.noShow',                    locale: 'ar-SA', value: 'لم يحضر' },
    { key: 'crm.noShow',                    locale: 'en',    value: 'No Show' },
    { key: 'crm.noAppointments',            locale: 'ar-EG', value: 'لا توجد مواعيد' },
    { key: 'crm.noAppointments',            locale: 'ar-SA', value: 'لا توجد مواعيد' },
    { key: 'crm.noAppointments',            locale: 'en',    value: 'No Appointments' },
    { key: 'crm.complete',                  locale: 'ar-EG', value: 'إتمام' },
    { key: 'crm.complete',                  locale: 'ar-SA', value: 'إتمام' },
    { key: 'crm.complete',                  locale: 'en',    value: 'Complete' },
    { key: 'crm.cancel',                    locale: 'ar-EG', value: 'إلغاء' },
    { key: 'crm.cancel',                    locale: 'ar-SA', value: 'إلغاء' },
    { key: 'crm.cancel',                    locale: 'en',    value: 'Cancel' },
    { key: 'crm.markNoShow',                locale: 'ar-EG', value: 'تحديد كلم يحضر' },
    { key: 'crm.markNoShow',                locale: 'ar-SA', value: 'تحديد كلم يحضر' },
    { key: 'crm.markNoShow',                locale: 'en',    value: 'Mark No Show' },
    { key: 'crm.activityLog',               locale: 'ar-EG', value: 'سجل النشاط' },
    { key: 'crm.activityLog',               locale: 'ar-SA', value: 'سجل النشاط' },
    { key: 'crm.activityLog',               locale: 'en',    value: 'Activity Log' },
    { key: 'crm.recentActivities',          locale: 'ar-EG', value: 'أحدث الأنشطة' },
    { key: 'crm.recentActivities',          locale: 'ar-SA', value: 'أحدث الأنشطة' },
    { key: 'crm.recentActivities',          locale: 'en',    value: 'Recent Activities' },
    { key: 'crm.noActivities',              locale: 'ar-EG', value: 'لا توجد أنشطة' },
    { key: 'crm.noActivities',              locale: 'ar-SA', value: 'لا توجد أنشطة' },
    { key: 'crm.noActivities',              locale: 'en',    value: 'No Activities' },
    { key: 'crm.type',                      locale: 'ar-EG', value: 'النوع' },
    { key: 'crm.type',                      locale: 'ar-SA', value: 'النوع' },
    { key: 'crm.type',                      locale: 'en',    value: 'Type' },
    { key: 'crm.appointmentCreated',        locale: 'ar-EG', value: 'تم إنشاء الموعد' },
    { key: 'crm.appointmentCreated',        locale: 'ar-SA', value: 'تم إنشاء الموعد' },
    { key: 'crm.appointmentCreated',        locale: 'en',    value: 'Appointment Created' },
    { key: 'crm.appointmentStatusChanged',  locale: 'ar-EG', value: 'تم تحديث حالة الموعد' },
    { key: 'crm.appointmentStatusChanged',  locale: 'ar-SA', value: 'تم تحديث حالة الموعد' },
    { key: 'crm.appointmentStatusChanged',  locale: 'en',    value: 'Appointment Status Changed' },
    { key: 'crm.activityType',              locale: 'ar-EG', value: 'نوع النشاط' },
    { key: 'crm.activityType',              locale: 'ar-SA', value: 'نوع النشاط' },
    { key: 'crm.activityType',              locale: 'en',    value: 'Activity Type' },

    // Phase 4: account nameKey translations (Manufacturing & HR/Payroll)
    { key: 'account.rawMaterials',        locale: 'ar-EG', value: 'المواد الخام' },
    { key: 'account.rawMaterials',        locale: 'ar-SA', value: 'المواد الخام' },
    { key: 'account.rawMaterials',        locale: 'en',    value: 'Raw Materials' },
    { key: 'account.finishedGoods',       locale: 'ar-EG', value: 'المنتجات التامة' },
    { key: 'account.finishedGoods',       locale: 'ar-SA', value: 'المنتجات التامة' },
    { key: 'account.finishedGoods',       locale: 'en',    value: 'Finished Goods' },
    { key: 'account.directLabor',         locale: 'ar-EG', value: 'العمالة المباشرة' },
    { key: 'account.directLabor',         locale: 'ar-SA', value: 'العمالة المباشرة' },
    { key: 'account.directLabor',         locale: 'en',    value: 'Direct Labor' },
    { key: 'account.salariesExpense',     locale: 'ar-EG', value: 'مصروف الرواتب' },
    { key: 'account.salariesExpense',     locale: 'ar-SA', value: 'مصروف الرواتب' },
    { key: 'account.salariesExpense',     locale: 'en',    value: 'Salaries Expense' },
    { key: 'account.payrollPayable',      locale: 'ar-EG', value: 'رواتب مستحقة الدفع' },
    { key: 'account.payrollPayable',      locale: 'ar-SA', value: 'رواتب مستحقة الدفع' },
    { key: 'account.payrollPayable',      locale: 'en',    value: 'Payroll Payable' },
    { key: 'account.employeeInsurance',   locale: 'ar-EG', value: 'تأمين الموظفين المستحق' },
    { key: 'account.employeeInsurance',   locale: 'ar-SA', value: 'تأمين الموظفين المستحق' },
    { key: 'account.employeeInsurance',   locale: 'en',    value: 'Employee Insurance Payable' },
    { key: 'account.employerInsurance',   locale: 'ar-EG', value: 'تأمين صاحب العمل المستحق' },
    { key: 'account.employerInsurance',   locale: 'ar-SA', value: 'تأمين صاحب العمل المستحق' },
    { key: 'account.employerInsurance',   locale: 'en',    value: 'Employer Insurance Payable' },
    { key: 'account.incomeTaxPayable',    locale: 'ar-EG', value: 'ضريبة الدخل المستحقة' },
    { key: 'account.incomeTaxPayable',    locale: 'ar-SA', value: 'ضريبة الدخل المستحقة' },
    { key: 'account.incomeTaxPayable',    locale: 'en',    value: 'Income Tax Payable' },

    // Phase 4: Manufacturing sample product names
    { key: 'product.mfgChair',            locale: 'ar-EG', value: 'كرسي' },
    { key: 'product.mfgChair',            locale: 'ar-SA', value: 'كرسي' },
    { key: 'product.mfgChair',            locale: 'en',    value: 'Chair' },
    { key: 'product.mfgFabric',           locale: 'ar-EG', value: 'قماش' },
    { key: 'product.mfgFabric',           locale: 'ar-SA', value: 'قماش' },
    { key: 'product.mfgFabric',           locale: 'en',    value: 'Fabric' },
    { key: 'product.mfgLeg',              locale: 'ar-EG', value: 'أرجل الكرسي' },
    { key: 'product.mfgLeg',              locale: 'ar-SA', value: 'أرجل الكرسي' },
    { key: 'product.mfgLeg',              locale: 'en',    value: 'Chair Leg' },

    // ============================================================
    // Phase 7: Branding & Business Templates
    // ============================================================

    // Nav
    { key: 'nav.branding',                locale: 'ar-EG', value: 'الهوية البصرية' },
    { key: 'nav.branding',                locale: 'ar-SA', value: 'الهوية البصرية' },
    { key: 'nav.branding',                locale: 'en',    value: 'Branding' },

    // Branding panel
    { key: 'branding.title',              locale: 'ar-EG', value: 'إعدادات الهوية البصرية' },
    { key: 'branding.title',              locale: 'ar-SA', value: 'إعدادات الهوية البصرية' },
    { key: 'branding.title',              locale: 'en',    value: 'Branding Settings' },
    { key: 'branding.logoUrl',            locale: 'ar-EG', value: 'رابط الشعار' },
    { key: 'branding.logoUrl',            locale: 'ar-SA', value: 'رابط الشعار' },
    { key: 'branding.logoUrl',            locale: 'en',    value: 'Logo URL' },
    { key: 'branding.primaryColor',       locale: 'ar-EG', value: 'اللون الأساسي' },
    { key: 'branding.primaryColor',       locale: 'ar-SA', value: 'اللون الأساسي' },
    { key: 'branding.primaryColor',       locale: 'en',    value: 'Primary Color' },
    { key: 'branding.accentColor',        locale: 'ar-EG', value: 'اللون المميز' },
    { key: 'branding.accentColor',        locale: 'ar-SA', value: 'اللون المميز' },
    { key: 'branding.accentColor',        locale: 'en',    value: 'Accent Color' },
    { key: 'branding.invoiceFooterText',  locale: 'ar-EG', value: 'نص أسفل الفاتورة' },
    { key: 'branding.invoiceFooterText',  locale: 'ar-SA', value: 'نص أسفل الفاتورة' },
    { key: 'branding.invoiceFooterText',  locale: 'en',    value: 'Invoice Footer Text' },
    { key: 'branding.preview',            locale: 'ar-EG', value: 'معاينة' },
    { key: 'branding.preview',            locale: 'ar-SA', value: 'معاينة' },
    { key: 'branding.preview',            locale: 'en',    value: 'Live Preview' },
    { key: 'branding.save',               locale: 'ar-EG', value: 'حفظ' },
    { key: 'branding.save',               locale: 'ar-SA', value: 'حفظ' },
    { key: 'branding.save',               locale: 'en',    value: 'Save' },
    { key: 'branding.saved',              locale: 'ar-EG', value: 'تم حفظ الهوية البصرية بنجاح' },
    { key: 'branding.saved',              locale: 'ar-SA', value: 'تم حفظ الهوية البصرية بنجاح' },
    { key: 'branding.saved',              locale: 'en',    value: 'Branding saved successfully' },
    { key: 'branding.businessType',       locale: 'ar-EG', value: 'نوع النشاط' },
    { key: 'branding.businessType',       locale: 'ar-SA', value: 'نوع النشاط' },
    { key: 'branding.businessType',       locale: 'en',    value: 'Business Type' },

    // Business type labels
    { key: 'branding.general',            locale: 'ar-EG', value: 'عام' },
    { key: 'branding.general',            locale: 'ar-SA', value: 'عام' },
    { key: 'branding.general',            locale: 'en',    value: 'General' },
    { key: 'branding.retail',             locale: 'ar-EG', value: 'تجارة تجزئة' },
    { key: 'branding.retail',             locale: 'ar-SA', value: 'تجارة تجزئة' },
    { key: 'branding.retail',             locale: 'en',    value: 'Retail' },
    { key: 'branding.restaurant',         locale: 'ar-EG', value: 'مطعم' },
    { key: 'branding.restaurant',         locale: 'ar-SA', value: 'مطعم' },
    { key: 'branding.restaurant',         locale: 'en',    value: 'Restaurant' },
    { key: 'branding.clinic',             locale: 'ar-EG', value: 'عيادة' },
    { key: 'branding.clinic',             locale: 'ar-SA', value: 'عيادة' },
    { key: 'branding.clinic',             locale: 'en',    value: 'Clinic' },
    { key: 'branding.services',           locale: 'ar-EG', value: 'خدمات' },
    { key: 'branding.services',           locale: 'ar-SA', value: 'خدمات' },
    { key: 'branding.services',           locale: 'en',    value: 'Services' },
    { key: 'branding.manufacturing',      locale: 'ar-EG', value: 'تصنيع' },
    { key: 'branding.manufacturing',      locale: 'ar-SA', value: 'تصنيع' },
    { key: 'branding.manufacturing',      locale: 'en',    value: 'Manufacturing' },

    // Phase 7: business-type seed account nameKeys
    { key: 'account.salesDiscounts',      locale: 'ar-EG', value: 'خصومات المبيعات' },
    { key: 'account.salesDiscounts',      locale: 'ar-SA', value: 'خصومات المبيعات' },
    { key: 'account.salesDiscounts',      locale: 'en',    value: 'Sales Discounts' },
    { key: 'account.kitchenWaste',        locale: 'ar-EG', value: 'هالك المطبخ' },
    { key: 'account.kitchenWaste',        locale: 'ar-SA', value: 'هالك المطبخ' },
    { key: 'account.kitchenWaste',        locale: 'en',    value: 'Kitchen Waste' },
    { key: 'account.consultationFees',    locale: 'ar-EG', value: 'رسوم استشارة' },
    { key: 'account.consultationFees',    locale: 'ar-SA', value: 'رسوم استشارة' },
    { key: 'account.consultationFees',    locale: 'en',    value: 'Consultation Fees' },

    // ---------- Phase 8: SaaS Billing & Subscriptions ----------
    { key: 'nav.billing',                 locale: 'ar-EG', value: 'الفوترة والاشتراكات' },
    { key: 'nav.billing',                 locale: 'ar-SA', value: 'الفوترة والاشتراكات' },
    { key: 'nav.billing',                 locale: 'en',    value: 'Billing' },

    { key: 'billing.title',               locale: 'ar-EG', value: 'إدارة الاشتراكات' },
    { key: 'billing.title',               locale: 'ar-SA', value: 'إدارة الاشتراكات' },
    { key: 'billing.title',               locale: 'en',    value: 'Subscriptions Management' },

    { key: 'billing.tenants',             locale: 'ar-EG', value: 'العملاء' },
    { key: 'billing.tenants',             locale: 'ar-SA', value: 'العملاء' },
    { key: 'billing.tenants',             locale: 'en',    value: 'Tenants' },

    { key: 'billing.plans',               locale: 'ar-EG', value: 'الخطط' },
    { key: 'billing.plans',               locale: 'ar-SA', value: 'الخطط' },
    { key: 'billing.plans',               locale: 'en',    value: 'Plans' },

    { key: 'billing.recordPayment',       locale: 'ar-EG', value: 'تسجيل دفعة' },
    { key: 'billing.recordPayment',       locale: 'ar-SA', value: 'تسجيل دفعة' },
    { key: 'billing.recordPayment',       locale: 'en',    value: 'Record Payment' },

    { key: 'billing.amount',              locale: 'ar-EG', value: 'المبلغ' },
    { key: 'billing.amount',              locale: 'ar-SA', value: 'المبلغ' },
    { key: 'billing.amount',              locale: 'en',    value: 'Amount' },

    { key: 'billing.method',              locale: 'ar-EG', value: 'طريقة الدفع' },
    { key: 'billing.method',              locale: 'ar-SA', value: 'طريقة الدفع' },
    { key: 'billing.method',              locale: 'en',    value: 'Method' },

    { key: 'billing.bankTransfer',        locale: 'ar-EG', value: 'تحويل بنكي' },
    { key: 'billing.bankTransfer',        locale: 'ar-SA', value: 'تحويل بنكي' },
    { key: 'billing.bankTransfer',        locale: 'en',    value: 'Bank Transfer' },

    { key: 'billing.instapay',            locale: 'ar-EG', value: 'إنستا باي' },
    { key: 'billing.instapay',            locale: 'ar-SA', value: 'إنستا باي' },
    { key: 'billing.instapay',            locale: 'en',    value: 'InstaPay' },

    { key: 'billing.cash',                locale: 'ar-EG', value: 'نقدًا' },
    { key: 'billing.cash',                locale: 'ar-SA', value: 'نقدًا' },
    { key: 'billing.cash',                locale: 'en',    value: 'Cash' },

    { key: 'billing.vodafoneCash',        locale: 'ar-EG', value: 'فودافون كاش' },
    { key: 'billing.vodafoneCash',        locale: 'ar-SA', value: 'فودافون كاش' },
    { key: 'billing.vodafoneCash',        locale: 'en',    value: 'Vodafone Cash' },

    { key: 'billing.currentPeriodEnd',    locale: 'ar-EG', value: 'نهاية الفترة الحالية' },
    { key: 'billing.currentPeriodEnd',    locale: 'ar-SA', value: 'نهاية الفترة الحالية' },
    { key: 'billing.currentPeriodEnd',    locale: 'en',    value: 'Current Period End' },

    { key: 'billing.trialEndsAt',         locale: 'ar-EG', value: 'نهاية الفترة التجريبية' },
    { key: 'billing.trialEndsAt',         locale: 'ar-SA', value: 'نهاية الفترة التجريبية' },
    { key: 'billing.trialEndsAt',         locale: 'en',    value: 'Trial Ends At' },

    { key: 'billing.status',              locale: 'ar-EG', value: 'الحالة' },
    { key: 'billing.status',              locale: 'ar-SA', value: 'الحالة' },
    { key: 'billing.status',              locale: 'en',    value: 'Status' },

    { key: 'billing.trialing',            locale: 'ar-EG', value: 'تجريبي' },
    { key: 'billing.trialing',            locale: 'ar-SA', value: 'تجريبي' },
    { key: 'billing.trialing',            locale: 'en',    value: 'Trialing' },

    { key: 'billing.active',              locale: 'ar-EG', value: 'فعّال' },
    { key: 'billing.active',              locale: 'ar-SA', value: 'فعّال' },
    { key: 'billing.active',              locale: 'en',    value: 'Active' },

    { key: 'billing.pastdue',             locale: 'ar-EG', value: 'متأخر' },
    { key: 'billing.pastdue',             locale: 'ar-SA', value: 'متأخر' },
    { key: 'billing.pastdue',             locale: 'en',    value: 'Past Due' },

    { key: 'billing.suspended',           locale: 'ar-EG', value: 'معلّق' },
    { key: 'billing.suspended',           locale: 'ar-SA', value: 'معلّق' },
    { key: 'billing.suspended',           locale: 'en',    value: 'Suspended' },

    { key: 'billing.cancelled',           locale: 'ar-EG', value: 'ملغى' },
    { key: 'billing.cancelled',           locale: 'ar-SA', value: 'ملغى' },
    { key: 'billing.cancelled',           locale: 'en',    value: 'Cancelled' },

    { key: 'billing.subscriptionSuspended', locale: 'ar-EG', value: 'الاشتراك معلّق أو ملغى — يرجى التواصل لإعادة التفعيل' },
    { key: 'billing.subscriptionSuspended', locale: 'ar-SA', value: 'الاشتراك معلّق أو ملغى — يرجى التواصل لإعادة التفعيل' },
    { key: 'billing.subscriptionSuspended', locale: 'en',    value: 'Subscription suspended or cancelled — please contact support to reactivate' },

    { key: 'billing.maxUsers',            locale: 'ar-EG', value: 'الحد الأقصى للمستخدمين' },
    { key: 'billing.maxUsers',            locale: 'ar-SA', value: 'الحد الأقصى للمستخدمين' },
    { key: 'billing.maxUsers',            locale: 'en',    value: 'Max Users' },

    { key: 'billing.maxInvoicesPerMonth', locale: 'ar-EG', value: 'الحد الأقصى للفواتير شهريًا' },
    { key: 'billing.maxInvoicesPerMonth', locale: 'ar-SA', value: 'الحد الأقصى للفواتير شهريًا' },
    { key: 'billing.maxInvoicesPerMonth', locale: 'en',    value: 'Max Invoices / Month' },

    { key: 'billing.monthlyPrice',        locale: 'ar-EG', value: 'شهريًا' },
    { key: 'billing.monthlyPrice',        locale: 'ar-SA', value: 'شهريًا' },
    { key: 'billing.monthlyPrice',        locale: 'en',    value: 'monthly' },

    { key: 'billing.noTenants',           locale: 'ar-EG', value: 'لا يوجد عملاء' },
    { key: 'billing.noTenants',           locale: 'ar-SA', value: 'لا يوجد عملاء' },
    { key: 'billing.noTenants',           locale: 'en',    value: 'No tenants' },

    { key: 'billing.paymentRecorded',     locale: 'ar-EG', value: 'تم تسجيل الدفعة وتمديد فترة الاشتراك' },
    { key: 'billing.paymentRecorded',     locale: 'ar-SA', value: 'تم تسجيل الدفعة وتمديد فترة الاشتراك' },
    { key: 'billing.paymentRecorded',     locale: 'en',    value: 'Payment recorded and subscription extended' },

    { key: 'billing.accessDenied',        locale: 'ar-EG', value: 'هذه الصفحة لمالك المنصة فقط' },
    { key: 'billing.accessDenied',        locale: 'ar-SA', value: 'هذه الصفحة لمالك المنصة فقط' },
    { key: 'billing.accessDenied',        locale: 'en',    value: 'Platform admin access required' },

    { key: 'plan.starter',                locale: 'ar-EG', value: 'البداية' },
    { key: 'plan.starter',                locale: 'ar-SA', value: 'البداية' },
    { key: 'plan.starter',                locale: 'en',    value: 'Starter' },

    { key: 'plan.pro',                    locale: 'ar-EG', value: 'الاحترافية' },
    { key: 'plan.pro',                    locale: 'ar-SA', value: 'الاحترافية' },
    { key: 'plan.pro',                    locale: 'en',    value: 'Professional' },

    { key: 'plan.enterprise',             locale: 'ar-EG', value: 'المؤسسات' },
    { key: 'plan.enterprise',             locale: 'ar-SA', value: 'المؤسسات' },
    { key: 'plan.enterprise',             locale: 'en',    value: 'Enterprise' },

    // ---------- Phase 9: Industry Activation (Module Activation) ----------
    { key: 'nav.modules',                 locale: 'ar-EG', value: 'الموديولات' },
    { key: 'nav.modules',                 locale: 'ar-SA', value: 'الموديولات' },
    { key: 'nav.modules',                 locale: 'en',    value: 'Modules' },

    { key: 'modules.title',               locale: 'ar-EG', value: 'تفعيل الموديولات' },
    { key: 'modules.title',               locale: 'ar-SA', value: 'تفعيل الموديولات' },
    { key: 'modules.title',               locale: 'en',    value: 'Module Activation' },

    { key: 'modules.description',         locale: 'ar-EG', value: 'تحكم في الموديولات الظاهرة في القائمة حسب نوع النشاط' },
    { key: 'modules.description',         locale: 'ar-SA', value: 'تحكم في الموديولات الظاهرة في القائمة حسب نوع النشاط' },
    { key: 'modules.description',         locale: 'en',    value: 'Control which modules appear in the navigation based on business type' },

    { key: 'modules.businessType',        locale: 'ar-EG', value: 'نوع النشاط' },
    { key: 'modules.businessType',        locale: 'ar-SA', value: 'نوع النشاط' },
    { key: 'modules.businessType',        locale: 'en',    value: 'Business Type' },

    { key: 'modules.activeModules',       locale: 'ar-EG', value: 'الموديولات المفعّلة' },
    { key: 'modules.activeModules',       locale: 'ar-SA', value: 'الموديولات المفعّلة' },
    { key: 'modules.activeModules',       locale: 'en',    value: 'Active Modules' },

    { key: 'modules.save',                locale: 'ar-EG', value: 'حفظ' },
    { key: 'modules.save',                locale: 'ar-SA', value: 'حفظ' },
    { key: 'modules.save',                locale: 'en',    value: 'Save' },

    { key: 'modules.saved',               locale: 'ar-EG', value: 'تم حفظ إعدادات الموديولات بنجاح' },
    { key: 'modules.saved',               locale: 'ar-SA', value: 'تم حفظ إعدادات الموديولات بنجاح' },
    { key: 'modules.saved',               locale: 'en',    value: 'Module settings saved successfully' },

    { key: 'modules.enable',              locale: 'ar-EG', value: 'تفعيل' },
    { key: 'modules.enable',              locale: 'ar-SA', value: 'تفعيل' },
    { key: 'modules.enable',              locale: 'en',    value: 'Enable' },

    { key: 'modules.disable',             locale: 'ar-EG', value: 'تعطيل' },
    { key: 'modules.disable',             locale: 'ar-SA', value: 'تعطيل' },
    { key: 'modules.disable',             locale: 'en',    value: 'Disable' },

    { key: 'modules.default',             locale: 'ar-EG', value: 'افتراضي' },
    { key: 'modules.default',             locale: 'ar-SA', value: 'افتراضي' },
    { key: 'modules.default',             locale: 'en',    value: 'Default' },

    { key: 'modules.modulesNote',         locale: 'ar-EG', value: 'هذه الإعدادات تتحكم فيما يظهر في القائمة فقط. جميع الواجهات البرمجية تظل تعمل بغض النظر عن هذه الإعدادات.' },
    { key: 'modules.modulesNote',         locale: 'ar-SA', value: 'هذه الإعدادات تتحكم فيما يظهر في القائمة فقط. جميع الواجهات البرمجية تظل تعمل بغض النظر عن هذه الإعدادات.' },
    { key: 'modules.modulesNote',         locale: 'en',    value: 'These settings control what appears in the navigation only. All APIs remain functional regardless of these settings.' },
  ]

  console.log(`[step] bulk-loading ${translations.length} translations...`)
  // Bulk approach: delete all existing translations then createMany in batches.
  // This is 100x faster than 999 individual upserts on Supabase pgbouncer.
  await prisma.translation.deleteMany({})
  console.log('[step] translations cleared')
  for (let i = 0; i < translations.length; i += 200) {
    const chunk = translations.slice(i, i + 200)
    await prisma.translation.createMany({ data: chunk, skipDuplicates: true })
    console.log(`[step] translations ${Math.min(i + 200, translations.length)}/${translations.length}...`)
  }

  console.log('✓ Seed complete.')
  console.log('  Tenants:', tenants.map((t) => `${t.id} (${t.name})`).join(', '))
  console.log('  Roles:', Object.keys(roles).join(', '))
  console.log('  Demo password for all users: password123')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
