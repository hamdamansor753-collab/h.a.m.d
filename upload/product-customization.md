# modules/product-customization.md — Branding & Business Templates (Phase 7)

## يعتمد على
Core (Phase 0) — يلمس `Tenant` بشكل تراكمي، ويؤثر على كل الموديولات بصريًا فقط (لا منطق تجاري).

## النطاق
1. تخصيص هوية بصرية لكل tenant (شعار، ألوان، تصميم فاتورة) — الفرق بين "نظام عام" و"منتج SaaS فعلي"
2. قوالب أنشطة تجارية (Business Type Templates) — بذرة حسابات وصلاحيات مبدئية تختلف حسب نوع النشاط، بديل عملي لـ "50+ نشاط" اللي عند دفترة بدون الحاجة لبناء نظام قوالب معقد من أول نسخة

## المبدأ الأساسي: التخصيص بصري بس، لا فرع كود
**ممنوع تمامًا** أي `if (tenant.businessType === 'restaurant')` منتشر في الكود التجاري (invoice.service, payroll.service..). التخصيص حسب النشاط يظهر في **مرحلة الإعداد الأولي فقط** (seed مخصص لكل tenant جديد)، مش في منطق التشغيل اليومي. بعد الإعداد، كل الأنشطة التجارية بتستخدم **نفس الكود بالضبط** — الفرق بس في البيانات الابتدائية (شجرة حسابات، أسماء افتراضية).

## نموذج البيانات الجديد (يُضاف لـ `04-data-model.md`)

```prisma
// تعديل تراكمي على Tenant الموجودة
model Tenant {
  // ... الحقول الموجودة
  businessType String @default("general") // "general" | "retail" | "restaurant" | "clinic" | "services"
  brandSettings BrandSettings?
}

model BrandSettings {
  tenantId      String  @id
  tenant        Tenant  @relation(fields: [tenantId], references: [id])
  logoUrl       String?
  primaryColor  String  @default("#0f172a")  // navy افتراضي (هوية H.A.M.D نفسها)
  accentColor   String  @default("#06b6d4")  // cyan افتراضي
  invoiceFooterText String?                  // نص مخصص أسفل الفاتورة (شروط، أرقام تواصل)
  updatedAt     DateTime @updatedAt
}
```

## قاعدة الألوان: افتراضي H.A.M.D، تخصيص اختياري
لو `BrandSettings` غير موجودة لـ tenant، الواجهة تستخدم ألوان H.A.M.D الافتراضية (navy/cyan من `01-brand-identity.md`) — **لا تعطيل أو كسر لأي واجهة موجودة**. التخصيص إضافة اختيارية فوق نظام موجود، مش استبدال.

## قوالب الأنشطة التجارية (Business Type Seed Templates)
كل `businessType` بيجيب معاه **شجرة حسابات ابتدائية مختلفة شوية** (مش هيكل مختلف، بس حسابات إضافية شائعة للنشاط ده) + أسماء افتراضية معقولة:

| النشاط | حسابات إضافية نمطية | ملاحظة |
|---|---|---|
| `retail` (تجارة تجزئة) | حساب "خصومات مبيعات" | الافتراضي الحالي تقريبًا |
| `restaurant` (مطعم) | "هالك مطبخ" (Kitchen Waste) كحساب EXPENSE منفصل عن COGS العادي | |
| `clinic` (عيادة/خدمات طبية) | "رسوم استشارة" كحساب REVENUE منفصل عن "خدمات" العام | مفيد لخبرتك في معامل الأسنان لاحقًا لو حبيت تربطها |
| `services` (خدمات عامة) | بدون حسابات إضافية عن `general` | النموذج الافتراضي الحالي كافٍ |

**تنفيذ فعلي**: دالة `getBusinessTypeSeedExtras(businessType)` ترجع مصفوفة حسابات إضافية، تُستخدم في **onboarding tenant جديد فقط** (لا تعديل على الـ seed العام الحالي بتاع الاختبارات).

## API وواجهة
- `/api/tenant/branding` (GET/PATCH) — صلاحية `tenant:manage` (جديدة، admin فقط)
- شاشة إعدادات: رفع شعار (تخزين كـ URL — تكامل رفع ملفات فعلي كـ S3/Supabase Storage مؤجَّل لموديول لاحق، Phase 7 يقبل URL مباشر بس)
- منتقي ألوان (color picker) بسيط، معاينة فورية للفاتورة بالألوان الجديدة

## الصلاحيات الجديدة
`tenant:manage` — admin فقط.

## معيار الإتمام
- Tenant جديد بـ `businessType=clinic` → شجرة حساباته فيها "رسوم استشارة" تلقائيًا
- تحديث `BrandSettings` لـ tenant → الفاتورة (PDF/UI) تعرض الشعار والألوان الجديدة فورًا
- Tenant بدون `BrandSettings` → لسه شغال بألوان H.A.M.D الافتراضية بدون أي كسر
- اختبار عزل tenant على `BrandSettings` (tenant A مايقدرش يعدّل برندنج tenant B)
