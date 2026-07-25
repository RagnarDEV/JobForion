# JobForion — Cloudflare Worker (Remote Job Board)

لوحة وظائف عن بُعد، مبنية بالكامل على Cloudflare Workers + D1 (SQLite)، بدون أي خادم تقليدي،
ضمن حدود الخطة المجانية من Cloudflare.

> **⚠️ تنبيه تاريخي:** كان اسم المشروع سابقاً **JobNova**، وكان يعمل على نطاق مخصص
> (`jobnova.sryze.cc`) بالإضافة إلى نطاق Cloudflare الافتراضي. تم لاحقاً:
> 1. تغيير الاسم بالكامل إلى **JobForion**.
> 2. حذف النطاق المخصص نهائياً — الموقع يعمل الآن فقط على نطاق Cloudflare الافتراضي:
>    **`https://jobforion.manasa.workers.dev`**.
>
> جميع الروابط القديمة (`jobnova.manasa.workers.dev` و`jobnova.sryze.cc`) تُعاد توجيهها تلقائياً
> بكود **301 دائم** إلى النطاق الجديد عبر `RETIRED_HOSTS` في `src/index.js` — هذا ضروري لطلب
> "Change of Address" في Google Search Console ولمنع فهرسة محتوى مكرر إذا عاد أي نطاق قديم للعمل
> بالخطأ مستقبلاً.

---

## 🌐 مصدر الحقيقة الوحيد لاسم النطاق

كل رابط مطلق في الموقع (sitemap.xml, robots.txt, feed.rss, Open Graph tags, cache invalidation,
JSON-LD) يُشتق حصرياً من ثابت واحد:

```js
// src/config/constants.js
export const BASE_URL = 'https://jobforion.manasa.workers.dev';
```

**لماذا هذا مهم:** أي تغيير مستقبلي في الاسم أو النطاق يتطلب تعديل **سطر واحد فقط** في هذا الملف،
بدل البحث يدوياً في عشرات الملفات. تم فعلياً تصحيح 3 ملفات كانت لا تزال تستخدم روابط مكتوبة يدوياً
(hardcoded) بدل `BASE_URL`:

| الملف | ماذا كان يحدث قبل الإصلاح |
|---|---|
| `src/routes/pages.router.js` | صفحة الوظيفة المحذوفة (404/410) كانت تعرض "— JobNova" للزوار |
| `src/db/cleanup.js` | كان يحذف كاش sitemap من نطاق ميت (`jobnova.sryze.cc`) بدل النطاق الفعلي، فيتأخر تحديث الـ sitemap بعد كل تنظيف يومي |
| `src/routes/assets.router.js` | رابط `Sitemap:` داخل `robots.txt` كان مكتوباً يدوياً بدل الاعتماد على `BASE_URL` |

الثلاثة الآن يستوردون `BASE_URL` من `config/constants.js` مباشرة.

---

## هيكل المشروع (احترافي، مفصول بالكامل، قابل للتوسع)

```
jobforion/
├── wrangler.toml                    # main = "src/index.js", name = "jobforion"
├── package.json
├── .github/workflows/deploy.yml     # نشر تلقائي عند push إلى main
└── src/
    ├── index.js                     # نقطة الدخول الوحيدة — راوتر رفيع فقط
    │                                 # + RETIRED_HOSTS: إعادة توجيه 301 من النطاقات القديمة
    │
    ├── config/
    │   └── constants.js             # BASE_URL (مصدر الحقيقة الوحيد) + CATEGORY_META + CATEGORY_ORDER + FEATURED_COMPANIES
    │
    ├── assets/
    │   ├── favicon.js               # SVG + PNG/ICO (base64) + <head> icon links
    │   ├── manifest.js              # manifest.json الديناميكي
    │   └── icons.js                 # مجموعة أيقونات Lucide-style (SVG نقية، بلا مكتبة خارجية)
    │
    ├── providers/                   # مزوّدو الوظائف — 9 مزوّدين، كل واحد ملف مستقل
    │   ├── index.js                 # سجلّ المزوّدين — المكان الوحيد الذي يُعدَّل لإضافة مزوّد جديد
    │   ├── jobdatalake.js           # المزوّد الأساسي (api.jobdatalake.com)
    │   ├── linkedin.js              # LinkedIn Job Search API عبر RapidAPI
    │   ├── arbeitnow.js             # مجاني، بلا مفتاح
    │   ├── remotive.js              # مجاني، بلا مفتاح
    │   ├── jsearch.js               # JSearch عبر RapidAPI
    │   ├── adzuna.js                # يتطلب app_id:app_key معاً في حقل المفتاح
    │   ├── greenhouse.js            # لوحة وظائف شركة واحدة (المفتاح = board token، يدعم عدة توكنز)
    │   ├── lever.js                 # لوحة وظائف شركة واحدة (المفتاح = company slug)
    │   └── ashby.js                 # لوحة وظائف شركة واحدة (المفتاح = job board name)
    │
    ├── db/
    │   ├── schema.js                # ensureTable — إنشاء + ترحيل أعمدة ناقصة آمن (PRAGMA table_info)، لا يحذف بيانات أبداً
    │   ├── sync.js                  # موجّه المزامنة: مصادر نشطة → مزوّد → حفظ batch → تسجيل
    │   ├── cleanup.js               # تنظيف الوظائف منتهية الصلاحية/الراكدة (كرون يومي منفصل)
    │   └── analytics.js             # سجلّ المزامنة + تتبع الزوار (best-effort)
    │
    ├── auth/
    │   └── admin-auth.js            # كوكي أدمن موقّع بـ HMAC (بدون تخزين جلسات)
    │
    ├── styles/
    │   └── shared-css.js            # كل التصاميم/الألوان/الأنماط المشتركة
    │
    ├── components/
    │   ├── nav.js                   # الشريط العلوي + قائمة الجوال
    │   ├── footer.js                # الفوتر متعدد الأعمدة
    │   ├── post-job-modal.js        # نافذة "أضف وظيفة"
    │   ├── job-card.js              # بطاقة الوظيفة (شعار، وسوم، تصنيف تلقائي)
    │   └── ad-slot.js                # مصدر واحد لكل أماكن الإعلانات (Adsterra)
    │
    ├── layout/
    │   └── base-layout.js           # القالب العام (HTML shell) لكل صفحات SSR
    │
    ├── pages/
    │   ├── home.js                   # الصفحة الرئيسية (SPA) + SSR لأول صفحة وظائف
    │   ├── job-page.js               # صفحة الوظيفة المفردة
    │   ├── blog.js                   # فهرس + مقالة المدونة
    │   ├── static-pages.js           # الخصوصية / الشروط / الإخلاء
    │   ├── seo-pages.js              # categories / companies / skills / search
    │   ├── admin.js                  # تسجيل الدخول + تجميع لوحة التحكم
    │   └── admin/
    │       ├── shell.js               # القالب المشترك للوحة التحكم (سايدبار، dark mode، toast)
    │       ├── dashboard.js           # KPIs، صحة النظام، سجل المزامنة/التنظيف، مصادر API
    │       └── jobs.js                # إدارة الوظائف: بحث/فلترة/تحرير/حذف/تثبيت/كشف تكرار
    │
    ├── data/
    │   ├── blog-posts.js             # محتوى المدونة (ثابت)
    │   └── static-content.js         # نصوص الصفحات الثابتة
    │
    ├── routes/                       # كل ملف = معالج مسارات واحد، يُرجع Response أو null
    │   ├── assets.router.js          # /favicon.*  /manifest.json  /robots.txt
    │   ├── feed.router.js            # /sitemap.xml  /feed.rss
    │   ├── admin.router.js           # /admin/*  (كل الفروع محمية بـ try/catch)
    │   ├── pages.router.js           # /job/:id  /blog*  /privacy  /terms  /disclaimer  /
    │   ├── seo-pages.router.js       # /categories* /companies* /skills* /search/*
    │   └── api.router.js             # /api/*
    │
    └── lib/                          # مكتبة SEO البرمجية
        ├── entities.js                # اشتقاق companies/countries/cities/skills من D1 + escapeHtml + cleanDescription
        ├── schema.js                  # منشئات JSON-LD (JobPosting, Breadcrumb, ItemList...)
        ├── seo.js                     # بناء وسوم <meta>
        ├── metadata.js                # تجميع <head> الكامل
        ├── breadcrumbs.js              # HTML + JSON-LD لمسار التنقل
        ├── cache.js                    # غلاف Cache API لصفحات الدليل العامة
        └── sitemap.js                  # بناء sitemap.xml من بيانات D1 الحية
```

## لماذا هذا الهيكل ولا غيره

- **`src/index.js` رفيع فعلاً**: ~60 سطراً، مهمته الوحيدة تمرير الطلب لأول Router يتعرّف على
  المسار، بالإضافة إلى إعادة التوجيه من النطاقات المتقاعدة (`RETIRED_HOSTS`). لا HTML أو CSS أو
  استعلام D1 مباشر بداخله.
- **كل Router يُرجع `null` إن لم يكن المسار من اختصاصه** — نمط "chain of responsibility"، يجعل
  إضافة مسار جديد = Router جديد + سطر واحد في `index.js`.
- **الفصل بين `pages/` (تُنتج HTML) و`routes/` (تتعامل مع HTTP)**: كل دالة `render*` في `pages/`
  دالة نقية (pure) تقريباً — قابلة للاختبار بشكل مستقل تماماً.
- **`providers/` منفصل تماماً عن `db/sync.js`**: عقد موحد (`fetchJobs()` يُرجع مصفوفة موحدة، لا
  يكتب في القاعدة أبداً). إضافة مزوّد جديد = ملف جديد + سطر واحد في `providers/index.js`.
- **`config/constants.js` هو المصدر الوحيد لهوية الموقع**: الاسم، النطاق، التصنيفات، الشركات
  المميزة — كل شيء يتغير من مكان واحد بدل البحث في كل الملفات.
- **`components/ad-slot.js` منفصل عن الصفحات**: كل أماكن الإعلانات الخمسة عبر دالة واحدة
  `adSlot(id)`.
- **لوحة التحكم مقسّمة إلى shell + صفحات مستقلة** (`admin/shell.js`, `admin/dashboard.js`,
  `admin/jobs.js`) بدل ملف ضخم واحد — إضافة صفحة إدارة جديدة (شركات، مهارات، تصنيفات) لاحقاً لن
  يلمس الصفحات الموجودة.

## نظام المزامنة متعدد المصادر

`src/db/sync.js` لا يحتوي أي كود خاص بـ API معيّن:
1. يقرأ المصادر النشطة من `api_sources` + المفتاح الأساسي `env.API_KEY`
2. يرتّب المزوّدين الذين لا يحتاجون كلمات بحث (Arbeitnow، Greenhouse، Lever، Ashby) أولاً، لحماية
   ميزانية الطلبات الفرعية المحدودة (50 طلب/تنفيذ على الخطة المجانية)
3. يستدعي `fetchJobs()` الخاصة بالمزوّد المطابق من `providers/`
4. **لا يعيد المحاولة** على أخطاء 4xx الدائمة (402، 429، 401، 403)
5. **يتوقف عن أي مزوّد فور أول فشل** بدل تكرار نفس الخطأ لكل كلمة بحث
6. يحفظ الوظائف عبر `env.DB.batch()` (دفعات من 25) — إدراج جديد ثم تحديث ما هو موجود، مع تحديث
   `updated_at` / `expires_at` وإعادة `status` إلى `active` لكل وظيفة لا تزال موجودة عند المصدر
7. يسجّل تفصيلاً لكل مزوّد (عدد الوظائف، المدة، الأخطاء مُجمَّعة لا مكررة) في `sync_logs`

## دورة حياة الوظائف والتنظيف اليومي

`src/db/cleanup.js` يعمل عبر كرون منفصل (`0 3 * * *`) عن كرون المزامنة، ويحذف وظيفة عندما:
- تجاوز `expires_at` (مهلة محسوبة تلقائياً: `created_at` + 45 يوماً، تُمدَّد مع كل مزامنة تجدها)
- أو مضى أكثر من 30 يوماً دون تحديث (`updated_at`) — أي أن المصدر توقف عن إرجاعها

كلا الشرطين يُسجَّلان في `cleanup_logs` مع تفصيل السبب، ويظهران في `/admin` تحت "Recent Cleanup
History". فور انتهاء التنظيف، يُحذف كاش `sitemap.xml` فوراً (بدل انتظار TTL الساعة) حتى لا يستمر
Google في رؤية روابط لوظائف حُذفت فعلياً.

لوحة `/admin` تعرض هذا كله تحت "Recent Sync History" و"Recent Cleanup History" — أي عطل ظاهر فوراً
برسالة الخطأ الحقيقية.

## الإعلانات (`src/components/ad-slot.js`)

خمسة أماكن معدّة مسبقاً، مفعّلة حالياً عبر Adsterra:

| المعرّف (id) | المكان |
|---|---|
| `homepage-results-top` | أعلى قائمة الوظائف — الصفحة الرئيسية |
| `job-detail-inline` | داخل صفحة الوظيفة، بعد الوصف (320×50) |
| `job-detail-footer` | أسفل صفحة الوظيفة |
| `blog-index-top` | أعلى فهرس المدونة |
| `blog-article-footer` | أسفل كل مقالة |

لتغيير شبكة الإعلانات: الصق كود الشبكة كقيمة لنفس المعرّف داخل خريطة `ADS` في
`src/components/ad-slot.js` فقط — لا حاجة لتعديل أي صفحة.

## قاعدة البيانات

الجداول: `jobs`, `subscribers`, `sync_logs`, `visits`, `api_sources`, `job_postings`,
`hidden_companies`, `cleanup_logs`. `ensureTable()` في `src/db/schema.js` لا يحتوي أي `DROP TABLE`
مطلقاً، ويستخدم `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` لترحيل أي عمود ناقص بأمان — دون حذف
أو لمس أي صف موجود. المزامنة تستخدم `INSERT OR IGNORE` على عمود `url` الفريد.

**ملاحظة أمان معروفة ومُغلقة:** نقطة النهاية `/api/migrate` (التي كانت قادرة على تنفيذ
`DROP TABLE`) حُذفت نهائياً من الكود — لا يجوز إعادتها أبداً.

## الأمان (XSS وما إلى ذلك)

- كل حقل قادم من مصدر خارجي غير موثوق (وظائف مسحوبة من LinkedIn/JobDataLake، أو مُرسَلة عبر "أضف
  وظيفة") يمر عبر `escapeHtml()` (`src/lib/entities.js`) قبل إدراجه في أي قالب HTML — مطبّق مركزياً
  في `base-layout.js` بحيث لا تحتاج كل صفحة لتذكّره بنفسها.
- `safeJsonLd()` (`src/pages/job-page.js`) يمنع كسر وسم `<script>` الخاص بـ JSON-LD عبر عنوان وظيفة
  خبيث يحتوي `</script><script>`.
- كوكي الأدمن HMAC-signed (`src/auth/admin-auth.js`) — بدون تخزين جلسات على الخادم.

## النشر

### أ) أسرار الـ Worker (مرة واحدة، من جهازك):
```bash
wrangler secret put API_KEY
wrangler secret put ADMIN_PASSWORD
```

### ب) أسرار GitHub Actions (Settings → Secrets and variables → Actions):
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### ج) النشر:
```bash
git add -A
git commit -m "JobForion: update"
git push origin main
```

Cloudflare Wrangler يجمّع (bundle) كل ملفات `src/**/*.js` تلقائياً عبر esbuild — لا حاجة لأي إعداد
بناء إضافي، ولا تغيير مطلوب في `wrangler.toml`.

## ملاحظة لمن يعمل على خطة Cloudflare المجانية

الخطة المجانية تحدد **50 طلباً فرعياً فقط** لكل تنفيذ واحد للـWorker. النظام مصمم للتعامل مع هذا
(ترتيب المزوّدين، عدم إعادة المحاولة على الأخطاء الدائمة، التجميع عبر `batch()`)، لكن التوسّع الكبير
مستقبلاً قد يتطلب الترقية لخطة Cloudflare المدفوعة (1000 طلب فرعي).

## التحقق بعد النشر

- `/sitemap.xml` → يبدأ بـ `<?xml` مباشرة بدون أي حرف قبله، ويحتوي `/companies/...`,
  `/skills/...`, `/categories/...`
- `/robots.txt` → يحتوي `Sitemap: https://jobforion.manasa.workers.dev/sitemap.xml` (مُشتق من
  `BASE_URL`، وليس مكتوباً يدوياً)
- `/companies`, `/categories`, `/skills`, `/search/python` → 200 بدون خطأ
- `/job/123` → اسم الشركة، المهارات، والتصنيف روابط قابلة للنقر
- زيارة رابط وظيفة محذوفة (مثال: `/job/1` بعد حذفها) → تعرض العنوان **"— JobForion"** وليس أي اسم
  قديم
- `/admin` بدون كوكي → نموذج تسجيل الدخول (وليس لوحة التحكم)
- `/admin` بعد الدخول → "Recent Sync History" و"Recent Cleanup History" يعرضان تفاصيل حقيقية
- زيارة `jobnova.manasa.workers.dev` أو `jobnova.sryze.cc` (إن كانا لا يزالان يشيران لنفس حساب
  Cloudflare) → إعادة توجيه 301 فورية إلى `jobforion.manasa.workers.dev`

## على الأفق (مؤجل من جلسات سابقة — "تطوير لوحة التحكم")

- صفحات إدارة الشركات، المهارات، والتصنيفات في `/admin` (Phase 3)
- مراقبة SEO مستمرة ومتابعة طلب إعادة النظر في Google Search Console إن لزم
- إمكانية إضافة مزوّدي وظائف جدد عبر `/admin` (لا يتطلب إعادة نشر — يعتمد على جدول `api_sources`)
