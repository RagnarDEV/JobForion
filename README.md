# JobForion

منصة وظائف عن بُعد مبنية على **Cloudflare Workers ES Modules + D1 (SQLite) + R2** مع توليد SSR HTML. لا تعتمد على خادم تقليدي؛ نقطة الدخول الوحيدة هي `src/index.js`، وتُدار الواجهة والمحتوى من وحدات مستقلة داخل `src/pages` و`src/components` و`src/lib`.

- **الموقع:** <https://jobforion.com>
- **المستودع:** `RagnarDEV/JobForion` على GitHub
- **النطاق canonical:** `BASE_URL` في `src/config/constants.js`
- **النطاقات المتقاعدة:** تُعاد توجيهها 301 من خلال `RETIRED_HOSTS` في `src/index.js`

## خريطة المشروع

```text
jobforion/
├─ wrangler.toml                ← Worker + D1 + R2 + Workers AI + Cron واحد + Observability
├─ package.json                 ← npm test = smoke + 6 اختبارات (منها sync-budget)
├─ .github/workflows/deploy.yml ← verify (audit + tests) ثم deploy
├─ scripts/audit.mjs            ← فحص syntax + import/export + الملفات اليتيمة (node scripts/audit.mjs [--strict])
├─ tests/                       ← smoke.test.mjs (يشغّل الـWorker الحقيقي على SQLite تحاكي D1) + اختبارات الوحدات
│  └─ helpers/                  ← d1-shim · read-schema · read-source
├─ docs/                        ← EXECUTION_PLAN · CHANGELOG · ROADMAP · تقارير التدقيق القديمة
└─ src/
   ├─ index.js                  ← نقطة دخول رفيعة: توزيع الطلب فقط
   ├─ app/                      ← security-headers · fallback-error · cron (موزّع المهام المجدولة)
   ├─ config/  data/  layout/  styles/  assets/  auth/  providers/
   ├─ components/               ← nav · footer · job-card · company-card · ad-slot · affiliate-block · النماذج · rich-editor
   ├─ db/
   │  ├─ schema.js              ← بوابة SCHEMA_VERSION + الترحيل المتقطّع (ensureAllSchema)
   │  ├─ schema/                ← state · migration-kit · core-tables · ai-tables · account-tables
   │  └─ sync.js · cleanup.js · telemetry.js (سجل المزامنة + الزيارات)
   ├─ routes/
   │  ├─ pages · seo-pages · auth · user · company · feed · assets · affiliate.router.js (/go/:slug) · admin.router.js
   │  ├─ api.router.js          ← موزّع فقط
   │  ├─ api/                   ← analytics · monetization · user · forms · jobs · system (+ shared)
   │  └─ admin/                 ← 21 sub-router (منها affiliate.router.js)
   ├─ pages/
   │  ├─ home.js                ← تجميع الصفحة الرئيسية
   │  ├─ home/                  ← styles · client-script
   │  ├─ seo-pages.js           ← barrel
   │  ├─ seo/                   ← shared · jobs · categories · companies · countries · skills · search
   │  └─ job-page · blog · auth · pricing · user-dashboard · company-dashboard · admin/ (21)
   └─ lib/                      ← مقسّمة حسب النطاق
      ├─ affiliate/   affiliate (بيانات + تتبع + تحويلات) · placement (HTML لكل موضع)
      ├─ jobs/        related-jobs (وظائف مشابهة محدودة الكلفة) · salary · salary-tier · hot-pay · skill-extraction · saved-jobs · applications · job-alerts · job-card-styles
      ├─ directory/   entities · directory-overrides · geo-data · country-flags
      ├─ companies/   companies · company-logos · logo-proxy
      ├─ content/     blog-cms · pages-cms · homepage-* · nav-buttons · categories · category-icons · ad-slots · blog-automation/
      ├─ ai/          ai-service · ai-control-center · admin/career/content/job-intelligence · matching
      ├─ analytics/   events · tracker · tag
      ├─ seo/         jsonld · meta · breadcrumbs · sitemap
      ├─ platform/    config-memo · settings · cache · rate-limit · observability · activity-log · html-sanitizer · search-utils · rotation · write-budget · safe-redirect
      │               site-cache (طبقة التجميع المحسوبة مسبقاً — راجع docs/CHANGELOG.md) · job-window (استعلامات مقيَّدة)
      ├─ accounts/    session · csrf · password · permissions · tokens · email · users
      └─ monetization/core.js
```

**قاعدة إضافة ميزة جديدة:** ملف صفحة في `pages/<نطاق>/`، منطق بيانات في `lib/<نطاق>/`، مسار في راوتر واحد، مهمة مجدولة بسطر واحد في `src/app/cron.js`، مزوّد وظائف بسطر واحد في `src/providers/index.js`. لا يُعدَّل `index.js` إلا لإضافة راوتر جديد.

## التشغيل ودورة الطلب

يمر الطلب عبر `src/index.js` الذي يطبّق security headers، ثم يمرر المسار إلى الراوتر المتخصص. تُعالج طلبات assets وR2 وlogo proxy قبل bootstrap الخاص بـD1 لتقليل كلفة الطلبات التي لا تحتاج قاعدة بيانات. أما الصفحات والحسابات والإدارة والمحتوى فتستخدم schema bootstrap الآمن والمتكرر داخل `src/db/schema/ai-tables.js`.

تعمل **مهمة Cron واحدة** `*/30 * * * *` (الخطة المجانية تسمح بخمس مهام لكل حساب) وتوزّعها `src/app/cron.js` حسب وقت UTC: **المزامنة كل 3 ساعات** عند `:00` للساعات 00/03/06/09/12/15/18/21؛ `:30` كل ساعة ← تجميع التحليلات (وعند 03:30 الصيانة اليومية، وعند 09:30 توليد المدونة)؛ `08:00` ← تنبيهات الوظائف. كل استدعاء ينفّذ مجموعة مهام واحدة فقط حفاظاً على حد 50 subrequest.

### المزامنة (db/sync.js) — توزيع عادل + ميزانية كتابة
- **قراءة قبل الكتابة:** الوظيفة غير المتغيّرة لا تُكتب إطلاقاً (بصمة `content_hash`)؛ تُجدَّد تواريخها فقط كل `sync_touch_interval_days` (10 أيام). الوظيفة المعدّلة من الأدمن (`content_hash='manual'`) لا تُستبدل.
- **ميزانية كتابة يومية:** `sync_daily_write_budget` (55,000 صف افتراضياً من حد D1 البالغ 100,000) تُوزَّع على الدورات المتبقية في اليوم؛ الوظائف الجديدة الزائدة تُؤجَّل للدورة التالية.
- **تنوّع المصادر:** مؤشّر دوران (`_sync_cursor`) يضمن أن كل مصدر يأخذ دوره، ويُقطع عند أول مصدر لا تتسع له الميزانية ليبدأ منه الدور التالي؛ وعند تجاوز سقف الوظائف تُخلط الوظائف بالتناوب بين الشركات (`interleaveByCompany`) ثم تُؤخذ نافذة دوّارة تتقدّم مرة لكل دورة.
- حُذفت ثلاثة فهارس زائدة من `jobs` (بادئات لفهارس مركّبة) فصار إدخال/حذف الوظيفة أرخص بنحو 18%.

## البيانات والتخزين

يستخدم D1 جداول الوظائف والحسابات والشركات والمحتوى والإدارة. كل تعريفات AI الأربعة موجودة مركزيًا في `ensureAiTables()` داخل `src/db/schema/ai-tables.js`، مع `CREATE TABLE IF NOT EXISTS` وفهارس مناسبة، بينما تستدعي وحدات الميزات helper المركزي بدل امتلاك runtime DDL مستقل.

صور الشعارات والأغلفة تُرفع إلى binding `COMPANY_ASSETS` في R2 بعد التحقق من MIME والـsignature والحجم الأقصى 2MB. عند نجاح ربط الكائن في D1 يُحذف الكائن السابق، وعند فشل الربط يُحذف الكائن الجديد. يعمل `/r2-asset/*` كمسار fallback، ويقبل فقط مفاتيح R2 المطابقة للنمط المسموح. يمكن ضبط `R2_PUBLIC_BASE_URL` لاستخدام نطاق R2 أو النطاق المخصص مباشرة.

## Workers AI والميزات الحالية

يستخدم المشروع Workers AI فقط عبر binding باسم `AI` وبالنموذج الثابت:

```text
@cf/zai-org/glm-4.7-flash
```

توجد خدمة مركزية في `src/lib/ai-service.js` لتوحيد model ID وservice/prompt versions والتحقق من المدخلات وحدود البيانات وprompt boundary والتطبيع الآمن للأخطاء وtelemetry الخفيف. لا تصل الأسرار أو binding إلى المتصفح، ولا تُستدعى AI تلقائيًا في homepage أو listing أو search أو job detail أو company أو auth أو feed أو cron. يدعم `site_settings` الآن kill switch عامًا `ai_enabled` ومفاتيح مستقلة لـfoundation smoke وJob Intelligence وMatching وCareer Assistant وContent Intelligence وAdmin Assistant؛ كل مفتاح يُفحص مركزيًا قبل استدعاء binding.

الميزات المطبقة هي: **Job Intelligence** عند الطلب من محرر الوظيفة الإداري، **Matching** داخل حساب المستخدم، **Career Assistant** للمستخدم المصادق عليه، **Admin Assistant** للقراءة التشغيلية فقط، **Content Intelligence** للمراجعة التحريرية دون نشر تلقائي، و**AI Control Center** للعرض والمراقبة فقط. لا يملك أي مساعد صلاحية تنفيذ sync أو cleanup أو حذف أو نشر أو إرسال بريد أو تغيير إعدادات حساسة تلقائيًا.

## Design System وAppearance Theme

يستخدم القالب العام `src/layout/base-layout.js` وhomepage renderer Theme Resolver مركزيًا من `src/lib/settings.js`. مفاتيح `appearance_*` وCompany Card وNavigation محفوظة في `site_settings` وتخضع لـallow-list وvalidation قبل الكتابة: ألوان hex، خطوط من قائمة curated، كثافة layout، radius، عرض container، مسافات البطاقات، حجم الشعار، ارتفاع header، CTA label، الظل، وسلوك hover. عند غياب الإعداد أو فساده يعود الموقع تلقائيًا إلى defaults الآمنة، وتُحقن القيم كـCSS variables داخل نفس renderers؛ وتظل Theme/Appearance controls نفسها مقيدة ولا تستقبل arbitrary CSS أو HTML أو JavaScript.

صفحة `/admin/settings` تتضمن Appearance Theme وCompany Card وNavigation وHomepage Copy وSEO & Indexing sections. توجد live previews لواجهة theme وCompany Card، مع أزرار reset مستقلة لـappearance وcomponent controls وhomepage copy. كما أن `job-card-css.js` و`shared-css.js` و`company-card.js` تستخدم tokens المركزية في السطوح والـradius والمسافات، بينما بقي `job-card-styles.js` مصدر التحكم التفصيلي المنظم حسب tier. ويظل `homepage_sections` مسؤولًا عن التفعيل والترتيب للأقسام built-in الحالية، بينما تتيح `homepage_custom_sections` إنشاء أقسام Homepage مخصصة وتعديلها وترتيبها وتعطيلها وحذفها. لا يتحول ذلك إلى page builder حر داخل الموقع؛ فالكود الخام متاح فقط داخل محرر القسم أو الصفحة ويُعرض داخل iframe sandbox معزول موضح أدناه.

## الأمان

تستخدم صفحات الإدارة admin cookie موقعة، ويطبق `src/routes/admin.router.js` حارس CSRF مركزيًا على كل admin POST قبل وصوله إلى sub-router. يصدر shell cookie قصيرة العمر للـCSRF ويحقن token في form submissions وadmin fetch requests. تبقى التحققات المحلية في website router كدفاع إضافي لمسارات Appearance وhomepage وcard styles. تستخدم صفحات الحساب جلسات HttpOnly وSecure وSameSite مع ownership checks. توجد rate limits تطبيقية للمسارات الحساسة، إضافة إلى حدود إدخال للـAPI وpagination. روابط التقديم الخارجية تمر عبر `safeExternalUrl()` ولا تُقبل `javascript:` أو `data:` أو protocol-relative URLs.

يضع Worker security headers موحدة تشمل `X-Content-Type-Options` و`X-Frame-Options` و`Referrer-Policy` و`Permissions-Policy` وHSTS وCSP. تسمح CSP بالـinline scripts/styles المطلوبة حاليًا للواجهة SSR، لكنها لا تسمح بمضيفات صور عامة عشوائية؛ الشعارات الخارجية تُجلب عبر Worker logo proxy أو R2 الموثق.

سجلات النشاط لا تخزن نصوص prompts أو الإجابات أو profile data، وتم تقليل PII من سجلات الحساب إلى معرّفات داخلية. يعرض Control Center الآن AI Activity (7d) وchart حسب feature من `admin_activity_log` فقط عندما توجد سجلات حقيقية؛ لا تُخترع usage statistics. كما أن Hot KPI الإداري يستخدم نفس سياسة HOT PAY المركزية للنطاقات وmin/max-only. يتحكم `seo_indexing_enabled` في meta robots للصفحات العامة، مع بقاء sitemap متاحًا للفحص التشغيلي. عند حذف الحساب تُطهّر محادثات Career Assistant ونتائج Matching والجلسات قبل إكمال soft-delete للهوية.

## الإعداد المحلي

```bash
npm install
npm run dev
```

الأسرار المطلوبة بحسب الميزة تُضبط خارج Git. لا تُحفظ API keys أو كلمات المرور أو ملفات `.dev.vars` في المستودع. من أمثلة إعدادات النشر:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put R2_PUBLIC_BASE_URL
```

binding الإنتاج موجود في `wrangler.toml`:

```toml
[ai]
binding = "AI"
remote = true
```

لا تُحفظ كلمات المرور أو API tokens أو ملفات `.dev.vars` في المستودع.

## النشر

النشر التلقائي مفعّل عبر `.github/workflows/deploy.yml` عند push إلى `main`. يستخدم workflow `cloudflare/wrangler-action@v3` وأمر `deploy`، ويتطلب secrets التالية في إعدادات GitHub Actions:

| Secret | الغرض |
|---|---|
| `CLOUDFLARE_API_TOKEN` | صلاحية نشر Worker عبر Wrangler |
| `CLOUDFLARE_ACCOUNT_ID` | حساب Cloudflare المستهدف |

يمكن إجراء نشر يدوي من بيئة موثقة عبر:

```bash
npx wrangler deploy
```

ويُفضّل تنفيذ فحص جاف قبل النشر:

```bash
npx wrangler deploy --dry-run
```

## الاختبار والمراجعة

```bash
npm test                 # smoke (الـWorker الحقيقي + D1 محاكى) + اختبارات الوحدات
node scripts/audit.mjs   # syntax + import/export + يتامى + imports غير مستخدمة
```

`tests/smoke.test.mjs` يتطلب Node ≥ 22.5 (`node:sqlite`) ويغطي: اكتمال الترحيل المتقطّع لكل الجداول، كل المسارات العامة، تسجيل دخول الأدمن والبوابة المركزية، حدود Rate limit للبحث، كاش الحافة وتطبيع مفاتيحه، تجميع beacons التحليلات، موزّع Cron، والمعقّم. يعمل تلقائياً في CI قبل كل نشر.

## مبادئ تشغيل مهمة

تُعد `salary_min_usd` و`salary_max_usd` مصدر HOT PAY الأساسي، مع parser legacy عند غياب الأعمدة. عند وجود نطاق راتب يُستخدم midpoint للتصنيف، ويُستخدم minimum المنفرد عندما يكون هو الإفصاح المتاح. لا ينفذ hydration الوصفي أكثر من batch bounded واحد، ولا توجد query منفصلة لكل وظيفة.

جميع استعلامات SQL parameterized، وجميع قوائم الفرز والـstatus والـprovider مبنية على allow-lists. تُعرض الوظائف العامة فقط عند `status = 'active'`. أما الوظائف `expired` و`archived` والبيانات التشغيلية فتظل داخل المسارات الإدارية أو المملوكة لصاحبها.


## صفحات CMS وCode Blocks المعزولة

تدعم صفحة **New Page** (`/admin/pages/new`) الآن ثلاثة حقول اختيارية منفصلة: `custom_html` و`custom_css` و`custom_js`. تُحفظ هذه الحقول في أعمدة additive داخل جدول `pages`، لذلك تبقى الصفحات القديمة وعمود `body` متوافقين دون migration تدميرية. كما يدعم **Homepage Sections** (`/admin/homepage`) التحكم في جميع كتل Homepage الحالية، مثل Hero وFeatured Companies وCategories وJob Listing وبطاقات Job Alerts وBoost Your Career وCareer Resources وCareer Insights وTrust Strip وEmployer CTA. يفتح زر **Edit Code** لكل قسم محرر HTML/CSS/JavaScript مباشرًا داخل Homepage Sections، ويمكن حفظ التعديل أو استخدام **Restore Original Section** للعودة إلى renderer الأصلي. كما يمكن إنشاء أقسام مخصصة جديدة وتعديلها وتعطيلها وترتيبها وحذفها، مع عنوان ووصف وحقول الكود نفسها.

يُعرض الكود المخصص في معاينة الإدارة وفي الصفحة العامة داخل `iframe` يحمل `sandbox="allow-scripts allow-forms"` ومن دون `allow-same-origin`. يمكن لـJavaScript العمل داخل مستند الصفحة المخصص، لكنه لا يستطيع الوصول إلى cookies أو DOM الصفحة الرئيسية أو لوحة الإدارة. لا تُوضع الأسرار أو رموز الجلسات داخل هذا المحتوى العام، ويظل تحريره محصورًا بالمشرف المصادق عليه.

يوفر محررا الصفحة والقسم حدودًا قصوى قدرها 120,000 حرف لـHTML و60,000 حرف لكل من CSS وJavaScript، ويستخدمان escaping عند إدخال القيم في نموذج الإدارة وحماية من إغلاق script wrapper عبر `</script>`. تُعرض الأقسام المخصصة في نهاية homepage داخل مساحة full-width وبارتفاع iframe ديناميكي، بينما يظل `body` الحالي محرر HTML الموثوق السابق حفاظًا على التوافق مع صفحات Privacy وTerms وDisclaimer.

## الأداء والكاش والأمان (إضافات هذه الجولة)

- **الكاش على الحافة:** الصفحة الرئيسية وصفحة الوظيفة و`/jobs` وصفحات الفئة/الشركة/الدولة/المهارة تُخزَّن للزائر بلا كوكي `jf_session` (كوكيز التحليلات لا تعطّل الكاش). مفتاح الكاش يُطبَّع بقائمة معاملات مسموحة فلا تولّد `?x=1..N` مدخلات جديدة. أخطاء 404/410 لا تُخزَّن.
- **اتساع الزحف (crawler breadth):** صفحات المهارات (`/skills/:slug`) — العنصر الأعلى تعدداً في الموقع — تقرأ من قوائم معرّفات وظائف محسوبة مسبقاً (`dir:skill_jobs` في site-cache.js) بدل مسح نافذة كاملة، فتبقى تكلفة الصفحة شبه ثابتة (~35 صفاً) حتى مع زحف كامل يزور آلاف الروابط الفريدة مرة واحدة لكل رابط — حالة لا تُغني عنها مدة صلاحية الكاش وحدها.
- **البحث:** `lib/platform/search-utils.js` هو المدخل الوحيد لكل بحث (تهريب `%_`، حد 80 حرفاً، فك ترميز آمن). `/search/*` دائماً `noindex`، وعند فوات الكاش يُطبَّق Rate limit (30 طلباً/دقيقة/IP).
- **التحليلات:** المتصفح يجمّع الأحداث في beacon واحد (`{events:[…]}`) ويرسله عند الخمول 2.5s أو 20 حدثاً أو إخفاء الصفحة. زيارات `visits` تُسجَّل لصفحات 200 HTML فقط.
- **الترحيل المتقطّع:** أعلام `schemaState` تُتجاهل أثناء الترحيل حتى تبقى مواضع الوحدات حتمية (إصلاح خطأ كان يتخطى جداول). `index.js` يمرّر نسخة `env` لكل طلب.
- **الأدمن:** كوكي الجلسة يُوقَّع بـ`ADMIN_SESSION_SECRET` (اختياري، يرجع إلى `ADMIN_PASSWORD`)، وبوابة مصادقة مركزية تحت `/admin`، ولا يُقبل أي سر في الرابط (`?jf_debug=1` للأدمن المسجَّل فقط).
- **HTML الغني:** أجسام المدونة والصفحات الثابتة تمر بمعقّم قائمة سماح (`lib/platform/html-sanitizer.js`) عند العرض.
- **الأيقونات:** Lucide فقط (`assets/icons.js`)؛ الإيموجي المتبقية بيانات يحرّرها الأدمن (رموز الفئات وأزرار القائمة) أو نصوص بريد.

## التسويق بالعمولة (Affiliate Manager)

لوحة التحكم: **Admin ← Affiliate Manager** (`/admin/affiliate`). الطبقات: `lib/affiliate/affiliate.js` (بيانات) ← `lib/affiliate/placement.js` ← `components/affiliate-block.js` (HTML) ← الصفحات العامة؛ و`routes/affiliate.router.js` لرابط التتبّع.

- **برنامج ← عروض:** البرنامج حساب شريك (Amazon / Impact / CJ / اتفاق مباشر)، والعرض رابط واحد قابل للترويج. إيقاف البرنامج يوقف كل عروضه.
- **رابط التتبّع `/go/<slug>`:** الوجهة تُقرأ من قاعدة البيانات فقط (لا من الطلب) فلا open redirect ولا تزوير نقرات. يدعم `{click_id}` `{offer}` `{placement}` في رابط الوجهة لتمرير معرّف النقرة للشبكة. الزواحف وطلبات HEAD والأدمن تُحوَّل ولا تُحتسب.
- **المواضع (تُفعَّل/تُعطَّل من اللوحة):** صفحة الوظيفة · صفحات المهارات · صفحات التصنيفات · مقالات المدونة · شريط الرئيسية الجانبي. لا يظهر شيء قبل تفعيل المفتاح العام وعرض نشط لموضع مفعّل.
- **الاستهداف:** كل عرض قد يُقيَّد بتصنيفات أو مهارات؛ العرض المرتبط بالصفحة يُعطى وزناً ×4.
- **الامتثال:** `rel="sponsored nofollow noopener"` + سطر إفصاح قابل للتعديل + `Disallow: /go/` في robots.txt.
- **ميزانية الكتابة:** النقرة = صف عدّاد واحد في `aff_daily` + صف تفصيل واحد في `aff_clicks` فقط ما دام تحت `aff_detail_clicks_per_day`؛ الإحصاءات تقرأ العدّاد فقط؛ تفاصيل النقرات تُحذف بعد `aff_detail_retention_days` (الصيانة اليومية 03:30).
- **الأرباح:** لا يخترع الموقع أي رقم. تُسجَّل التحويلات يدوياً أو باستيراد CSV (`click_id` أو `offer` + `amount`)، ولا يُحتسب ربحاً إلا ما حالته `approved`. لا يُحسب EPC عند اختلاط العملات.
- حُصِّنت نقطة `/api/monetization/affiliate-click` القديمة: الوجهة يجب أن تطابق نطاق `base_url` للبرنامج، وبصمة الـ IP صارت بمفتاح سري وملح يومي.
