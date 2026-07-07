import { Pool } from 'pg'

const pool = new Pool({
  connectionString: 'postgresql://postgres.eslekpvlrlzihjspytfc:Hamada%40879687@aws-1-eu-west-2.pooler.supabase.com:5432/postgres',
})

// Filter out false positives (import paths, variable names)
const falsePositives = new Set(['fs', 'id', 'locale', 'next-auth/react', 'path', 'common.tenant'])

const missingKeys = [
  // POS
  'pos.cart', 'pos.checkout', 'pos.cogs', 'pos.customerName', 'pos.emptyCart',
  'pos.invoiceNumber', 'pos.netProfit', 'pos.newSale', 'pos.noProducts',
  'pos.receipt', 'pos.saleComplete', 'pos.searchProducts', 'pos.stock',
  'pos.subtotal', 'pos.tax', 'pos.title', 'pos.total', 'pos.warehouse',
  'pos.addToCart', 'pos.price', 'pos.qty',
  // Nav
  'nav.pos', 'nav.crm', 'nav.appointments', 'nav.hr', 'nav.payroll', 'nav.branding',
  // Tests
  'tests.failed', 'tests.idle', 'tests.journalBalance', 'tests.passed',
  'tests.run', 'tests.running', 'tests.tenantIsolation', 'tests.title',
  // Common (some may exist but were flagged)
  'common.cancel', 'common.error', 'common.forbidden', 'common.language',
  'common.loading', 'common.save', 'common.tenant',
  'common.unauthorized', 'common.welcome', 'common.role',
  // HR
  'hr.baseSalary', 'hr.createEmployee', 'hr.empty', 'hr.fullName',
  'hr.hireDate', 'hr.salaryHidden', 'hr.status', 'hr.title',
  'hr.configError', 'hr.status.ACTIVE', 'hr.status.SUSPENDED', 'hr.status.TERMINATED',
  // Payroll
  'payroll.create', 'payroll.employees', 'payroll.empty', 'payroll.grossTotal',
  'payroll.insuranceTotal', 'payroll.monthLabel', 'payroll.netTotal',
  'payroll.post', 'payroll.posted', 'payroll.taxTotal', 'payroll.title',
  'payroll.notFound', 'payroll.cannotModify', 'payroll.period', 'payroll.status',
  'payroll.status.DRAFT', 'payroll.status.POSTED',
  // CRM
  'crm.activities', 'crm.appointments', 'crm.createCustomer', 'crm.email',
  'crm.empty', 'crm.invoices', 'crm.name', 'crm.phone', 'crm.title',
  // Appointments
  'appointment.customer', 'appointment.empty', 'appointment.note',
  'appointment.schedule', 'appointment.scheduledAt', 'appointment.title',
  'appointment.status', 'appointment.status.SCHEDULED', 'appointment.status.COMPLETED',
  'appointment.status.CANCELLED', 'appointment.status.NO_SHOW',
  // Branding
  'branding.accentColor', 'branding.businessType', 'branding.defaults',
  'branding.invoiceFooter', 'branding.logoUrl', 'branding.preview',
  'branding.primaryColor', 'branding.save', 'branding.saved', 'branding.title',
  'branding.businessType.general', 'branding.businessType.retail',
  'branding.businessType.restaurant', 'branding.businessType.clinic',
  'branding.businessType.services',
  // Reminders
  'reminder.dismiss', 'reminder.dueTitle', 'reminder.empty',
  // Inventory (ensure these exist)
  'inventory.configError', 'inventory.insufficientStock',
  // Invoice (ensure these exist)
  'invoice.cannotModify', 'invoice.configError', 'invoice.notFound',
  'invoice.number', 'invoice.status', 'invoice.status.DRAFT',
  'invoice.status.POSTED', 'invoice.status.VOID', 'invoice.total',
  'invoice.channel.MANUAL', 'invoice.channel.POS',
  // Journal (ensure)
  'journal.unbalanced', 'journal.created',
  // Account types (ensure)
  'type.ASSET', 'type.LIABILITY', 'type.EQUITY', 'type.REVENUE', 'type.EXPENSE',
  // Account names (ensure)
  'account.assets', 'account.bank', 'account.cash', 'account.equity',
  'account.expense', 'account.liabilities', 'account.receivable',
  'account.revenue', 'account.salesTax',
  'account.inventory', 'account.payable', 'account.cogs',
  'account.salaries', 'account.payrollPayable', 'account.payrollTax',
  'account.socialInsurance', 'account.salesDiscounts', 'account.kitchenWaste',
  'account.consultationFees',
  // Products/Warehouse
  'product.laptop', 'product.mouse', 'product.keyboard',
  'warehouse.main',
  // Account CRUD
  'account.code', 'account.create', 'account.empty', 'account.name', 'account.type',
  // Journal CRUD
  'journal.date', 'journal.description', 'journal.lines', 'journal.debit',
  'journal.credit', 'journal.create', 'journal.total', 'journal.addLine',
  'journal.save', 'journal.cancel',
  // Auth
  'auth.login', 'auth.logout', 'auth.email', 'auth.password',
  'auth.signInBtn', 'auth.invalidCreds', 'auth.demoAccounts',
  // App
  'app.name', 'app.tagline',
].filter(k => !falsePositives.has(k))

const translations: Record<string, { ar: string; en: string; sa?: string }> = {
  // POS
  'pos.cart': { ar: 'السلة', en: 'Cart' },
  'pos.checkout': { ar: 'إتمام البيع', en: 'Checkout' },
  'pos.cogs': { ar: 'تكلفة البضاعة المباعة', en: 'COGS' },
  'pos.customerName': { ar: 'اسم العميل', en: 'Customer Name' },
  'pos.emptyCart': { ar: 'السلة فارغة', en: 'Cart is empty' },
  'pos.invoiceNumber': { ar: 'رقم الفاتورة', en: 'Invoice No.' },
  'pos.netProfit': { ar: 'صافي الربح', en: 'Net Profit' },
  'pos.newSale': { ar: 'بيع جديد', en: 'New Sale' },
  'pos.noProducts': { ar: 'لا توجد منتجات', en: 'No products' },
  'pos.receipt': { ar: 'إيصال', en: 'Receipt' },
  'pos.saleComplete': { ar: 'تم إتمام البيع بنجاح', en: 'Sale completed successfully' },
  'pos.searchProducts': { ar: 'ابحث عن منتج بالاسم أو الرمز', en: 'Search products by name or SKU' },
  'pos.stock': { ar: 'المتاح', en: 'Stock' },
  'pos.subtotal': { ar: 'الإجمالي قبل الضريبة', en: 'Subtotal' },
  'pos.tax': { ar: 'الضريبة', en: 'Tax' },
  'pos.title': { ar: 'نقطة البيع', en: 'Point of Sale' },
  'pos.total': { ar: 'الإجمالي', en: 'Total' },
  'pos.warehouse': { ar: 'المخزن', en: 'Warehouse' },
  'pos.addToCart': { ar: 'إضافة للسلة', en: 'Add to cart' },
  'pos.price': { ar: 'السعر', en: 'Price' },
  'pos.qty': { ar: 'الكمية', en: 'Qty' },
  // Nav
  'nav.pos': { ar: 'نقطة البيع', en: 'POS' },
  'nav.crm': { ar: 'العملاء', en: 'CRM' },
  'nav.appointments': { ar: 'المواعيد', en: 'Appointments' },
  'nav.hr': { ar: 'الموارد البشرية', en: 'Human Resources' },
  'nav.payroll': { ar: 'الرواتب', en: 'Payroll' },
  'nav.branding': { ar: 'الهوية والبرندنج', en: 'Branding' },
  // Tests
  'tests.failed': { ar: 'فشل', en: 'FAIL' },
  'tests.idle': { ar: 'لم يتم التشغيل بعد', en: 'Not run yet' },
  'tests.journalBalance': { ar: 'توازن القيود', en: 'Journal balance' },
  'tests.passed': { ar: 'نجح', en: 'PASS' },
  'tests.run': { ar: 'تشغيل الاختبارات', en: 'Run tests' },
  'tests.running': { ar: 'جارٍ التشغيل...', en: 'Running...' },
  'tests.tenantIsolation': { ar: 'عزل المستأجرين', en: 'Tenant isolation' },
  'tests.title': { ar: 'اختبارات العزل والتوازن', en: 'Isolation & Balance Tests' },
  // Common
  'common.cancel': { ar: 'إلغاء', en: 'Cancel' },
  'common.error': { ar: 'حدث خطأ', en: 'Something went wrong' },
  'common.forbidden': { ar: 'ليس لديك صلاحية لتنفيذ هذا الإجراء', en: 'You do not have permission to perform this action' },
  'common.language': { ar: 'اللغة', en: 'Language' },
  'common.loading': { ar: 'جارٍ التحميل...', en: 'Loading...' },
  'common.save': { ar: 'حفظ', en: 'Save' },
  'common.tenant': { ar: 'المستأجر', en: 'Tenant' },
  'common.unauthorized': { ar: 'يجب تسجيل الدخول أولاً', en: 'Authentication required' },
  'common.welcome': { ar: 'أهلاً', en: 'Welcome' },
  'common.role': { ar: 'الدور', en: 'Role' },
  // HR
  'hr.baseSalary': { ar: 'الراتب الأساسي', en: 'Base Salary' },
  'hr.createEmployee': { ar: 'موظف جديد', en: 'New Employee' },
  'hr.empty': { ar: 'لا يوجد موظفون', en: 'No employees' },
  'hr.fullName': { ar: 'الاسم الكامل', en: 'Full Name' },
  'hr.hireDate': { ar: 'تاريخ التعيين', en: 'Hire Date' },
  'hr.salaryHidden': { ar: 'مخفي (لا تملك صلاحية)', en: 'Hidden (no permission)' },
  'hr.status': { ar: 'الحالة', en: 'Status' },
  'hr.title': { ar: 'الموظفون', en: 'Employees' },
  'hr.configError': { ar: 'خطأ في إعداد حسابات الرواتب', en: 'Payroll accounts not configured' },
  'hr.status.ACTIVE': { ar: 'نشط', en: 'Active' },
  'hr.status.SUSPENDED': { ar: 'موقوف', en: 'Suspended' },
  'hr.status.TERMINATED': { ar: 'منتهي', en: 'Terminated' },
  // Payroll
  'payroll.create': { ar: 'تشغيل رواتب شهر', en: 'Run Payroll' },
  'payroll.employees': { ar: 'الموظفون', en: 'Employees' },
  'payroll.empty': { ar: 'لا توجد تشغيلات رواتب', en: 'No payroll runs' },
  'payroll.grossTotal': { ar: 'إجمالي الرواتب', en: 'Gross Total' },
  'payroll.insuranceTotal': { ar: 'إجمالي التأمينات', en: 'Insurance Total' },
  'payroll.monthLabel': { ar: 'الشهر (YYYY-MM)', en: 'Month (YYYY-MM)' },
  'payroll.netTotal': { ar: 'إجمالي الصافي', en: 'Net Total' },
  'payroll.post': { ar: 'ترحيل', en: 'Post' },
  'payroll.posted': { ar: 'تم ترحيل الرواتب بنجاح', en: 'Payroll posted to ledger' },
  'payroll.taxTotal': { ar: 'إجمالي الضريبة', en: 'Tax Total' },
  'payroll.title': { ar: 'تشغيل الرواتب', en: 'Payroll Runs' },
  'payroll.notFound': { ar: 'تشغيل الرواتب غير موجود', en: 'Payroll run not found' },
  'payroll.cannotModify': { ar: 'لا يمكن تعديل رواتب مرحّلة', en: 'Cannot modify a posted payroll run' },
  'payroll.period': { ar: 'الفترة', en: 'Period' },
  'payroll.status': { ar: 'الحالة', en: 'Status' },
  'payroll.status.DRAFT': { ar: 'مسودة', en: 'Draft' },
  'payroll.status.POSTED': { ar: 'مرحّلة', en: 'Posted' },
  // CRM
  'crm.activities': { ar: 'نشاطات', en: 'Activities' },
  'crm.appointments': { ar: 'مواعيد', en: 'Appointments' },
  'crm.createCustomer': { ar: 'عميل جديد', en: 'New Customer' },
  'crm.email': { ar: 'البريد الإلكتروني', en: 'Email' },
  'crm.empty': { ar: 'لا يوجد عملاء', en: 'No customers' },
  'crm.invoices': { ar: 'فواتير', en: 'Invoices' },
  'crm.name': { ar: 'الاسم', en: 'Name' },
  'crm.phone': { ar: 'الهاتف', en: 'Phone' },
  'crm.title': { ar: 'العملاء', en: 'Customers' },
  // Appointments
  'appointment.customer': { ar: 'العميل', en: 'Customer' },
  'appointment.empty': { ar: 'لا توجد مواعيد', en: 'No appointments' },
  'appointment.note': { ar: 'ملاحظات', en: 'Note' },
  'appointment.schedule': { ar: 'حجز موعد', en: 'Schedule Appointment' },
  'appointment.scheduledAt': { ar: 'موعد الاجتماع', en: 'Scheduled At' },
  'appointment.title': { ar: 'المواعيد', en: 'Appointments' },
  'appointment.status': { ar: 'الحالة', en: 'Status' },
  'appointment.status.SCHEDULED': { ar: 'مجدول', en: 'Scheduled' },
  'appointment.status.COMPLETED': { ar: 'مكتمل', en: 'Completed' },
  'appointment.status.CANCELLED': { ar: 'ملغي', en: 'Cancelled' },
  'appointment.status.NO_SHOW': { ar: 'لم يحضر', en: 'No Show' },
  // Branding
  'branding.accentColor': { ar: 'اللون الثانوي', en: 'Accent Color' },
  'branding.businessType': { ar: 'نوع النشاط', en: 'Business Type' },
  'branding.defaults': { ar: 'افتراضي (H.A.M.D)', en: 'Default (H.A.M.D)' },
  'branding.invoiceFooter': { ar: 'نص أسفل الفاتورة', en: 'Invoice Footer Text' },
  'branding.logoUrl': { ar: 'رابط الشعار', en: 'Logo URL' },
  'branding.preview': { ar: 'معاينة الفاتورة', en: 'Invoice Preview' },
  'branding.primaryColor': { ar: 'اللون الأساسي', en: 'Primary Color' },
  'branding.save': { ar: 'حفظ الإعدادات', en: 'Save Settings' },
  'branding.saved': { ar: 'تم حفظ إعدادات الهوية', en: 'Branding settings saved' },
  'branding.title': { ar: 'إعدادات الهوية', en: 'Branding Settings' },
  'branding.businessType.general': { ar: 'عام', en: 'General' },
  'branding.businessType.retail': { ar: 'تجارة تجزئة', en: 'Retail' },
  'branding.businessType.restaurant': { ar: 'مطعم', en: 'Restaurant' },
  'branding.businessType.clinic': { ar: 'عيادة', en: 'Clinic' },
  'branding.businessType.services': { ar: 'خدمات', en: 'Services' },
  // Reminders
  'reminder.dismiss': { ar: 'تجاهل', en: 'Dismiss' },
  'reminder.dueTitle': { ar: 'تذكيرات مستحقة', en: 'Due Reminders' },
  'reminder.empty': { ar: 'لا توجد تذكيرات مستحقة', en: 'No due reminders' },
  // Inventory
  'inventory.configError': { ar: 'خطأ في إعداد حسابات المخزون', en: 'Inventory accounts not configured' },
  'inventory.insufficientStock': { ar: 'الكمية المتاحة غير كافية', en: 'Insufficient stock' },
  // Invoice
  'invoice.cannotModify': { ar: 'لا يمكن تعديل فاتورة مرحّلة أو ملغاة', en: 'Cannot modify a posted or voided invoice' },
  'invoice.configError': { ar: 'خطأ في إعداد الحسابات المطلوبة للترحيل', en: 'Posting accounts not configured' },
  'invoice.notFound': { ar: 'الفاتورة غير موجودة', en: 'Invoice not found' },
  'invoice.number': { ar: 'رقم الفاتورة', en: 'Invoice No.' },
  'invoice.status': { ar: 'الحالة', en: 'Status' },
  'invoice.status.DRAFT': { ar: 'مسودة', en: 'Draft' },
  'invoice.status.POSTED': { ar: 'مرحّلة', en: 'Posted' },
  'invoice.status.VOID': { ar: 'ملغاة', en: 'Void' },
  'invoice.total': { ar: 'الإجمالي', en: 'Total' },
  'invoice.channel.MANUAL': { ar: 'يدوية', en: 'Manual' },
  'invoice.channel.POS': { ar: 'نقطة بيع', en: 'POS' },
  // Journal
  'journal.unbalanced': { ar: 'القيد غير متوازن: مجموع المدين يجب أن يساوي مجموع الدائن', en: 'Unbalanced entry: total debit must equal total credit' },
  'journal.created': { ar: 'تم إنشاء القيد بنجاح', en: 'Journal entry created' },
  // Account types
  'type.ASSET': { ar: 'أصول', en: 'Asset' },
  'type.LIABILITY': { ar: 'خصوم', en: 'Liability' },
  'type.EQUITY': { ar: 'حقوق ملكية', en: 'Equity' },
  'type.REVENUE': { ar: 'إيرادات', en: 'Revenue' },
  'type.EXPENSE': { ar: 'مصروفات', en: 'Expense' },
  // Account names
  'account.assets': { ar: 'الأصول', en: 'Assets' },
  'account.bank': { ar: 'البنك', en: 'Bank' },
  'account.cash': { ar: 'النقدية', en: 'Cash' },
  'account.equity': { ar: 'حقوق الملكية', en: 'Equity' },
  'account.expense': { ar: 'المصروفات', en: 'Expenses' },
  'account.liabilities': { ar: 'الخصوم', en: 'Liabilities' },
  'account.receivable': { ar: 'العملاء (ذمم مدينة)', en: 'Accounts Receivable' },
  'account.revenue': { ar: 'الإيرادات', en: 'Revenue' },
  'account.salesTax': { ar: 'ضريبة القيمة المضافة المستحقة', en: 'Sales Tax Payable' },
  'account.inventory': { ar: 'المخزون', en: 'Inventory' },
  'account.payable': { ar: 'حسابات دائنة (موردون)', en: 'Accounts Payable' },
  'account.cogs': { ar: 'تكلفة البضاعة المباعة', en: 'Cost of Goods Sold' },
  'account.salaries': { ar: 'مصروف الرواتب', en: 'Salaries Expense' },
  'account.payrollPayable': { ar: 'رواتب مستحقة الدفع', en: 'Payroll Payable' },
  'account.payrollTax': { ar: 'ضريبة دخل مستقطعة مستحقة', en: 'Payroll Tax Payable' },
  'account.socialInsurance': { ar: 'تأمينات اجتماعية مستحقة', en: 'Social Insurance Payable' },
  'account.salesDiscounts': { ar: 'خصومات مبيعات', en: 'Sales Discounts' },
  'account.kitchenWaste': { ar: 'هالك المطعم', en: 'Kitchen Waste' },
  'account.consultationFees': { ar: 'رسوم استشارة', en: 'Consultation Fees' },
  // Products/Warehouse
  'product.laptop': { ar: 'لابتوب', en: 'Laptop' },
  'product.mouse': { ar: 'ماوس', en: 'Mouse' },
  'product.keyboard': { ar: 'لوحة مفاتيح', en: 'Keyboard' },
  'warehouse.main': { ar: 'المخزن الرئيسي', en: 'Main Warehouse' },
  // Account CRUD
  'account.code': { ar: 'الرمز', en: 'Code' },
  'account.create': { ar: 'إضافة حساب', en: 'New Account' },
  'account.empty': { ar: 'لا توجد حسابات', en: 'No accounts' },
  'account.name': { ar: 'الاسم', en: 'Name' },
  'account.type': { ar: 'النوع', en: 'Type' },
  // Journal CRUD
  'journal.date': { ar: 'التاريخ', en: 'Date' },
  'journal.description': { ar: 'البيان', en: 'Description' },
  'journal.lines': { ar: 'البنود', en: 'Lines' },
  'journal.debit': { ar: 'مدين', en: 'Debit' },
  'journal.credit': { ar: 'دائن', en: 'Credit' },
  'journal.create': { ar: 'قيد جديد', en: 'New Entry' },
  'journal.total': { ar: 'الإجمالي', en: 'Total' },
  'journal.addLine': { ar: 'إضافة بند', en: 'Add line' },
  'journal.save': { ar: 'حفظ القيد', en: 'Save entry' },
  'journal.cancel': { ar: 'إلغاء', en: 'Cancel' },
  // Auth
  'auth.login': { ar: 'تسجيل الدخول', en: 'Sign in' },
  'auth.logout': { ar: 'تسجيل الخروج', en: 'Sign out' },
  'auth.email': { ar: 'البريد الإلكتروني', en: 'Email' },
  'auth.password': { ar: 'كلمة المرور', en: 'Password' },
  'auth.signInBtn': { ar: 'دخول', en: 'Sign in' },
  'auth.invalidCreds': { ar: 'بيانات الدخول غير صحيحة', en: 'Invalid credentials' },
  'auth.demoAccounts': { ar: 'حسابات تجريبية', en: 'Demo accounts' },
  // App
  'app.name': { ar: 'H.A.M.D ERP', en: 'H.A.M.D ERP' },
  'app.tagline': { ar: 'نظام تخطيط موارد المؤسسات', en: 'Enterprise Resource Planning' },
}

async function main() {
  let added = 0
  for (const [key, val] of Object.entries(translations)) {
    for (const locale of ['ar-EG', 'ar-SA', 'en'] as const) {
      const value = locale === 'en' ? val.en : val.ar
      try {
        await pool.query(
          `INSERT INTO "Translation" (id, key, locale, value) VALUES (gen_random_uuid(), $1, $2, $3) ON CONFLICT (key, locale) DO UPDATE SET value = $3`,
          [key, locale, value]
        )
        added++
      } catch (e: any) {
        console.error(`Error adding ${key}/${locale}: ${e.message}`)
      }
    }
  }
  console.log(`Added/updated ${added} translations (${Object.keys(translations).length} keys × 3 locales)`)
  
  // Verify
  const result = await pool.query('SELECT count(DISTINCT key) as cnt FROM "Translation"')
  console.log(`Total unique keys in DB: ${result.rows[0].cnt}`)
  
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
