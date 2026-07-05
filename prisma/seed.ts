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
      perms: ['account:read', 'account:create', 'account:update', 'journal:read', 'journal:create', 'journal:void', 'user:read', 'tenant:manage'],
    },
    {
      name: 'accountant',
      perms: ['account:read', 'account:create', 'account:update', 'journal:read', 'journal:create'],
    },
    {
      name: 'viewer',
      perms: ['account:read', 'journal:read'],
    },
  ]
  const roles: Record<string, { id: string }> = {}
  for (const def of roleDefs) {
    const role = await prisma.role.upsert({
      where: { name: def.name },
      update: {},
      create: {
        name: def.name,
        permissions: { connect: def.perms.map((k) => ({ id: permByKey[k].id })) },
      },
      include: { permissions: true },
    })
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
    { code: '2000', nameKey: 'account.liabilities',type: AccountType.LIABILITY, parentId: null },
    { code: '3000', nameKey: 'account.equity',    type: AccountType.EQUITY,    parentId: null },
    { code: '4000', nameKey: 'account.revenue',   type: AccountType.REVENUE,   parentId: null },
    { code: '5000', nameKey: 'account.expense',   type: AccountType.EXPENSE,   parentId: null },
  ]
  const noorAccounts = [
    { code: '1100', nameKey: 'account.assets',    type: AccountType.ASSET,     parentId: null },
    { code: '1101', nameKey: 'account.cash',      type: AccountType.ASSET,     parentCode: '1100' },
    { code: '2100', nameKey: 'account.liabilities',type: AccountType.LIABILITY, parentId: null },
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
