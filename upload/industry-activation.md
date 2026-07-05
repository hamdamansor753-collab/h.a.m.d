# modules/industry-activation.md — Activity-Based Module Activation

## يعتمد على
Core (Phase 0) + `businessType` الموجود على Tenant (من Phase 7).

## المبدأ الأساسي
`businessType` بيتحكم في **إظهار/إخفاء** موديولات في الواجهة بس — **لا فرع كود في أي منطق تجاري** (نفس مبدأ Phase 7 بالظبط). الموديول لسه موجود وشغال في الـ backend لأي tenant، بس مش ظاهر في الـ nav لو مش مطلوب لنشاطه.

## نموذج البيانات (يُضاف)
```prisma
// خريطة ثابتة في الكود (مش جدول DB) — أي نشاط جديد = إضافة سطر هنا فقط
const INDUSTRY_MODULE_MAP: Record<string, string[]> = {
  general:     ['accounting', 'inventory', 'pos', 'crm', 'hr'],       // كل حاجة (افتراضي حالي)
  retail:      ['accounting', 'inventory', 'pos', 'crm', 'hr'],       // تجارة/تجزئة
  services:    ['accounting', 'crm', 'hr'],                            // خدمات — بدون مخزون/POS
  clinic:      ['accounting', 'crm', 'hr'],                            // عيادة — نفس خدمات + حسابات clinic من Phase 7
  manufacturing: ['accounting', 'inventory', 'crm', 'hr', 'manufacturing'], // تصنيع (بعد بناء الموديول في الخطوة القادمة)
};
```

## القاعدة الإلزامية: تحكم بصري بس، الـ API يفضل شغال
- الـ nav بيقرا `INDUSTRY_MODULE_MAP[tenant.businessType]` ويعرض بس التابات المسموحة
- **API routes نفسها تفضل شغالة بدون تغيير** — لو حد وصل لـ `/api/products` مباشرة (حتى لو تابه مخفي)، الطلب ينجح عادي. السبب: مرونة مستقبلية (عميل خدمات ممكن يحب يفعّل مخزون بسيط لاحقًا بدون ما نغيّر كود) + تبسيط (لا حاجة لطبقة تفويض إضافية معقدة الآن)
- خيار إضافي في شاشة الإعدادات (`/settings/modules`): يسمح للـ admin بتفعيل موديول مخفي يدويًا لو احتاجه (checkbox بسيط)، بيتسجل في جدول بسيط `TenantModuleOverride` لو موجود

## نموذج بسيط للتفعيل اليدوي (اختياري لكن مفيد)
```prisma
model TenantModuleOverride {
  tenantId   String
  moduleKey  String   // "inventory" | "pos" | ...
  enabled    Boolean
  @@id([tenantId, moduleKey])
}
```
لو موجود override لـ tenant معين، بياخد أولوية على `INDUSTRY_MODULE_MAP` الافتراضية.

## معيار الإتمام
- Tenant بـ `businessType=services` → لا يشوف تابات "المخزون"/"نقطة البيع"/"المشتريات" في الـ nav
- Tenant بـ `businessType=retail` → يشوف كل التابات (زي الوضع الحالي)
- Admin يقدر يفعّل "المخزون" يدويًا لـ tenant خدمات عبر `/settings/modules` → التاب يظهر فورًا
- أي API route قديم لسه شغال 100% حتى لو التاب مخفي (لا كسر رجعي)
- كل الاختبارات 1-35 لسه PASS
