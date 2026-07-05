# modules/saas-billing.md — SaaS Billing & Subscriptions (Phase 8)

## يعتمد على
Core (Phase 0) — هذا الموديول مختلف عن كل اللي قبله: مش نظام لعملاء الـ tenant (زي المحاسبة والمخزون)، ده نظام **أنت** (صاحب H.A.M.D) بتدير بيه اشتراكات عملائك (الـ tenants أنفسهم).

## النطاق
1. خطط اشتراك (Plans) بحدود استخدام مختلفة
2. اشتراك فعلي لكل tenant، بحالة (تجريبي/فعّال/متأخر/معلّق)
3. نقطة تنفيذ مركزية واحدة توقف الكتابة لو الاشتراك معلّق — **مش فحص متناثر في كل موديول**
4. تسجيل دفعات يدوي (Manual Payment Recording) — بدون تكامل بوابة دفع فعلي الآن (Paymob/Fawry شائعين في مصر، لكن التكامل الفعلي موديول منفصل لاحق، نفس فلسفة ETA placeholder)

## المبدأ الأساسي: نقطة تنفيذ واحدة، نفس فلسفة RLS
تمامًا زي ما عزل الـ tenant اتنفّذ في نقطة مركزية واحدة (`db.ts` Proxy) مش في كل route، إنفاذ حالة الاشتراك **لازم** يحصل في نقطة واحدة مركزية: دالة `requireActiveSubscription()` تُستدعى مرة واحدة في `withTenantContext` (نفس الدالة اللي بتلف كل الـ API routes من Phase 0) — **لا** فحص مُكرَّر في كل service.

## نموذج البيانات الجديد (يُضاف لـ `04-data-model.md`)

```prisma
// ملاحظة: هذه الجداول تخص منصة H.A.M.D نفسها، ليست tenant-scoped بنفس معنى باقي الجداول
// (تُدار من super-admin، لا من مستخدمي الـ tenant العاديين)

model Plan {
  id             String   @id @default(uuid())
  key            String   @unique // "starter" | "pro" | "enterprise"
  nameKey        String
  monthlyPrice   Decimal
  maxUsers       Int
  maxInvoicesPerMonth Int?        // null = غير محدود
  subscriptions  Subscription[]
}

model Subscription {
  id                String             @id @default(uuid())
  tenantId          String             @unique
  tenant            Tenant             @relation(fields: [tenantId], references: [id])
  planId            String
  plan              Plan               @relation(fields: [planId], references: [id])
  status            SubscriptionStatus @default(TRIALING)
  currentPeriodEnd  DateTime
  trialEndsAt       DateTime?
  createdAt         DateTime           @default(now())
}

enum SubscriptionStatus {
  TRIALING    // فترة تجريبية — كل شيء متاح
  ACTIVE      // مدفوع وفعّال
  PAST_DUE    // فات معاد الدفع، فترة سماح — لسه شغال لكن بتحذير
  SUSPENDED   // انتهت فترة السماح — قراءة فقط، لا كتابة
  CANCELLED   // ألغى الاشتراك نهائيًا
}

model PaymentRecord {
  // تسجيل يدوي من super-admin (تحويل بنكي/فوري/instapay إلخ) — ليس تكامل بوابة دفع فعلي
  id             String   @id @default(uuid())
  subscriptionId String
  amount         Decimal
  method         String   // "bank_transfer" | "instapay" | "cash" ...
  recordedByUserId String // super-admin سجّلها
  periodExtendedTo DateTime // الفترة الجديدة بعد الدفعة دي
  createdAt      DateTime @default(now())
}
```

## القاعدة الإلزامية: منطق إنفاذ الحالة

```typescript
function requireActiveSubscription(subscription: Subscription, method: 'GET' | 'POST' | 'PATCH' | 'DELETE') {
  if (subscription.status === 'TRIALING' || subscription.status === 'ACTIVE') return; // مسموح بالكامل
  if (subscription.status === 'PAST_DUE') return; // لسه مسموح، لكن الواجهة تعرض تحذير بارز
  if (subscription.status === 'SUSPENDED') {
    if (method === 'GET') return; // قراءة فقط مسموحة — العميل يقدر يشوف بياناته ويصدّرها
    throw new SubscriptionSuspendedError(); // أي كتابة تُرفض بـ 402 Payment Required
  }
  if (subscription.status === 'CANCELLED') throw new SubscriptionSuspendedError(); // لا وصول إطلاقًا
}
```

**لماذا القراءة فقط في SUSPENDED**: عميل متأخر في الدفع **لسه بياناته ملكه** — منعه الكامل من الوصول (حتى القراءة) ممكن يُعتبر احتجاز بيانات (data hostage) وهو سلوك سيء السمعة تجاريًا. القراءة تفضل متاحة، الكتابة تتوقف كحافز للدفع.

## حدود الاستخدام (Usage Limits)
- `maxUsers`: يُفحص في `user.service.ts` عند إنشاء مستخدم جديد (فحص إضافي بسيط، **ليس** جزء من `requireActiveSubscription` المركزية — لأنه حد كمي لا حالة اشتراك)
- `maxInvoicesPerMonth`: يُفحص في `invoice.service.ts` عند `createInvoice` (عدّاد شهري بسيط، لا حاجة لتعقيد إضافي في Phase 8)

## لوحة Super-Admin (مبسّطة)
- `/api/admin/tenants` (GET) — قائمة كل الـ tenants وحالة اشتراكهم (صلاحية جديدة خاصة: `platform:admin`، **منفصلة تمامًا عن RBAC العادي** — هذا وصول عابر لكل الـ tenants، فقط لك أنت كمالك المنصة)
- `/api/admin/payments` (POST) — تسجيل دفعة يدوية، بيمدد `currentPeriodEnd` ويرجّع الحالة لـ `ACTIVE`

## الصلاحيات الجديدة
`platform:admin` — **ليست جزء من RBAC العادي لأي tenant** — مستخدم خاص بيك أنت بس (owner المنصة)، يشتغل عبر اتصال منفصل يتجاوز الـ tenant scoping تمامًا (نفس فكرة "Super Admin connection" المذكورة في `03-architecture-decisions.md` القرار الأول).

## معيار الإتمام
- Tenant جديد يبدأ بـ `TRIALING` تلقائيًا (14 يوم افتراضي)
- تسجيل دفعة يدوية → `currentPeriodEnd` يتمدد، الحالة ترجع `ACTIVE`
- Tenant بحالة `SUSPENDED` → GET ناجح، POST/PATCH يرجع 402
- تجاوز `maxUsers` → رفض إنشاء مستخدم جديد برسالة واضحة
- اختبار: super-admin يقدر يشوف كل الـ tenants، مستخدم عادي في أي tenant **لا يقدر إطلاقًا** يوصل لـ `/api/admin/*` (لا حتى بصلاحية admin العادية بتاعته)
