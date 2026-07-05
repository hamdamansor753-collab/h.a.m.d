# modules/accounting.md — Accounting & Invoicing (Phase 1)

## يعتمد على
Core (Tenancy, Auth, RBAC, i18n, Ledger) — Phase 0 مكتملة.

## النطاق
1. أول تطبيق فعلي لـ `TaxProvider` (مصر — ETA) على واجهة `03-architecture-decisions.md` Decision 6
2. نموذج Invoice مرتبط تلقائيًا بالـ Ledger المركزي
3. تقارير مالية أساسية مبنية من الـ Ledger مباشرة (لا حسابات موازية)

## نموذج البيانات الجديد (يُضاف لـ `04-data-model.md`)

```prisma
model Invoice {
  id            String        @id @default(uuid())
  tenantId      String
  tenant        Tenant        @relation(fields: [tenantId], references: [id])
  number        String        // تسلسلي لكل tenant، غير قابل لإعادة الاستخدام
  customerName  String
  date          DateTime
  status        InvoiceStatus @default(DRAFT)
  lines         InvoiceLine[]
  journalEntryId String?      // يُملأ عند الترحيل (posting) للـ ledger
  createdAt     DateTime      @default(now())

  @@unique([tenantId, number])
  @@index([tenantId])
}

enum InvoiceStatus {
  DRAFT
  POSTED   // تم ترحيلها للـ ledger — غير قابلة للتعديل بعد هذه النقطة
  VOID
}

model InvoiceLine {
  id          String  @id @default(uuid())
  invoiceId   String
  invoice     Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  description String
  amount      Decimal
  taxRate     Decimal @default(0)
}
```

## القاعدة الإلزامية: الترحيل للـ Ledger (Posting)
- فاتورة بحالة `DRAFT` قابلة للتعديل والحذف بحرية
- عند الترحيل (`POST /api/invoices/:id/post`):
  1. حساب الضريبة عبر `getTaxProvider('EG')` — **ممنوع** أي حساب ضريبة مباشر داخل service الفواتير
  2. إنشاء `JournalEntry` متوازن تلقائيًا (مدين: العميل/النقدية، دائن: المبيعات + ضريبة مستحقة) عبر `createJournalEntry` الموجودة من Phase 0 — **لا تُعاد كتابة منطق التوازن**
  3. تحديث `Invoice.status = POSTED` و `journalEntryId` في **transaction واحدة** مع إنشاء القيد (atomicity)
- فاتورة `POSTED` **لا يمكن تعديلها أو حذفها** — فقط `VOID` (بقيد عكسي، لا حذف فعلي)

## ETA Tax Provider (مصر) — Phase 1 نطاق مبسّط
Phase 1 يشمل **حساب الضريبة فقط** (14% افتراضي، قابل للتخصيص لكل بند)، وليس التوليد الكامل لملف UBL XML الموقّع رقميًا والمرسل لمصلحة الضرائب (ده نطاق موديول لاحق مخصص للتكامل مع ETA). `generateCompliantDocument` في هذه المرحلة يرجّع placeholder موضّح بوضوح إنه غير مكتمل، **لا** يُخرج مستند مزيّف يبان جاهز.

## التسلسل (Sequential Numbering)
رقم الفاتورة (`number`) لكل tenant يجب أن يكون تسلسليًا بدون فجوات لأي فاتورة تم ترحيلها (posted) — متطلب مستقبلي لتوافق ETA. Draft المحذوفة يمكن أن تسبب فجوة، لكن الفجوة يجب أن تكون موثقة (لا حذف صامت لرقم مُستخدم).

## الصلاحيات الجديدة
`invoice:create`, `invoice:read`, `invoice:post`, `invoice:void` — تُضاف لبذرة RBAC (seed) بنفس منطق Phase 0.

## معيار الإتمام
- إنشاء فاتورة Draft، تعديلها، ترحيلها → قيد متوازن يظهر في `/api/journal`
- محاولة تعديل فاتورة POSTED → مرفوضة
- تقرير قائمة دخل مبسّط (Revenue - Expense accounts) يُحسب من `JournalLine` مباشرة، لا من جدول منفصل
