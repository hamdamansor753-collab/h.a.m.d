# 04 - نموذج البيانات الأساسي (Core Data Model)

> هذا هو الـ schema الذي يُبنى أولًا، قبل أي موديول تجاري. أي موديول لاحق يعتمد على هذه الجداول.

```prisma
// ================= CORE: TENANCY =================

model Tenant {
  id            String   @id @default(uuid())
  name          String
  defaultLocale String   @default("ar-EG")
  country       String   // "EG" | "SA" | "AE" ... يحدد Tax Provider
  createdAt     DateTime @default(now())
  users         User[]
  accounts      Account[]
}

model User {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  email     String
  name      String
  locale    String   @default("ar-EG")
  roles     UserRole[]
  createdAt DateTime @default(now())

  @@unique([tenantId, email])
  @@index([tenantId])
}

model Role {
  id          String   @id @default(uuid())
  name        String   // "admin" | "accountant" | "sales_rep" ...
  permissions Permission[]
}

model Permission {
  id     String @id @default(uuid())
  key    String @unique // "invoice:create", "invoice:void" ...
  roles  Role[]
}

model UserRole {
  userId String
  roleId String
  user   User @relation(fields: [userId], references: [id])
  role   Role @relation(fields: [roleId], references: [id])

  @@id([userId, roleId])
}

// ================= CORE: LEDGER (القيد المزدوج) =================

model Account {
  // شجرة الحسابات (Chart of Accounts)
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  code      String   // "1000", "1000.01" ...
  nameKey   String   // مفتاح ترجمة، لا نص مباشر
  type      AccountType // ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
  parentId  String?
  parent    Account? @relation("AccountHierarchy", fields: [parentId], references: [id])
  children  Account[] @relation("AccountHierarchy")

  @@unique([tenantId, code])
  @@index([tenantId])
}

enum AccountType {
  ASSET
  LIABILITY
  EQUITY
  REVENUE
  EXPENSE
}

model JournalEntry {
  // كل حركة مالية في النظام تُسجَّل هنا - بدون استثناء
  id          String   @id @default(uuid())
  tenantId    String
  date        DateTime
  description String
  sourceModule String  // "accounting" | "inventory" | "pos" | "hr"
  sourceRefId String   // ID الفاتورة/الحركة الأصلية في الموديول المصدر
  lines       JournalLine[]
  createdAt   DateTime @default(now())

  @@index([tenantId, date])
}

model JournalLine {
  id             String       @id @default(uuid())
  journalEntryId String
  journalEntry   JournalEntry @relation(fields: [journalEntryId], references: [id])
  accountId      String
  account        Account      @relation(fields: [accountId], references: [id])
  debit          Decimal      @default(0)
  credit         Decimal      @default(0)

  @@index([accountId])
}
// قاعدة إلزامية على مستوى application logic:
// SUM(debit) === SUM(credit) لكل JournalEntry — يُتحقَق منها في service layer قبل الحفظ

// ================= CORE: i18n =================

model Translation {
  id     String @id @default(uuid())
  key    String // "invoice.title"
  locale String // "ar-EG" | "ar-SA" | "en"
  value  String

  @@unique([key, locale])
}
```

## ملاحظات إلزامية لـ GLM عند التنفيذ
1. **RLS**: بعد إنشاء الجداول، يجب كتابة migration منفصلة تُفعّل `ENABLE ROW LEVEL SECURITY` وتنشئ الـ policy على كل جدول به `tenantId` (راجع `03-architecture-decisions.md`)
2. **لا نصوص مباشرة**: أي حقل بيُعرض للمستخدم (مثل `nameKey`) يُخزَّن كـ **مفتاح ترجمة**، لا نص عربي/إنجليزي مباشر
3. **الديون المزدوجة**: أي service ينشئ `JournalEntry` يجب أن يرفض الحفظ إذا `SUM(debit) !== SUM(credit)`
4. كل migration جديد يُختبر على tenant تجريبي به بيانات، للتحقق من عدم تسرب بيانات عبر RLS
