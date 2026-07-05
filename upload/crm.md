# modules/crm.md — CRM (Phase 5)

## يعتمد على
Core (Phase 0) + Accounting (Phase 1) — لربط العملاء بالفواتير الموجودة.

## النطاق
1. سجل عملاء مركزي (Customer) — بدل الاعتماد على `customerName` كنص حر في الفواتير
2. مواعيد وتذكيرات مرتبطة بالعميل
3. سجل تفاعل مبسّط (Activity Log) — يُنشأ تلقائيًا عند كل فاتورة/بيع POS للعميل

## المبدأ الأساسي: تعديل تراكمي على Invoice، لا تعديل جوهري
الفواتير الموجودة من Phase 1/3 مربوطة بـ `customerName` (نص حر). الحل: إضافة `customerId` **اختياري** على `Invoice` (لا نلغي `customerName`، نخليه fallback لعميل غير مسجّل — بيع نقدي عابر مثلًا لا يحتاج تسجيل عميل كامل).

## نموذج البيانات الجديد (يُضاف لـ `04-data-model.md`)

```prisma
model Customer {
  id           String     @id @default(uuid())
  tenantId     String
  tenant       Tenant     @relation(fields: [tenantId], references: [id])
  name         String
  phone        String?
  email        String?
  invoices     Invoice[]
  appointments Appointment[]
  activities   ActivityLog[]
  createdAt    DateTime   @default(now())

  @@index([tenantId])
}

// تعديل تراكمي على Invoice الموجودة (لا تعديل جوهري)
model Invoice {
  // ... الحقول الموجودة من Phase 1/3
  customerId String?
  customer   Customer? @relation(fields: [customerId], references: [id])
}

model Appointment {
  id         String            @id @default(uuid())
  tenantId   String
  customerId String
  customer   Customer          @relation(fields: [customerId], references: [id])
  scheduledAt DateTime
  note       String?
  status     AppointmentStatus @default(SCHEDULED)
  reminders  Reminder[]

  @@index([tenantId, scheduledAt])
}

enum AppointmentStatus {
  SCHEDULED
  COMPLETED
  CANCELLED
  NO_SHOW
}

model Reminder {
  id            String   @id @default(uuid())
  appointmentId String
  appointment   Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  dueAt         DateTime
  sent          Boolean  @default(false)
  channel       String   // "in_app" فقط في Phase 5 — SMS/WhatsApp موديول لاحق مخصص للتكامل الخارجي

  @@index([dueAt, sent])
}

model ActivityLog {
  // سجل تفاعل تلقائي — append-only، لا تعديل بعد الإنشاء
  id         String   @id @default(uuid())
  tenantId   String
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  type       String   // "invoice_created" | "appointment_scheduled" | ...
  refId      String   // ID الفاتورة/الموعد المرتبط
  createdAt  DateTime @default(now())

  @@index([tenantId, customerId])
}
```

## القاعدة الإلزامية: ActivityLog تلقائي، لا يدوي
عند إنشاء فاتورة بـ `customerId` محدد (من Phase 1 أو POS)، أو عند حجز موعد، **يُنشأ `ActivityLog` تلقائيًا** كجزء من نفس الـ transaction — لا endpoint منفصل لإنشائه يدويًا (تجنبًا لتضارب أو نسيان تسجيله).

## التنبيهات (Reminders) — نطاق Phase 5 مبسّط
Phase 5 يبني **البنية فقط**: جدول `Reminder` + endpoint يرجّع "التذكيرات المستحقة الآن" (`dueAt <= now() AND sent = false`). **لا** إرسال SMS/WhatsApp/Email فعلي — ده تكامل خارجي (Twilio أو مشابه) يحتاج موديول منفصل بعدين. الـ endpoint دلوقتي بيرجّع القائمة بس عشان تظهر كإشعار داخل التطبيق (in-app notification)، مطابق لعمود `channel: "in_app"`.

## الصلاحيات الجديدة
`crm:read`, `crm:manage` (عملاء + مواعيد)

## معيار الإتمام
- إنشاء عميل → حجز موعد له → فاتورة مربوطة به → التحقق: `ActivityLog` بسجلين (فاتورة + موعد) تلقائيًا بدون استدعاء يدوي
- endpoint التذكيرات المستحقة يرجّع فقط المواعيد اللي `dueAt` فاتت واللي `sent=false`
- اختبار عزل tenant على العملاء والمواعيد
- التحقق إن فاتورة بدون `customerId` (بيع عابر) لسه تعمل بشكل طبيعي (الحقل اختياري فعليًا، لا كسر لأي كود Phase 1/3 موجود)
