# 03 - قرارات التصميم التقني (Architecture Decision Record)

> هذا الملف "دستوري" — أي كود من GLM يخالف قرارًا هنا يُرفَض في المراجعة تلقائيًا.

## القرار 1: نموذج التعدد (Multi-tenancy)

**القرار**: قاعدة بيانات واحدة مشتركة + Row-Level Security على مستوى PostgreSQL.

**السبب**:
- تكلفة تشغيلية أقل بكثير من قاعدة منفصلة لكل tenant عند نمو عدد العملاء
- Migrations وتحديثات السكيما تُطبَّق مرة واحدة لكل العملاء
- العزل الحقيقي يجب أن يكون في قاعدة البيانات نفسها، لا في منطق التطبيق فقط (تعلمنا هذا من ثغرة `getBranchFilter()` السابقة)

**التطبيق الإلزامي**:
1. كل جدول متعلق بـ tenant له عمود `tenant_id` غير قابل للـ null
2. **PostgreSQL RLS Policy** مُفعّلة على كل جدول tenant-scoped:
   ```sql
   ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON invoices
     USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
   ```
3. Prisma Middleware يحقن `tenant_id` تلقائيًا في كل query (لا يُترك لكل route يفلتر بنفسه)
4. **لا استثناءات**: أي endpoint يحتاج بيانات عبر tenants متعددة (مثل لوحة تحكم Super Admin) يستخدم اتصال قاعدة بيانات منفصل بصلاحيات خاصة، لا يتجاوز RLS من داخل نفس الـ connection

**خيار مستقبلي (غير مطلوب الآن)**: عملاء Enterprise كبار يمكن نقلهم لقاعدة بيانات منفصلة كـ tier مدفوع، بدون تغيير الـ architecture الأساسي.

---

## القرار 2: الستاك التقني

- **Framework**: Next.js (App Router)
- **ORM**: Prisma
- **قاعدة البيانات**: PostgreSQL
- **UI**: shadcn/ui + Tailwind
- **Validation**: Zod (يُستخدم في كل API route بدون استثناء)
- **Runtime**: يجب تحديد `export const runtime = 'nodejs'` بشكل صريح في كل API route يستخدم Prisma (تجنبًا لتكرار خطأ سابق)

---

## القرار 3: البنية المعمارية (Modular Monolith)

**القرار**: Modular Monolith، لا Microservices.

**السبب**: فريق تطوير صغير + الحاجة لسرعة تطوير عالية في المراحل الأولى. الفصل بين الموديولات يكون على مستوى الكود (folders + boundaries واضحة) لا على مستوى الشبكة.

**البنية**:
```
/src
  /core          → tenancy, auth, i18n, ledger, tax-provider
  /modules
    /accounting
    /inventory
    /pos
    /hr
    /crm
  /api           → API routes, كل route يستدعي service من الموديول المناسب فقط
```

**قاعدة صارمة**: موديول لا يستدعي جداول قاعدة بيانات موديول آخر مباشرة عبر Prisma. التواصل بين الموديولات يتم عبر service functions مُصدَّرة بوضوح (internal API)، تسهيلًا لأي فصل مستقبلي لـ microservices لو احتاج المشروع ذلك.

---

## القرار 4: RBAC (الصلاحيات)

- نموذج صلاحيات على مستويين: **Role** (مدير، محاسب، مندوب مبيعات...) + **Permission** دقيقة (invoice:create, invoice:void...)
- الصلاحيات تُفحص في **طبقة الخدمة (service layer)**، لا في الواجهة فقط — الواجهة تخفي الأزرار، لكن الـ API يرفض الطلب المصلحة إذا لم تتحقق الصلاحية

---

## القرار 5: طبقة i18n

- كل نص ظاهر للمستخدم = مفتاح ترجمة (`t('invoice.title')`)، ممنوع نص hardcoded في أي كومبوننت
- جدول ترجمات مركزي + ملفات JSON للغات (ar-EG, ar-SA, en)
- تنسيقات الأرقام والتواريخ عبر `Intl` API حسب locale المستخدم، لا تنسيق يدوي

---

## القرار 6: طبقة الضرائب (Pluggable Tax Provider)

```typescript
interface TaxProvider {
  countryCode: string;
  calculateTax(invoice: InvoiceInput): TaxResult;
  generateCompliantDocument(invoice: Invoice): CompliantDocument; // ETA XML / ZATCA UBL
}
```
كل دولة = implementation جديد لهذا الـ interface، يُسجَّل في registry مركزي. لا يوجد أي منطق ضرائب مكتوب مباشرة داخل موديول المحاسبة نفسه.
