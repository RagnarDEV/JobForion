# ROADMAP — ما لم يُنفَّذ بعد (مرتّب بالأولوية)

## أداء/تكلفة
1. **بحث FTS5** لـ `jobs` (عنوان/شركة/موقع/مهارات/وصف) عبر جدول افتراضي + triggers + backfill مرة واحدة. الحل الحالي (تهريب + Rate limit + كاش) يبقي المسح الكامل عند فوات الكاش، لكنه محدود بعدد الوظائف النشطة. ملاحظة: تصدير D1 لا يدعم الجداول الافتراضية.
2. **إلغاء `visits`**: لوحة الأدمن ما زالت تقرأ `visits` بينما تسجّل التحليلات الجديدة في `analytics_daily`. توحيد المصدر يوفّر كتابة D1 لكل زيارة.
3. `home.js`: نقل تحميل البيانات (`renderMainHTML` أول 130 سطراً) إلى `pages/home/data.js`.

## SEO
4. مراجعة `applicantLocationRequirements` للوظائف البعيدة في Rich Results Test (محذوف عمداً حالياً).
5. `validThrough` يُحسب من `expires_at` (عقد 45 يوماً من آخر مشاهدة) — يُفضَّل تاريخ المصدر إن وُجد.
6. جودة الفهرسة: لوحة "thin content guard" تعرض الصفحات الأقل من `MIN_JOBS_FOR_INDEXING`.

## ميزات مقترحة لموقع وظائف عالمي
7. Saved searches + تنبيهات فورية (Web Push) بدل الملخص الدوري فقط.
8. "وظائف مشابهة" بالمهارات/الفئة بدل العشوائي.
9. Salary insights لكل فئة/دولة (تجميع من `salary_min_usd/max_usd`).
10. Company verified badge + صفحة شركة غنية (نبذة، مقابلات، سنة التأسيس).
11. تتبع "Apply click" لكل وظيفة وعرضه لصاحب الشركة.
12. صفحات هبوط برمجية: `/remote-<skill>-jobs-in-<country>` مع حد أدنى للمحتوى.
13. Multi-language (hreflang) بعد استقرار الإنجليزية.

## بنية
14. اختبارات وحدات لـ`sync.js` (Warm-up Governor / Rotating cap) مع مزوّد وهمي.
15. فصل `pages/admin/*` الكبيرة (settings, dashboard) إلى أجزاء كما حدث في `seo/`.
