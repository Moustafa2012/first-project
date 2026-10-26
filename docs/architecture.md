# البنية المعمارية

- **الواجهة:** Next.js (App Router) مع TypeScript، واتجاه RTL افتراضي.
- **الخلفية والمصادقة وقاعدة البيانات:** Supabase (PostgreSQL مع Row Level Security).
- **الأدوار:** مريض، طبيب، مسؤول.

## الكيانات
`profiles` ← `cases` ← `case_notes`، و`appointments` مرتبطة بالمريض والطبيب والحالة.

المخطط في `supabase/migrations/0001_init.sql`. سياسات الأمان الحالية للقراءة فقط وتحتاج استكمالاً قبل أي بيانات حقيقية.
