# JobForion

منصة وظائف عن بُعد مبنية على **Cloudflare Workers ES Modules + D1 (SQLite) + R2** مع توليد SSR HTML. لا تعتمد على خادم تقليدي؛ نقطة الدخول الوحيدة هي `src/index.js`، وتُدار الواجهة والمحتوى من وحدات مستقلة داخل `src/pages` و`src/components` و`src/lib`.

- **الموقع:** <https://jobforion.com>
- **المستودع:** `RagnarDEV/JobForion` على GitHub
- **النطاق canonical:** `BASE_URL` في `src/config/constants.js`
- **النطاقات المتقاعدة:** تُعاد توجيهها 301 من خلال `RETIRED_HOSTS` في `src/index.js`

## خريطة المشروع

```text
jobforion/
├─ wrangler.toml              ← Worker + D1 + R2 + Workers AI + cron
├─ .github/workflows/deploy.yml ← النشر التلقائي من main
├─ package.json
└─ src/
   ├─ index.js                 ← نقطة الدخول وترتيب الراوترات وsecurity headers
   ├─ config/                  ← الثوابت، حالات الوظائف، الحقول المشتركة
   ├─ routes/                  ← معالجات HTTP
   │  ├─ pages.router.js       ← الصفحة الرئيسية وتفاصيل الوظيفة والمحتوى العام
   │  ├─ seo-pages.router.js   ← categories/companies/skills/countries/search
   │  ├─ admin.router.js       ← /admin/* المحمي
   │  ├─ api.router.js         ← jobs، subscribe، post-job، saved jobs، applications
   │  ├─ user.router.js        ← الحساب، matching، career assistant
   │  ├─ company.router.js     ← ملفات الشركات ورفع صور R2 ووظائف الشركات
   │  ├─ feed.router.js        ← sitemap.xml وfeed.rss
   │  └─ assets.router.js      ← brand assets و/r2-asset/*
   ├─ pages/                   ← SSR HTML للواجهة والحساب ولوحة الإدارة
   ├─ components/              ← nav، footer، job-card، company-card، النماذج
   ├─ layout/                  ← القالب العام وCSS المشترك
   ├─ styles/                  ← تنسيقات البطاقات والواجهة والحساب والإدارة
   ├─ providers/               ← موصلات مزوّدي الوظائف
   ├─ db/                      ← schema، sync، cleanup، analytics
   ├─ auth/                    ← admin-auth والجلسات والصلاحيات
   ├─ lib/                     ← SEO، cache، logos، salary، AI، lifecycle
   ├─ data/                    ← المحتوى الثابت الأولي
   └─ assets/                  ← favicon، manifest، icons
```

## التشغيل ودورة الطلب

يمر الطلب عبر `src/index.js` الذي يطبّق security headers، ثم يمرر المسار إلى الراوتر المتخصص. تُعالج طلبات assets وR2 وlogo proxy قبل bootstrap الخاص بـD1 لتقليل كلفة الطلبات التي لا تحتاج قاعدة بيانات. أما الصفحات والحسابات والإدارة والمحتوى فتستخدم schema bootstrap الآمن والمتكرر داخل `src/db/schema.js`.

تعمل مزامنة الوظائف كل ست ساعات عبر cron `0 */6 * * *`، وتعمل دورة lifecycle اليومية عند `03:00 UTC`. تنتقل الوظائف غير المحدثة إلى `expired` ثم `archived` وفق فترة الاحتفاظ؛ ولا تُحذف نهائيًا إلا الوظائف المؤرشفة التي تجاوزت retention. قبل الحذف النهائي تُزال المراجع التابعة من `saved_jobs` و`applications` و`job_intelligence` لتجنب orphan rows.

## البيانات والتخزين

يستخدم D1 جداول الوظائف والحسابات والشركات والمحتوى والإدارة. كل تعريفات AI الأربعة موجودة مركزيًا في `ensureAiTables()` داخل `src/db/schema.js`، مع `CREATE TABLE IF NOT EXISTS` وفهارس مناسبة، بينما تستدعي وحدات الميزات helper المركزي بدل امتلاك runtime DDL مستقل.

صور الشعارات والأغلفة تُرفع إلى binding `COMPANY_ASSETS` في R2 بعد التحقق من MIME والـsignature والحجم الأقصى 2MB. عند نجاح ربط الكائن في D1 يُحذف الكائن السابق، وعند فشل الربط يُحذف الكائن الجديد. يعمل `/r2-asset/*` كمسار fallback، ويقبل فقط مفاتيح R2 المطابقة للنمط المسموح. يمكن ضبط `R2_PUBLIC_BASE_URL` لاستخدام نطاق R2 أو النطاق المخصص مباشرة.

## Workers AI والميزات الحالية

يستخدم المشروع Workers AI فقط عبر binding باسم `AI` وبالنموذج الثابت:

```text
@cf/zai-org/glm-4.7-flash
```

توجد خدمة مركزية في `src/lib/ai-service.js` لتوحيد model ID وservice/prompt versions والتحقق من المدخلات وحدود البيانات وprompt boundary والتطبيع الآمن للأخطاء وtelemetry الخفيف. لا تصل الأسرار أو binding إلى المتصفح، ولا تُستدعى AI تلقائيًا في homepage أو listing أو search أو job detail أو company أو auth أو feed أو cron.

الميزات المطبقة هي: **Job Intelligence** عند الطلب من محرر الوظيفة الإداري، **Matching** داخل حساب المستخدم، **Career Assistant** للمستخدم المصادق عليه، **Admin Assistant** للقراءة التشغيلية فقط، **Content Intelligence** للمراجعة التحريرية دون نشر تلقائي، و**AI Control Center** للعرض والمراقبة فقط. لا يملك أي مساعد صلاحية تنفيذ sync أو cleanup أو حذف أو نشر أو إرسال بريد أو تغيير إعدادات حساسة تلقائيًا.

## الأمان

تستخدم صفحات الإدارة admin cookie موقعة وحماية CSRF للمسارات النماذجية، وتستخدم صفحات الحساب جلسات HttpOnly وSecure وSameSite مع ownership checks. توجد rate limits تطبيقية للمسارات الحساسة، إضافة إلى حدود إدخال للـAPI وpagination. روابط التقديم الخارجية تمر عبر `safeExternalUrl()` ولا تُقبل `javascript:` أو `data:` أو protocol-relative URLs.

يضع Worker security headers موحدة تشمل `X-Content-Type-Options` و`X-Frame-Options` و`Referrer-Policy` و`Permissions-Policy` وHSTS وCSP. تسمح CSP بالـinline scripts/styles المطلوبة حاليًا للواجهة SSR، لكنها لا تسمح بمضيفات صور عامة عشوائية؛ الشعارات الخارجية تُجلب عبر Worker logo proxy أو R2 الموثق.

سجلات النشاط لا تخزن نصوص prompts أو الإجابات أو profile data، وتم تقليل PII من سجلات الحساب إلى معرّفات داخلية. عند حذف الحساب تُطهّر محادثات Career Assistant ونتائج Matching والجلسات قبل إكمال soft-delete للهوية.

## الإعداد المحلي

```bash
npm install
npm run dev
```

الأسرار المطلوبة بحسب الميزة تُضبط خارج Git، مثل:

```bash
npx wrangler secret put API_KEY
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

فحوص JavaScript الأساسية:

```bash
for f in $(git ls-files '*.js'); do node --check "$f"; done
git diff --check
```

قبل الدمج يجب التحقق من عدم وجود استدعاءات AI في المسارات العامة، وعدم وجود أسرار أو prompts في السجلات، ونجاح regression لخدمات AI وHOT PAY وR2 والـAPI. يجب أيضًا اختبار الصفحات العامة، صفحة تفاصيل الوظيفة، لوحة الإدارة، الحساب، النماذج المحمية، و404/410 بعد تغييرات lifecycle.

## مبادئ تشغيل مهمة

تُعد `salary_min_usd` و`salary_max_usd` مصدر HOT PAY الأساسي، مع parser legacy عند غياب الأعمدة. عند وجود نطاق راتب يُستخدم midpoint للتصنيف، ويُستخدم minimum المنفرد عندما يكون هو الإفصاح المتاح. لا ينفذ hydration الوصفي أكثر من batch bounded واحد، ولا توجد query منفصلة لكل وظيفة.

جميع استعلامات SQL parameterized، وجميع قوائم الفرز والـstatus والـprovider مبنية على allow-lists. تُعرض الوظائف العامة فقط عند `status = 'active'`. أما الوظائف `expired` و`archived` والبيانات التشغيلية فتظل داخل المسارات الإدارية أو المملوكة لصاحبها.
