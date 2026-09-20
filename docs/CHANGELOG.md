# CHANGELOG — v2.1.0 (إعادة الهيكلة والتأمين والتسريع)

## السبب الجذري لصفحة "عذراً، حدث خطأ مؤقت" المتكررة (أُعيد إنتاجه واختُبر)
عشرات الصفحات والمكتبات تستدعي `await ensureTable(env)` / `ensureAiTables(env)` بشكل دفاعي في كل طلب. عندما يكون ترحيل المخطط معلّقاً (بعد نشر جديد، أو بعد قاعدة ناقصة) يكون علم الـisolate ما زال `false` فتنفّذ هذه الدوال **كل أوامر DDL (مئات نداءات D1)** داخل طلب الصفحة، فيتجاوز الطلب حد الـ50 subrequest في الخطة المجانية ويرمي استثناء ← صفحة الخطأ الاحتياطية. على قاعدة جديدة وبحد 50 نداء/طلب: النسخة القديمة أعطت `500,500,500,200,200` والجديدة `200` في كل الطلبات الـ14.
الإصلاح: (1) `ensureTable/ensureAiTables/ensureAccountTables` لا تفعل شيئاً خارج الترحيل المُدار (`ensureAllSchema` وحده يملك التهيئة)؛ (2) ميزانية الترحيل داخل طلب صفحة خُفّضت من 35 إلى 18 نداء لأنها تتشارك الحد مع رسم الصفحة؛ (3) الـCron وزر `Repair schema` في `/admin/system` يعملان بميزانية 44 لأنهما لا يرسمان صفحة؛ (4) فشل `ensureAllSchema` لم يعد يُسقط الموقع كله (يُسجَّل ويستمر الطلب).

## إصلاحات أخطاء فعلية
| المشكلة | الملف | الإصلاح |
|---|---|---|
| الترحيل المتقطّع يتخطى جداول ثم يُسجّل اكتماله (22 من 57 جدولاً لم تُنشأ) بسبب أعلام `schemaEnsured` على مستوى الـisolate التي تغيّر مواضع الوحدات | `db/schema/*.js` | الأعلام تُتجاهل أثناء الترحيل (`env.__migCtx`)؛ رفع `SCHEMA_VERSION` إلى `2026-09-20.1` ليُعاد الترحيل ويُصلح القاعدة الحالية |
| أعلام الطلب على `env` قد تتسرّب بين الطلبات في نفس الـisolate | `index.js` | نسخة `env` لكل طلب |
| `/search/%E0%A4%A` ← HTTP 500 (`URIError`) | `lib/platform/search-utils.js`, `seo-pages.router.js` | فك ترميز آمن ← 404 |
| فشل مهام Cron يُبتلع بصمت (`.catch(() => {})`) | `app/cron.js` | يُسجَّل في `error_logs` + Workers Logs |
| CSS بطاقة الوظيفة مكرر في الصفحة الرئيسية ويختلف عن `JOB_CARD_CSS` | `pages/home/styles.js` | تستورد الصفحة الرئيسية الأنماط القانونية وحُذفت النسخة المكررة |

## أمان
- حذف `?jf_debug=<ADMIN_PASSWORD>`؛ التشخيص لمن سجّل الدخول عبر `?jf_debug=1`.
- `ADMIN_SESSION_SECRET` مستقل لتوقيع كوكي/CSRF الأدمن (يرجع إلى `ADMIN_PASSWORD`)، وفشل مغلق عند غياب أي سر.
- بوابة مصادقة مركزية تحت `/admin` (دفاع إضافي فوق فحص كل sub-router).
- معقّم HTML بقائمة سماح لأجسام المدونة والصفحات الثابتة (`lib/platform/html-sanitizer.js`).
- `/search/*` دائماً `noindex`؛ تهريب محارف LIKE؛ Rate limit للبحث؛ `robots.txt` يمنع مسارات الحسابات.
- CI: لا نشر قبل نجاح `scripts/audit.mjs` و`npm test`.

## أداء وتكلفة D1
- كاش حافة فعلي (Cache API) لصفحة الوظيفة و`/jobs` وصفحات الفئة/الشركة/الدولة/المهارة/البحث بمفاتيح مطبَّعة؛ الزائر المجهول يُحدَّد بكوكي الجلسة فقط.
- Rate limit للبحث يعمل عند فوات الكاش فقط (لا كتابة D1 عند الإصابة).
- تجميع أحداث التحليلات في beacon واحد بدل طلب لكل حدث؛ `/api/*` يُوجَّه مبكراً.
- `visits` تُسجَّل لصفحات 200 HTML فقط.
- الصفحة الرئيسية: 11 قراءة D1 بالتوازي بدل التتابع؛ إزالة بحث الكاش المكرر.
- 5 مهام Cron ← مهمة واحدة `*/30 * * * *` (موزّع في `app/cron.js`).
- `[observability]` مفعّلة في `wrangler.toml`.

## هيكلة
- `index.js` رفيع؛ استخراج `app/security-headers.js` و`app/fallback-error.js` و`app/cron.js`.
- `lib/` (46 ملفاً مسطحاً) ← 10 نطاقات: jobs · directory · companies · content · ai · analytics · seo · platform · accounts · monetization.
- `db/schema.js` (84KB) ← منسّق + `db/schema/` (5 ملفات). `db/analytics.js` ← `db/telemetry.js`.
- `routes/api.router.js` (44KB) ← موزّع + `routes/api/` (6 وحدات + shared).
- `pages/seo-pages.js` (83KB) ← barrel + `pages/seo/` (7 ملفات).
- `pages/home.js` (94KB) ← 364 سطراً + `pages/home/{styles,client-script}.js` (ناتج HTML مطابق بايت-ببايت عدا التعديلين المقصودين).
- تسميات أوضح: `lib/schema.js`→`lib/seo/jsonld.js`، `lib/seo.js`→`lib/seo/meta.js`، `analytics*`→`lib/analytics/{events,tracker,tag}.js`.

## تنظيف
- حذف: `lib/metadata.js`، `favicon-preview.png`، 17 استيراداً غير مستخدم، 19 رمزاً ميتاً. أُبقيت عمداً: مكتبة أيقونات Lucide، `PaymentService`، ثوابت المونيتايزيشن، بناة JSON-LD.
- نقل تقارير التدقيق إلى `docs/`.

## الهوية البصرية
- استبدال ~110 إيموجي بأيقونات Lucide (7 أيقونات جديدة في `assets/icons.js`). المتبقي بيانات يحرّرها الأدمن أو نص بريد إلكتروني.

## ملاحظات النشر
1. أول ~7 طلبات بعد النشر قد تُظهر "no such table" مؤقتاً أثناء إعادة الترحيل (تلقائي).
2. `wrangler secret put ADMIN_SESSION_SECRET` ← يُنهي جلسة الأدمن الحالية (تسجيل دخول واحد).
3. النشر يستبدل الـCron القديمة الخمسة بمهمة واحدة.
4. بعد النشر اضغط **Repair schema** في `/admin/system` مرة أو مرتين حتى تظهر رسالة "Schema is up to date" (يعالج القاعدة الحالية فوراً بدل انتظار الزيارات).
5. تحقق بعد النشر: `/admin/system` (Recent Errors)، `/robots.txt`، `/sitemap.xml`، صفحة وظيفة مرتين (الثانية من الكاش).
