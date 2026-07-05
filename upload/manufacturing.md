# modules/manufacturing.md — Manufacturing (BOM + Production Orders)

## يعتمد على
Core (Phase 0) + Accounting (Phase 1) + Inventory (Phase 2) — لازم تكون مكتملة ومُختبرة.

## النطاق
1. قائمة مكونات (Bill of Materials — BOM): كل منتج نهائي مكوّن من مواد خام بكميات محددة
2. أوامر إنتاج (Production Orders): تحويل مواد خام لمنتج نهائي، مع استهلاك المخزون وحساب تكلفة التصنيع
3. الربط بالمحاسبة: تكلفة الإنتاج (مواد + عمالة اختياريًا) تُحسب وتُسجَّل تلقائيًا كتكلفة المنتج النهائي

## المبدأ الأساسي: امتداد لـ Inventory الموجود، لا نظام مواز
موديول التصنيع **لا يخترع** نظام مخزون جديد — بيستخدم `Product`, `StockLevel`, `StockMovement` **الموجودين فعليًا** من Phase 2. الإضافة الوحيدة: نوع جديد من حركة المخزون (`PRODUCTION_CONSUME` و`PRODUCTION_OUTPUT`) وربط بينهم عبر أمر الإنتاج.

## نموذج البيانات الجديد (يُضاف لـ `04-data-model.md`)

```prisma
model BillOfMaterials {
  id              String   @id @default(uuid())
  tenantId        String
  finishedProductId String              // المنتج النهائي (Product الموجود من Phase 2)
  finishedProduct Product  @relation("BOMFinishedProduct", fields: [finishedProductId], references: [id])
  components      BOMComponent[]
  laborCostPerUnit Decimal @default(0)  // تكلفة عمالة تقديرية لكل وحدة منتج (اختياري، مبسّط)

  @@unique([tenantId, finishedProductId]) // منتج واحد له BOM واحدة فعّالة
  @@index([tenantId])
}

model BOMComponent {
  id        String @id @default(uuid())
  bomId     String
  bom       BillOfMaterials @relation(fields: [bomId], references: [id], onDelete: Cascade)
  rawMaterialProductId String        // مادة خام (Product موجود، بنفس جدول المنتجات)
  rawMaterial Product @relation("BOMRawMaterial", fields: [rawMaterialProductId], references: [id])
  quantityPerUnit Decimal            // الكمية المطلوبة من الخامة دي لإنتاج وحدة واحدة من المنتج النهائي
}

model ProductionOrder {
  id              String   @id @default(uuid())
  tenantId        String
  finishedProductId String
  quantity        Decimal            // الكمية المطلوب إنتاجها
  warehouseId     String             // المخزن اللي هيتم الاستهلاك والإنتاج منه/فيه
  status          ProductionOrderStatus @default(DRAFT)
  totalMaterialCost Decimal?         // يُحسب عند الترحيل
  totalLaborCost    Decimal?
  journalEntryId  String?
  createdAt       DateTime @default(now())

  @@index([tenantId])
}

enum ProductionOrderStatus {
  DRAFT
  COMPLETED   // تم الاستهلاك والإنتاج والترحيل المحاسبي — غير قابل للتعديل
  CANCELLED
}
```

## القاعدة الإلزامية: الترحيل الذري (completeProductionOrder)

نفس نمط الذرية من Phase 3 (posSale بعد الإصلاح) — **transaction واحدة شاملة**:

```
completeProductionOrder(id):
  1. جيب BOM الخاصة بالمنتج النهائي
  2. لكل مكوّن في BOM: احسب الكمية المطلوبة = quantityPerUnit × quantity (كمية أمر الإنتاج)
  3. تحقق كفاية كل خامة **قبل** أي استهلاك (فحص شامل لكل المكونات أولًا)
  4. لو أي خامة غير كافية → رفض الأمر كاملة، لا استهلاك جزئي (نفس مبدأ "لا نتيجة جزئية" من POS)
  5. لكل مكوّن: StockMovement(PRODUCTION_CONSUME) عبر stock-movement.service **الموجود** (نفس دالة الخصم الذرية من Phase 2/6)
  6. StockMovement(PRODUCTION_OUTPUT) للمنتج النهائي: زيادة المخزون بالكمية المُنتَجة
  7. حساب totalMaterialCost = SUM(quantityPerUnit × rawMaterial.costPrice × quantity) + totalLaborCost = laborCostPerUnit × quantity
  8. تحديث costPrice للمنتج النهائي (متوسط مرجّح، نفس منطق Phase 2)
  9. قيد محاسبي: مدين "مخزون منتج تام" (ASSET)، دائن "مخزون خامات" (ASSET) + "تكلفة عمالة مباشرة" (EXPENSE→ASSET المحوّلة) — عبر createJournalEntryOn الموجودة
  10. تحديث الحالة لـ COMPLETED
```

## الصلاحيات الجديدة
`manufacturing:read`, `manufacturing:manage` (BOM)، `production:run` (تنفيذ أوامر الإنتاج)

## معيار الإتمام
- تعريف BOM لمنتج (مثلاً: "كرسي" = 4 قوائم خشب + 2 كجم قماش)
- إنشاء أمر إنتاج لـ 10 كراسي → ترحيله → تحقق: خامات نقصت بالكميات الصحيحة (40 قائمة، 20 كجم قماش)، المنتج النهائي زاد بـ10، قيد متوازن، costPrice المنتج النهائي محدَّث
- محاولة إنتاج كمية تتطلب خامات أكتر من المتاح → رفض كامل قبل أي استهلاك (اختبار الفشل الجزئي، نفس منهج اختبار #12)
- اختبار عزل tenant على BOM وأوامر الإنتاج
