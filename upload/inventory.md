# modules/inventory.md — Inventory & Purchasing (Phase 2)

## يعتمد على
Core (Phase 0) + Accounting & Invoicing (Phase 1) — لازم تكونا مكتملتين ومُختبرتين.

## النطاق
1. منتجات ومخازن (multi-warehouse)
2. حركات مخزون (استلام، بيع، تحويل بين مخازن، تسوية)
3. أوامر شراء (Purchase Orders) من الموردين
4. الربط التلقائي بالـ Ledger: تكلفة البضاعة المباعة (COGS) عند البيع، وقيمة المخزون كأصل عند الاستلام

## نموذج البيانات الجديد (يُضاف لـ `04-data-model.md`)

```prisma
model Warehouse {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  nameKey   String
  isDefault Boolean  @default(false)
  stockLevels StockLevel[]

  @@index([tenantId])
}

model Product {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  sku         String
  nameKey     String
  costPrice   Decimal  @default(0)   // متوسط تكلفة الشراء — لحساب COGS
  sellPrice   Decimal  @default(0)
  stockLevels StockLevel[]

  @@unique([tenantId, sku])
  @@index([tenantId])
}

model StockLevel {
  id          String    @id @default(uuid())
  productId   String
  product     Product   @relation(fields: [productId], references: [id])
  warehouseId String
  warehouse   Warehouse @relation(fields: [warehouseId], references: [id])
  quantity    Decimal   @default(0)

  @@unique([productId, warehouseId])
}

model StockMovement {
  // كل حركة مخزون — سجل تاريخي غير قابل للتعديل (append-only)
  id           String   @id @default(uuid())
  tenantId     String
  productId    String
  warehouseId  String
  type         StockMovementType
  quantity     Decimal          // موجب دائمًا؛ الاتجاه يُحدَّد بـ type
  unitCost     Decimal          // تكلفة الوحدة وقت الحركة (لحساب COGS بدقة)
  sourceModule String           // "purchase" | "sales" | "adjustment" | "transfer"
  sourceRefId  String
  journalEntryId String?        // يُملأ لو الحركة أدت لقيد محاسبي (بيع/استلام)
  createdAt    DateTime @default(now())

  @@index([tenantId, productId])
}

enum StockMovementType {
  RECEIPT      // استلام من مورد
  SALE         // خروج للبيع
  TRANSFER_IN
  TRANSFER_OUT
  ADJUSTMENT   // تسوية (فرق جرد)
}

model PurchaseOrder {
  id            String              @id @default(uuid())
  tenantId      String
  supplierName  String
  date          DateTime
  status        PurchaseOrderStatus @default(DRAFT)
  lines         PurchaseOrderLine[]
  createdAt     DateTime            @default(now())

  @@index([tenantId])
}

enum PurchaseOrderStatus {
  DRAFT
  RECEIVED   // تم استلام البضاعة فعليًا — أنشأت StockMovement(RECEIPT) + قيد محاسبي
  CANCELLED
}

model PurchaseOrderLine {
  id              String        @id @default(uuid())
  purchaseOrderId String
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  productId       String
  quantity        Decimal
  unitCost        Decimal
  warehouseId     String
}
```

## القاعدة الإلزامية: لا تعديل مباشر على المخزون
**ممنوع تمامًا** أي تحديث مباشر لـ `StockLevel.quantity` من أي كود. كل تغيير في الكمية **لازم** يمر عبر إنشاء `StockMovement` أولًا، والـ service هو المسؤول عن تحديث `StockLevel` كنتيجة تابعة للحركة، في transaction واحدة. هذا يحافظ على تاريخ تدقيق كامل (audit trail) — بالضبط نفس فلسفة الـ Ledger مع القيود.

## الربط بالمحاسبة
- **استلام أمر شراء (`receivePurchaseOrder`)**:
  1. لكل سطر: إنشاء `StockMovement(RECEIPT)` + تحديث `StockLevel` (+= quantity) في نفس transaction
  2. إنشاء قيد محاسبي: مدين "المخزون" (ASSET) بإجمالي التكلفة، دائن "حسابات دائنة/الموردين" (LIABILITY) — عبر `createJournalEntryOn` الموجودة من Phase 0، **لا تُعاد كتابتها**
  3. تحديث `costPrice` للمنتج (متوسط تكلفة مرجّح - weighted average) — قابل للتبسيط في Phase 2 لمتوسط بسيط، مع ملاحظة صريحة إن FIFO/LIFO مؤجَّل لمرحلة لاحقة (نفس منطق سوقك مع FEFO في مشروع الأدوية السابق — التعقيد ده مش لازم من أول نسخة)
- **بيع منتج (تُستدعى من موديول POS/Sales لاحقًا، لكن الـ service تُبنى الآن)**:
  1. `StockMovement(SALE)` + تحديث `StockLevel` (-= quantity) — **رفض العملية لو الكمية المتاحة أقل من المطلوبة** (لا سماح بمخزون سالب إلا لو تنظيم مستقبلي يسمح بالطلب المسبق backorder)
  2. قيد محاسبي: مدين "تكلفة البضاعة المباعة COGS" (EXPENSE)، دائن "المخزون" (ASSET) — بقيمة `unitCost وقت الحركة`، **ليس** سعر البيع

## الصلاحيات الجديدة
`inventory:read`, `inventory:adjust`, `purchase:create`, `purchase:receive`

## معيار الإتمام
- إنشاء منتج، مخزن، أمر شراء Draft → استلامه → التحقق من: (أ) زيادة `StockLevel` الصحيحة (ب) قيد محاسبي متوازن في `/api/journal` (ج) `StockMovement` واحد بالضبط لكل سطر
- محاولة بيع كمية أكبر من المتاح → رفض فعلي (لا مخزون سالب)
- اختبار عزل tenant على المنتجات والمخازن (نفس منهج الفازات السابقة)
