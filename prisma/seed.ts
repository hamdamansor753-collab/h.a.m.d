/**
 * H.A.M.D ERP — Seed
 *
 * Creates:
 *  - 5 roles: admin, accountant, hr_manager, cashier, viewer (with permissions)
 *  - 2 tenants (Tenant A "شركة الأفق", Tenant B "شركة النور") so we can
 *    DEMONSTRATE cross-tenant isolation in the test endpoint.
 *  - For each tenant: admin / accountant / hr / cashier / viewer users (password = "password123")
 *  - A starter chart of accounts per tenant (different codes per tenant to
 *    make the isolation test visually obvious).
 *  - UI translations for ar-EG, ar-SA, en.
 *
 * Run with: `bun run db:seed`
 */
import { PrismaClient, AccountType } from '@prisma/client'
import bcrypt from 'bcryptjs'

// Load .env manually (bun run doesn't auto-load for scripts)
import { readFileSync } from 'fs'
try {
  const envFile = readFileSync('.env', 'utf8')
  for (const line of envFile.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim()
    }
  }
} catch { /* .env not found — use existing env */ }

// Use DIRECT_URL for seeding (session mode, no pgbouncer)
if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL
}

const prisma = new PrismaClient()

async function main() {
  console.log('→ Seeding H.A.M.D ERP core data...')

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
    // Phase 4: HR + payroll
    'hr:read',
    'hr:manage',
    'hr:salary:read',
    'payroll:run',
    // Phase 5: CRM
    'crm:read',
    'crm:manage',
    // Phase 7: Branding
    'tenant:manage',
    // Phase 8: SaaS platform admin (separate from tenant RBAC)
    'platform:admin',
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
        'hr:read', 'hr:manage', 'hr:salary:read', 'payroll:run',
        'crm:read', 'crm:manage',
        'tenant:manage',
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
        'hr:read', 'hr:salary:read',
        'crm:read',
      ],
    },
    {
      name: 'hr_manager',
      perms: ['hr:read', 'hr:manage', 'hr:salary:read', 'payroll:run'],
    },
    {
      name: 'cashier',
      perms: ['pos:sell', 'invoice:read', 'inventory:read', 'crm:read'],
    },
    {
      name: 'viewer',
      perms: ['account:read', 'journal:read', 'invoice:read', 'inventory:read', 'hr:read', 'crm:read'],
    },
    {
      name: 'super_admin',
      perms: ['platform:admin'],
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

  // ---------- 4. Users ----------
  const passwordHash = await bcrypt.hash('password123', 10)
  const userDefs = [
    { email: 'admin@afak.test',     name: 'مدير الأفق',   tenantId: 'tenant-afak', role: 'admin' },
    { email: 'accountant@afak.test',name: 'محاسب الأفق',  tenantId: 'tenant-afak', role: 'accountant' },
    { email: 'hr@afak.test',        name: 'مدير موارد بشرية', tenantId: 'tenant-afak', role: 'hr_manager' },
    { email: 'cashier@afak.test',   name: 'كاشير الأفق',  tenantId: 'tenant-afak', role: 'cashier' },
    { email: 'viewer@afak.test',    name: 'مشاهد الأفق',  tenantId: 'tenant-afak', role: 'viewer' },
    { email: 'admin@noor.test',     name: 'مدير النور',   tenantId: 'tenant-noor', role: 'admin' },
    { email: 'accountant@noor.test',name: 'محاسب النور',  tenantId: 'tenant-noor', role: 'accountant' },
    // Phase 8: super-admin (platform owner) — not tied to a specific tenant
    // but needs a tenant for auth. Uses tenant-afak as a base.
    { email: 'superadmin@hamd.test', name: 'مالك المنصة',  tenantId: 'tenant-afak', role: 'super_admin' },
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

  // ---------- 5. Chart of Accounts ----------
  // Different codes per tenant to make isolation visually obvious in the test.
  const afakAccounts = [
    { code: '1000', nameKey: 'account.assets',    type: AccountType.ASSET,     parentId: null },
    { code: '1001', nameKey: 'account.cash',      type: AccountType.ASSET,     parentCode: '1000' },
    { code: '1002', nameKey: 'account.bank',      type: AccountType.ASSET,     parentCode: '1000' },
    { code: '1003', nameKey: 'account.receivable', type: AccountType.ASSET,    parentCode: '1000' },
    { code: '1004', nameKey: 'account.inventory', type: AccountType.ASSET,     parentCode: '1000' },
    { code: '2000', nameKey: 'account.liabilities',type: AccountType.LIABILITY, parentId: null },
    { code: '2001', nameKey: 'account.salesTax',  type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '2002', nameKey: 'account.payable',   type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '2003', nameKey: 'account.payrollPayable', type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '2004', nameKey: 'account.payrollTax',type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '2005', nameKey: 'account.socialInsurance', type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '3000', nameKey: 'account.equity',    type: AccountType.EQUITY,    parentId: null },
    { code: '4000', nameKey: 'account.revenue',   type: AccountType.REVENUE,   parentId: null },
    { code: '5000', nameKey: 'account.expense',   type: AccountType.EXPENSE,   parentId: null },
    { code: '5001', nameKey: 'account.cogs',      type: AccountType.EXPENSE,   parentCode: '5000' },
    { code: '5002', nameKey: 'account.salaries',  type: AccountType.EXPENSE,   parentCode: '5000' },
  ]
  const noorAccounts = [
    { code: '1100', nameKey: 'account.assets',    type: AccountType.ASSET,     parentId: null },
    { code: '1101', nameKey: 'account.cash',      type: AccountType.ASSET,     parentCode: '1100' },
    { code: '1102', nameKey: 'account.receivable', type: AccountType.ASSET,    parentCode: '1100' },
    { code: '1103', nameKey: 'account.inventory', type: AccountType.ASSET,     parentCode: '1100' },
    { code: '2100', nameKey: 'account.liabilities',type: AccountType.LIABILITY, parentId: null },
    { code: '2101', nameKey: 'account.salesTax',  type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '2102', nameKey: 'account.payable',   type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '2103', nameKey: 'account.payrollPayable', type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '2104', nameKey: 'account.payrollTax',type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '2105', nameKey: 'account.socialInsurance', type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '3100', nameKey: 'account.equity',    type: AccountType.EQUITY,    parentId: null },
    { code: '4100', nameKey: 'account.revenue',   type: AccountType.REVENUE,   parentId: null },
    { code: '5100', nameKey: 'account.expense',   type: AccountType.EXPENSE,   parentId: null },
    { code: '5101', nameKey: 'account.cogs',      type: AccountType.EXPENSE,   parentCode: '5100' },
    { code: '5102', nameKey: 'account.salaries',  type: AccountType.EXPENSE,   parentCode: '5100' },
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

  // ---------- 5c. Employees (Phase 4) ----------
  // Sample employees for tenant-afak (tenant-noor has none — to keep isolation tests simple)
  const afakEmployees = [
    { fullName: 'أحمد محمد علي',    nationalId: '29301010100001', hireDate: new Date('2023-01-15'), baseSalary: 12000 },
    { fullName: 'فاطمة حسن إبراهيم', nationalId: '29402020200002', hireDate: new Date('2023-03-01'), baseSalary: 8500 },
    { fullName: 'خالد سعيد عبد الله', nationalId: '29503030300003', hireDate: new Date('2023-06-10'), baseSalary: 15000 },
  ]
  for (const emp of afakEmployees) {
    // Use nationalId as a pseudo-unique key for upsert (nationalId is not unique in schema,
    // but we use it here just for seed idempotency within a tenant)
    const existing = await prisma.employee.findFirst({
      where: { tenantId: 'tenant-afak', nationalId: emp.nationalId },
    })
    if (!existing) {
      await prisma.employee.create({
        data: { tenantId: 'tenant-afak', ...emp },
      })
    } else {
      await prisma.employee.update({
        where: { id: existing.id },
        data: { fullName: emp.fullName, hireDate: emp.hireDate, baseSalary: emp.baseSalary },
      })
    }
  }

  // ---------- 5d. SaaS Plans & Subscriptions (Phase 8) ----------

  // Create the starter plan (default for all demo tenants)
  const starterPlan = await prisma.plan.upsert({
    where: { key: 'starter' },
    update: {},
    create: {
      key: 'starter',
      nameKey: 'plan.starter',
      monthlyPrice: 500,
      maxUsers: 10,
      maxInvoicesPerMonth: 200,
    },
  })

  // Create ACTIVE subscriptions for existing demo tenants (so tests pass
  // without subscription enforcement blocking them)
  for (const tenantId of ['tenant-afak', 'tenant-noor']) {
    const existingSub = await prisma.subscription.findUnique({ where: { tenantId } })
    if (!existingSub) {
      await prisma.subscription.create({
        data: {
          tenantId,
          planId: starterPlan.id,
          status: 'ACTIVE',
          currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          trialEndsAt: null,
        },
      })
    } else {
      // Ensure existing subs are ACTIVE for testing
      await prisma.subscription.update({
        where: { tenantId },
        data: { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
      })
    }
  }
  console.log('  SaaS: starter plan + 2 ACTIVE subscriptions created')

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

    // HR & Payroll (Phase 4)
    { key: 'nav.hr',             locale: 'ar-EG', value: 'الموارد البشرية' },
    { key: 'nav.hr',             locale: 'ar-SA', value: 'الموارد البشرية' },
    { key: 'nav.hr',             locale: 'en',    value: 'Human Resources' },
    { key: 'nav.payroll',        locale: 'ar-EG', value: 'الرواتب' },
    { key: 'nav.payroll',        locale: 'ar-SA', value: 'الرواتب' },
    { key: 'nav.payroll',        locale: 'en',    value: 'Payroll' },
    { key: 'hr.title',           locale: 'ar-EG', value: 'الموظفون' },
    { key: 'hr.title',           locale: 'ar-SA', value: 'الموظفون' },
    { key: 'hr.title',           locale: 'en',    value: 'Employees' },
    { key: 'hr.fullName',        locale: 'ar-EG', value: 'الاسم الكامل' },
    { key: 'hr.fullName',        locale: 'ar-SA', value: 'الاسم الكامل' },
    { key: 'hr.fullName',        locale: 'en',    value: 'Full Name' },
    { key: 'hr.hireDate',        locale: 'ar-EG', value: 'تاريخ التعيين' },
    { key: 'hr.hireDate',        locale: 'ar-SA', value: 'تاريخ التعيين' },
    { key: 'hr.hireDate',        locale: 'en',    value: 'Hire Date' },
    { key: 'hr.baseSalary',      locale: 'ar-EG', value: 'الراتب الأساسي' },
    { key: 'hr.baseSalary',      locale: 'ar-SA', value: 'الراتب الأساسي' },
    { key: 'hr.baseSalary',      locale: 'en',    value: 'Base Salary' },
    { key: 'hr.status',          locale: 'ar-EG', value: 'الحالة' },
    { key: 'hr.status',          locale: 'ar-SA', value: 'الحالة' },
    { key: 'hr.status',          locale: 'en',    value: 'Status' },
    { key: 'hr.createEmployee',  locale: 'ar-EG', value: 'موظف جديد' },
    { key: 'hr.createEmployee',  locale: 'ar-SA', value: 'موظف جديد' },
    { key: 'hr.createEmployee',  locale: 'en',    value: 'New Employee' },
    { key: 'hr.empty',           locale: 'ar-EG', value: 'لا يوجد موظفون' },
    { key: 'hr.empty',           locale: 'ar-SA', value: 'لا يوجد موظفون' },
    { key: 'hr.empty',           locale: 'en',    value: 'No employees' },
    { key: 'hr.configError',     locale: 'ar-EG', value: 'خطأ في إعداد حسابات الرواتب' },
    { key: 'hr.configError',     locale: 'ar-SA', value: 'خطأ في إعداد حسابات الرواتب' },
    { key: 'hr.configError',     locale: 'en',    value: 'Payroll accounts not configured' },
    { key: 'hr.salaryHidden',    locale: 'ar-EG', value: 'مخفي (لا تملك صلاحية)' },
    { key: 'hr.salaryHidden',    locale: 'ar-SA', value: 'مخفي (لا تملك صلاحية)' },
    { key: 'hr.salaryHidden',    locale: 'en',    value: 'Hidden (no permission)' },
    { key: 'hr.status.ACTIVE',    locale: 'ar-EG', value: 'نشط' },
    { key: 'hr.status.ACTIVE',    locale: 'ar-SA', value: 'نشط' },
    { key: 'hr.status.ACTIVE',    locale: 'en',    value: 'Active' },
    { key: 'hr.status.SUSPENDED', locale: 'ar-EG', value: 'موقوف' },
    { key: 'hr.status.SUSPENDED', locale: 'ar-SA', value: 'موقوف' },
    { key: 'hr.status.SUSPENDED', locale: 'en',    value: 'Suspended' },
    { key: 'hr.status.TERMINATED',locale: 'ar-EG', value: 'منتهي' },
    { key: 'hr.status.TERMINATED',locale: 'ar-SA', value: 'منتهي' },
    { key: 'hr.status.TERMINATED',locale: 'en',    value: 'Terminated' },

    // Payroll
    { key: 'payroll.title',      locale: 'ar-EG', value: 'تشغيل الرواتب' },
    { key: 'payroll.title',      locale: 'ar-SA', value: 'تشغيل الرواتب' },
    { key: 'payroll.title',      locale: 'en',    value: 'Payroll Runs' },
    { key: 'payroll.period',     locale: 'ar-EG', value: 'الفترة' },
    { key: 'payroll.period',     locale: 'ar-SA', value: 'الفترة' },
    { key: 'payroll.period',     locale: 'en',    value: 'Period' },
    { key: 'payroll.status',     locale: 'ar-EG', value: 'الحالة' },
    { key: 'payroll.status',     locale: 'ar-SA', value: 'الحالة' },
    { key: 'payroll.status',     locale: 'en',    value: 'Status' },
    { key: 'payroll.create',     locale: 'ar-EG', value: 'تشغيل رواتب شهر' },
    { key: 'payroll.create',     locale: 'ar-SA', value: 'تشغيل رواتب شهر' },
    { key: 'payroll.create',     locale: 'en',    value: 'Run Payroll' },
    { key: 'payroll.post',       locale: 'ar-EG', value: 'ترحيل' },
    { key: 'payroll.post',       locale: 'ar-SA', value: 'ترحيل' },
    { key: 'payroll.post',       locale: 'en',    value: 'Post' },
    { key: 'payroll.posted',     locale: 'ar-EG', value: 'تم ترحيل الرواتب بنجاح' },
    { key: 'payroll.posted',     locale: 'ar-SA', value: 'تم ترحيل الرواتب بنجاح' },
    { key: 'payroll.posted',     locale: 'en',    value: 'Payroll posted to ledger' },
    { key: 'payroll.empty',      locale: 'ar-EG', value: 'لا توجد تشغيلات رواتب' },
    { key: 'payroll.empty',      locale: 'ar-SA', value: 'لا توجد تشغيلات رواتب' },
    { key: 'payroll.empty',      locale: 'en',    value: 'No payroll runs' },
    { key: 'payroll.notFound',   locale: 'ar-EG', value: 'تشغيل الرواتب غير موجود' },
    { key: 'payroll.notFound',   locale: 'ar-SA', value: 'تشغيل الرواتب غير موجود' },
    { key: 'payroll.notFound',   locale: 'en',    value: 'Payroll run not found' },
    { key: 'payroll.cannotModify',locale: 'ar-EG', value: 'لا يمكن تعديل رواتب مرحّلة' },
    { key: 'payroll.cannotModify',locale: 'ar-SA', value: 'لا يمكن تعديل رواتب مرحّلة' },
    { key: 'payroll.cannotModify',locale: 'en',    value: 'Cannot modify a posted payroll run' },
    { key: 'payroll.status.DRAFT',  locale: 'ar-EG', value: 'مسودة' },
    { key: 'payroll.status.DRAFT',  locale: 'ar-SA', value: 'مسودة' },
    { key: 'payroll.status.DRAFT',  locale: 'en',    value: 'Draft' },
    { key: 'payroll.status.POSTED', locale: 'ar-EG', value: 'مرحّلة' },
    { key: 'payroll.status.POSTED', locale: 'ar-SA', value: 'مرحّلة' },
    { key: 'payroll.status.POSTED', locale: 'en',    value: 'Posted' },
    { key: 'payroll.employees',  locale: 'ar-EG', value: 'الموظفون' },
    { key: 'payroll.employees',  locale: 'ar-SA', value: 'الموظفون' },
    { key: 'payroll.employees',  locale: 'en',    value: 'Employees' },
    { key: 'payroll.grossTotal', locale: 'ar-EG', value: 'إجمالي الرواتب' },
    { key: 'payroll.grossTotal', locale: 'ar-SA', value: 'إجمالي الرواتب' },
    { key: 'payroll.grossTotal', locale: 'en',    value: 'Gross Total' },
    { key: 'payroll.netTotal',   locale: 'ar-EG', value: 'إجمالي الصافي' },
    { key: 'payroll.netTotal',   locale: 'ar-SA', value: 'إجمالي الصافي' },
    { key: 'payroll.netTotal',   locale: 'en',    value: 'Net Total' },
    { key: 'payroll.taxTotal',   locale: 'ar-EG', value: 'إجمالي الضريبة' },
    { key: 'payroll.taxTotal',   locale: 'ar-SA', value: 'إجمالي الضريبة' },
    { key: 'payroll.taxTotal',   locale: 'en',    value: 'Tax Total' },
    { key: 'payroll.insuranceTotal', locale: 'ar-EG', value: 'إجمالي التأمينات' },
    { key: 'payroll.insuranceTotal', locale: 'ar-SA', value: 'إجمالي التأمينات' },
    { key: 'payroll.insuranceTotal', locale: 'en',    value: 'Insurance Total' },
    { key: 'payroll.monthLabel', locale: 'ar-EG', value: 'الشهر (YYYY-MM)' },
    { key: 'payroll.monthLabel', locale: 'ar-SA', value: 'الشهر (YYYY-MM)' },
    { key: 'payroll.monthLabel', locale: 'en',    value: 'Month (YYYY-MM)' },

    // Payroll account names
    { key: 'account.salaries',        locale: 'ar-EG', value: 'مصروف الرواتب' },
    { key: 'account.salaries',        locale: 'ar-SA', value: 'مصروف الرواتب' },
    { key: 'account.salaries',        locale: 'en',    value: 'Salaries Expense' },
    { key: 'account.payrollPayable',  locale: 'ar-EG', value: 'رواتب مستحقة الدفع' },
    { key: 'account.payrollPayable',  locale: 'ar-SA', value: 'رواتب مستحقة الدفع' },
    { key: 'account.payrollPayable',  locale: 'en',    value: 'Payroll Payable' },
    { key: 'account.payrollTax',      locale: 'ar-EG', value: 'ضريبة دخل مستقطعة مستحقة' },
    { key: 'account.payrollTax',      locale: 'ar-SA', value: 'ضريبة دخل مستقطعة مستحقة' },
    { key: 'account.payrollTax',      locale: 'en',    value: 'Payroll Tax Payable' },
    { key: 'account.socialInsurance', locale: 'ar-EG', value: 'تأمينات اجتماعية مستحقة' },
    { key: 'account.socialInsurance', locale: 'ar-SA', value: 'تأمينات اجتماعية مستحقة' },
    { key: 'account.socialInsurance', locale: 'en',    value: 'Social Insurance Payable' },

    // CRM (Phase 5)
    { key: 'nav.crm',              locale: 'ar-EG', value: 'العملاء' },
    { key: 'nav.crm',              locale: 'ar-SA', value: 'العملاء' },
    { key: 'nav.crm',              locale: 'en',    value: 'CRM' },
    { key: 'nav.appointments',     locale: 'ar-EG', value: 'المواعيد' },
    { key: 'nav.appointments',     locale: 'ar-SA', value: 'المواعيد' },
    { key: 'nav.appointments',     locale: 'en',    value: 'Appointments' },
    { key: 'crm.title',            locale: 'ar-EG', value: 'العملاء' },
    { key: 'crm.title',            locale: 'ar-SA', value: 'العملاء' },
    { key: 'crm.title',            locale: 'en',    value: 'Customers' },
    { key: 'crm.name',             locale: 'ar-EG', value: 'الاسم' },
    { key: 'crm.name',             locale: 'ar-SA', value: 'الاسم' },
    { key: 'crm.name',             locale: 'en',    value: 'Name' },
    { key: 'crm.phone',            locale: 'ar-EG', value: 'الهاتف' },
    { key: 'crm.phone',            locale: 'ar-SA', value: 'الهاتف' },
    { key: 'crm.phone',            locale: 'en',    value: 'Phone' },
    { key: 'crm.email',            locale: 'ar-EG', value: 'البريد الإلكتروني' },
    { key: 'crm.email',            locale: 'ar-SA', value: 'البريد الإلكتروني' },
    { key: 'crm.email',            locale: 'en',    value: 'Email' },
    { key: 'crm.createCustomer',   locale: 'ar-EG', value: 'عميل جديد' },
    { key: 'crm.createCustomer',   locale: 'ar-SA', value: 'عميل جديد' },
    { key: 'crm.createCustomer',   locale: 'en',    value: 'New Customer' },
    { key: 'crm.empty',            locale: 'ar-EG', value: 'لا يوجد عملاء' },
    { key: 'crm.empty',            locale: 'ar-SA', value: 'لا يوجد عملاء' },
    { key: 'crm.empty',            locale: 'en',    value: 'No customers' },
    { key: 'crm.invoices',         locale: 'ar-EG', value: 'فواتير' },
    { key: 'crm.invoices',         locale: 'ar-SA', value: 'فواتير' },
    { key: 'crm.invoices',         locale: 'en',    value: 'Invoices' },
    { key: 'crm.appointments',     locale: 'ar-EG', value: 'مواعيد' },
    { key: 'crm.appointments',     locale: 'ar-SA', value: 'مواعيد' },
    { key: 'crm.appointments',     locale: 'en',    value: 'Appointments' },
    { key: 'crm.activities',       locale: 'ar-EG', value: 'نشاطات' },
    { key: 'crm.activities',       locale: 'ar-SA', value: 'نشاطات' },
    { key: 'crm.activities',       locale: 'en',    value: 'Activities' },

    // Appointments
    { key: 'appointment.title',        locale: 'ar-EG', value: 'المواعيد' },
    { key: 'appointment.title',        locale: 'ar-SA', value: 'المواعيد' },
    { key: 'appointment.title',        locale: 'en',    value: 'Appointments' },
    { key: 'appointment.customer',     locale: 'ar-EG', value: 'العميل' },
    { key: 'appointment.customer',     locale: 'ar-SA', value: 'العميل' },
    { key: 'appointment.customer',     locale: 'en',    value: 'Customer' },
    { key: 'appointment.scheduledAt',  locale: 'ar-EG', value: 'موعد الاجتماع' },
    { key: 'appointment.scheduledAt',  locale: 'ar-SA', value: 'موعد الاجتماع' },
    { key: 'appointment.scheduledAt',  locale: 'en',    value: 'Scheduled At' },
    { key: 'appointment.note',         locale: 'ar-EG', value: 'ملاحظات' },
    { key: 'appointment.note',         locale: 'ar-SA', value: 'ملاحظات' },
    { key: 'appointment.note',         locale: 'en',    value: 'Note' },
    { key: 'appointment.status',       locale: 'ar-EG', value: 'الحالة' },
    { key: 'appointment.status',       locale: 'ar-SA', value: 'الحالة' },
    { key: 'appointment.status',       locale: 'en',    value: 'Status' },
    { key: 'appointment.schedule',     locale: 'ar-EG', value: 'حجز موعد' },
    { key: 'appointment.schedule',     locale: 'ar-SA', value: 'حجز موعد' },
    { key: 'appointment.schedule',     locale: 'en',    value: 'Schedule Appointment' },
    { key: 'appointment.empty',        locale: 'ar-EG', value: 'لا توجد مواعيد' },
    { key: 'appointment.empty',        locale: 'ar-SA', value: 'لا توجد مواعيد' },
    { key: 'appointment.empty',        locale: 'en',    value: 'No appointments' },
    { key: 'appointment.status.SCHEDULED',  locale: 'ar-EG', value: 'مجدول' },
    { key: 'appointment.status.SCHEDULED',  locale: 'ar-SA', value: 'مجدول' },
    { key: 'appointment.status.SCHEDULED',  locale: 'en',    value: 'Scheduled' },
    { key: 'appointment.status.COMPLETED',  locale: 'ar-EG', value: 'مكتمل' },
    { key: 'appointment.status.COMPLETED',  locale: 'ar-SA', value: 'مكتمل' },
    { key: 'appointment.status.COMPLETED',  locale: 'en',    value: 'Completed' },
    { key: 'appointment.status.CANCELLED',  locale: 'ar-EG', value: 'ملغي' },
    { key: 'appointment.status.CANCELLED',  locale: 'ar-SA', value: 'ملغي' },
    { key: 'appointment.status.CANCELLED',  locale: 'en',    value: 'Cancelled' },
    { key: 'appointment.status.NO_SHOW',    locale: 'ar-EG', value: 'لم يحضر' },
    { key: 'appointment.status.NO_SHOW',    locale: 'ar-SA', value: 'لم يحضر' },
    { key: 'appointment.status.NO_SHOW',    locale: 'en',    value: 'No Show' },

    // Reminders
    { key: 'reminder.dueTitle',    locale: 'ar-EG', value: 'تذكيرات مستحقة' },
    { key: 'reminder.dueTitle',    locale: 'ar-SA', value: 'تذكيرات مستحقة' },
    { key: 'reminder.dueTitle',    locale: 'en',    value: 'Due Reminders' },
    { key: 'reminder.empty',       locale: 'ar-EG', value: 'لا توجد تذكيرات مستحقة' },
    { key: 'reminder.empty',       locale: 'ar-SA', value: 'لا توجد تذكيرات مستحقة' },
    { key: 'reminder.empty',       locale: 'en',    value: 'No due reminders' },
    { key: 'reminder.dismiss',     locale: 'ar-EG', value: 'تجاهل' },
    { key: 'reminder.dismiss',     locale: 'ar-SA', value: 'تجاهل' },
    { key: 'reminder.dismiss',     locale: 'en',    value: 'Dismiss' },

    // Branding (Phase 7)
    { key: 'nav.branding',       locale: 'ar-EG', value: 'الهوية والبرندنج' },
    { key: 'nav.branding',       locale: 'ar-SA', value: 'الهوية والبرندنج' },
    { key: 'nav.branding',       locale: 'en',    value: 'Branding' },
    { key: 'branding.title',     locale: 'ar-EG', value: 'إعدادات الهوية' },
    { key: 'branding.title',     locale: 'ar-SA', value: 'إعدادات الهوية' },
    { key: 'branding.title',     locale: 'en',    value: 'Branding Settings' },
    { key: 'branding.logoUrl',   locale: 'ar-EG', value: 'رابط الشعار' },
    { key: 'branding.logoUrl',   locale: 'ar-SA', value: 'رابط الشعار' },
    { key: 'branding.logoUrl',   locale: 'en',    value: 'Logo URL' },
    { key: 'branding.primaryColor', locale: 'ar-EG', value: 'اللون الأساسي' },
    { key: 'branding.primaryColor', locale: 'ar-SA', value: 'اللون الأساسي' },
    { key: 'branding.primaryColor', locale: 'en',    value: 'Primary Color' },
    { key: 'branding.accentColor',  locale: 'ar-EG', value: 'اللون الثانوي' },
    { key: 'branding.accentColor',  locale: 'ar-SA', value: 'اللون الثانوي' },
    { key: 'branding.accentColor',  locale: 'en',    value: 'Accent Color' },
    { key: 'branding.invoiceFooter',locale: 'ar-EG', value: 'نص أسفل الفاتورة' },
    { key: 'branding.invoiceFooter',locale: 'ar-SA', value: 'نص أسفل الفاتورة' },
    { key: 'branding.invoiceFooter',locale: 'en',    value: 'Invoice Footer Text' },
    { key: 'branding.businessType', locale: 'ar-EG', value: 'نوع النشاط' },
    { key: 'branding.businessType', locale: 'ar-SA', value: 'نوع النشاط' },
    { key: 'branding.businessType', locale: 'en',    value: 'Business Type' },
    { key: 'branding.preview',   locale: 'ar-EG', value: 'معاينة الفاتورة' },
    { key: 'branding.preview',   locale: 'ar-SA', value: 'معاينة الفاتورة' },
    { key: 'branding.preview',   locale: 'en',    value: 'Invoice Preview' },
    { key: 'branding.save',      locale: 'ar-EG', value: 'حفظ الإعدادات' },
    { key: 'branding.save',      locale: 'ar-SA', value: 'حفظ الإعدادات' },
    { key: 'branding.save',      locale: 'en',    value: 'Save Settings' },
    { key: 'branding.saved',     locale: 'ar-EG', value: 'تم حفظ إعدادات الهوية' },
    { key: 'branding.saved',     locale: 'ar-SA', value: 'تم حفظ إعدادات الهوية' },
    { key: 'branding.saved',     locale: 'en',    value: 'Branding settings saved' },
    { key: 'branding.defaults',  locale: 'ar-EG', value: 'افتراضي (H.A.M.D)' },
    { key: 'branding.defaults',  locale: 'ar-SA', value: 'افتراضي (H.A.M.D)' },
    { key: 'branding.defaults',  locale: 'en',    value: 'Default (H.A.M.D)' },
    { key: 'branding.businessType.general',    locale: 'ar-EG', value: 'عام' },
    { key: 'branding.businessType.general',    locale: 'ar-SA', value: 'عام' },
    { key: 'branding.businessType.general',    locale: 'en',    value: 'General' },
    { key: 'branding.businessType.retail',     locale: 'ar-EG', value: 'تجارة تجزئة' },
    { key: 'branding.businessType.retail',     locale: 'ar-SA', value: 'تجارة تجزئة' },
    { key: 'branding.businessType.retail',     locale: 'en',    value: 'Retail' },
    { key: 'branding.businessType.restaurant', locale: 'ar-EG', value: 'مطعم' },
    { key: 'branding.businessType.restaurant', locale: 'ar-SA', value: 'مطعم' },
    { key: 'branding.businessType.restaurant', locale: 'en',    value: 'Restaurant' },
    { key: 'branding.businessType.clinic',     locale: 'ar-EG', value: 'عيادة' },
    { key: 'branding.businessType.clinic',     locale: 'ar-SA', value: 'عيادة' },
    { key: 'branding.businessType.clinic',     locale: 'en',    value: 'Clinic' },
    { key: 'branding.businessType.services',   locale: 'ar-EG', value: 'خدمات' },
    { key: 'branding.businessType.services',   locale: 'ar-SA', value: 'خدمات' },
    { key: 'branding.businessType.services',   locale: 'en',    value: 'Services' },

    // Business-type-specific account names
    { key: 'account.salesDiscounts',      locale: 'ar-EG', value: 'خصومات مبيعات' },
    { key: 'account.salesDiscounts',      locale: 'ar-SA', value: 'خصومات مبيعات' },
    { key: 'account.salesDiscounts',      locale: 'en',    value: 'Sales Discounts' },
    { key: 'account.kitchenWaste',        locale: 'ar-EG', value: 'هالك المطعم' },
    { key: 'account.kitchenWaste',        locale: 'ar-SA', value: 'هالك المطعم' },
    { key: 'account.kitchenWaste',        locale: 'en',    value: 'Kitchen Waste' },
    { key: 'account.consultationFees',    locale: 'ar-EG', value: 'رسوم استشارة' },
    { key: 'account.consultationFees',    locale: 'ar-SA', value: 'رسوم استشارة' },
    { key: 'account.consultationFees',    locale: 'en',    value: 'Consultation Fees' },

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
  ]

  for (const t of translations) {
    await prisma.translation.upsert({
      where: { key_locale: { key: t.key, locale: t.locale } },
      update: { value: t.value },
      create: t,
    })
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
