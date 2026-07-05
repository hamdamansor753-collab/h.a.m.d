# modules/hr.md — HR & Payroll (Phase 4)

## يعتمد على
Core (Phase 0) + Accounting (Phase 1) — Ledger هو مقصد كل قيد رواتب.

## النطاق
1. بيانات الموظفين وهيكل الرواتب (بنود ثابتة ومتغيرة)
2. تشغيل رواتب شهري (Payroll Run) يُنتج قيد محاسبي واحد متوازن يمثل التزام الرواتب بالكامل
3. طبقة قواعد عمل قابلة للتوسع لكل دولة (نفس فلسفة `TaxProvider`)، تبدأ بمصر

## المبدأ الأساسي: نفس فلسفة Pluggable Tax Provider
قوانين العمل والضرائب على الرواتب تختلف جذريًا بين مصر (ضريبة دخل تصاعدية + تأمينات اجتماعية GOSI-style) والخليج (السعودية: GOSI فقط بدون ضريبة دخل على الأجانب غالبًا، لا ضريبة دخل شخصي عمومًا). **ممنوع** كتابة منطق حساب مصري مباشر داخل خدمة الرواتب — كل حساب عبر واجهة موحّدة:

```typescript
interface PayrollRuleProvider {
  countryCode: string;
  calculatePayroll(input: PayrollInput): PayrollResult;
  // PayrollResult يشمل: صافي الراتب، ضريبة الدخل المستقطعة (لو منطبقة)،
  // حصة الموظف في التأمينات، حصة صاحب العمل (تكلفة إضافية على الشركة لا تُخصم من الموظف)
}
```

## نموذج البيانات الجديد (يُضاف لـ `04-data-model.md`)

```prisma
model Employee {
  id           String   @id @default(uuid())
  tenantId     String
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  fullName     String
  nationalId   String   // الرقم القومي/الهوية — بيانات حساسة، انظر قسم الأمان أدناه
  hireDate     DateTime
  baseSalary   Decimal
  status       EmployeeStatus @default(ACTIVE)
  payrollRuns  PayrollLine[]

  @@index([tenantId])
}

enum EmployeeStatus {
  ACTIVE
  SUSPENDED
  TERMINATED
}

model PayrollRun {
  id          String        @id @default(uuid())
  tenantId    String
  period      String        // "2026-07" مثلًا
  status      PayrollStatus @default(DRAFT)
  lines       PayrollLine[]
  journalEntryId String?
  createdAt   DateTime      @default(now())

  @@unique([tenantId, period])
  @@index([tenantId])
}

enum PayrollStatus {
  DRAFT
  POSTED   // مرحّل للـ ledger — غير قابل للتعديل
}

model PayrollLine {
  id              String     @id @default(uuid())
  payrollRunId    String
  payrollRun      PayrollRun @relation(fields: [payrollRunId], references: [id], onDelete: Cascade)
  employeeId      String
  employee        Employee   @relation(fields: [employeeId], references: [id])
  grossSalary     Decimal
  incomeTax       Decimal    @default(0)  // من PayrollRuleProvider
  employeeInsurance Decimal  @default(0)  // حصة الموظف
  employerInsurance Decimal  @default(0)  // حصة صاحب العمل (تكلفة إضافية، لا تُخصم من الموظف)
  netPay          Decimal              // = grossSalary - incomeTax - employeeInsurance
}
```

## القاعدة الإلزامية: الترحيل (Posting)
عند ترحيل `PayrollRun` (`postPayrollRun(id)`):
1. لكل موظف: `calculatePayroll()` عبر `PayrollRuleProvider('EG')`
2. قيد محاسبي واحد شامل يمثل الرواتب كلها معًا (لا قيد لكل موظف — الحجم غير عملي لشركات كبيرة):
   - مدين: "مصروف رواتب" (EXPENSE) = إجمالي `grossSalary` + إجمالي `employerInsurance`
   - دائن: "صافي رواتب مستحقة الدفع" (LIABILITY) = إجمالي `netPay`
   - دائن: "ضريبة دخل مستقطعة مستحقة" (LIABILITY) = إجمالي `incomeTax`
   - دائن: "تأمينات اجتماعية مستحقة" (LIABILITY) = إجمالي `employeeInsurance` + `employerInsurance`
3. كل ده داخل **transaction واحدة** (نفس نمط `posSale` من Phase 3 بعد الإصلاح) — فشل أي موظف يرجّع كل حاجة لورا
4. `PayrollRun` بحالة `POSTED` غير قابل للتعديل (نفس مبدأ الفاتورة المرحّلة)

## أمان البيانات الحساسة (مهم بشكل خاص لهذا الموديول)
- `nationalId` وبيانات الراتب (`baseSalary`, `netPay`) بيانات حساسة بطبيعتها
- صلاحية `hr:read` **لا تكفي وحدها** لعرض الراتب — تحتاج صلاحية أدق `hr:salary:read` منفصلة عن `hr:read` العامة (بيانات الاسم والتاريخ ممكن تكون متاحة لصلاحية أوسع، الراتب لأدوار محدودة جدًا: admin + hr_manager فقط)
- لا `nationalId` أو `baseSalary` في أي log أو رسالة خطأ

## PayrollRuleProvider لمصر (Phase 4 — نطاق مبسّط)
حساب مبسّط في هذه المرحلة (شريحة ضريبية واحدة تقريبية + نسبة تأمينات ثابتة)، **موضّح بوضوح في الكود إنه تبسيط مؤقت**، وليس تطبيقًا دقيقًا لكل شرائح ضريبة الدخل المصرية الفعلية (ده نطاق موديول لاحق مخصص لضريبة الرواتب إذا احتجت دقة كاملة قبل الإطلاق التجاري).

## الصلاحيات الجديدة
`hr:read`, `hr:manage` (إنشاء/تعديل موظف)، `hr:salary:read` (رؤية الراتب)، `payroll:run` (تشغيل وترحيل الرواتب) — تُمنح لدور جديد `hr_manager` + admin فقط لـ `payroll:run`.

## معيار الإتمام
- إنشاء موظف، تشغيل payroll run لشهر، ترحيله → قيد واحد متوازن يظهر في `/api/journal` بالمبالغ الصحيحة
- محاولة قراءة الراتب بصلاحية `hr:read` بس (بدون `hr:salary:read`) → مرفوضة أو الحقل مخفي
- محاولة تعديل PayrollRun بعد الترحيل → مرفوضة
- اختبار عزل tenant على الموظفين والرواتب
- اختبار الفشل الجزئي (نفس منهج اختبار #12 من Phase 3): موظف ببيانات غير صالحة وسط الدفعة → رفض الدفعة كاملة، لا قيد جزئي
