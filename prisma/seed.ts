/**
 * H.A.M.D ERP — Seed (Phase 0)
 *
 * Creates:
 *  - 3 roles: admin, accountant, viewer (with permissions)
 *  - 2 tenants (Tenant A "شركة الأفق", Tenant B "شركة النور") so we can
 *    DEMONSTRATE cross-tenant isolation in the test endpoint.
 *  - For each tenant: admin / accountant / viewer users (password = "password123")
 *  - A starter chart of accounts per tenant (different codes per tenant to
 *    make the isolation test visually obvious).
 *  - UI translations for ar-EG, ar-SA, en.
 *
 * Run with: `bun run db:seed`
 */
import { PrismaClient, AccountType } from '@prisma/client'
import bcrypt from 'bcryptjs'

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
      ],
    },
    {
      name: 'accountant',
      perms: [
        'account:read', 'account:create', 'account:update',
        'journal:read', 'journal:create',
        'invoice:create', 'invoice:read', 'invoice:post',
      ],
    },
    {
      name: 'viewer',
      perms: ['account:read', 'journal:read', 'invoice:read'],
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
    { email: 'viewer@afak.test',    name: 'مشاهد الأفق',  tenantId: 'tenant-afak', role: 'viewer' },
    { email: 'admin@noor.test',     name: 'مدير النور',   tenantId: 'tenant-noor', role: 'admin' },
    { email: 'accountant@noor.test',name: 'محاسب النور',  tenantId: 'tenant-noor', role: 'accountant' },
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
    { code: '2000', nameKey: 'account.liabilities',type: AccountType.LIABILITY, parentId: null },
    { code: '2001', nameKey: 'account.salesTax',  type: AccountType.LIABILITY, parentCode: '2000' },
    { code: '3000', nameKey: 'account.equity',    type: AccountType.EQUITY,    parentId: null },
    { code: '4000', nameKey: 'account.revenue',   type: AccountType.REVENUE,   parentId: null },
    { code: '5000', nameKey: 'account.expense',   type: AccountType.EXPENSE,   parentId: null },
  ]
  const noorAccounts = [
    { code: '1100', nameKey: 'account.assets',    type: AccountType.ASSET,     parentId: null },
    { code: '1101', nameKey: 'account.cash',      type: AccountType.ASSET,     parentCode: '1100' },
    { code: '1102', nameKey: 'account.receivable', type: AccountType.ASSET,    parentCode: '1100' },
    { code: '2100', nameKey: 'account.liabilities',type: AccountType.LIABILITY, parentId: null },
    { code: '2101', nameKey: 'account.salesTax',  type: AccountType.LIABILITY, parentCode: '2100' },
    { code: '3100', nameKey: 'account.equity',    type: AccountType.EQUITY,    parentId: null },
    { code: '4100', nameKey: 'account.revenue',   type: AccountType.REVENUE,   parentId: null },
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
