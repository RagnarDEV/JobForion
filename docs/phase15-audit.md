# JobForion — Phase 15 Pre-Implementation Audit

**الحالة:** تدقيق مسبق قبل التعديلات البرمجية

**النطاق:** Production Hardening, Security, Performance & Scalability

**المستودع:** `RagnarDEV/JobForion`

**آخر حالة مرجعية:** Phase 14 موجودة على `main` في commit `ea787f3994b796719e0b00b6367d8868210b9d34` قبل إنشاء هذا التقرير.

> هذا التقرير يميز بين ما تم التحقق منه من الكود، وما يحتاج تنفيذًا أو قياسًا إضافيًا. لا تعتبر أي نتيجة هنا إثباتًا لجاهزية الإنتاج قبل إتمام الإصلاحات والاختبارات اللاحقة.

## A. Current Architecture

JobForion عبارة عن Cloudflare Worker بصيغة ES modules، ويبدأ الطلب من `src/index.js`. يتم التعامل أولًا مع الملفات الثابتة وR2 وproxy الشعارات، ثم تتم تهيئة جداول D1، وبعدها تمر الطلبات عبر سلسلة من الراوتات المتخصصة: feeds وadmin وauth وuser وcompany وpages وSEO ثم JSON API. هذا الترتيب يحافظ على الروابط العامة الحالية ويضع الراوتات الأكثر تخصصًا قبل catch-all CMS.

التطبيق يستخدم SSR مبنيًا على HTML strings مع JavaScript مضمن في الصفحات العامة ولوحة الإدارة. لا توجد طبقة React/tRPC في هذا المستودع، ولذلك فإن أي تقوية يجب أن تبقى ضمن Worker/router/SSR الحالي ولا تستخدم إعادة بناء منفصلة. الواجهة العامة تستعمل Cache API لبعض صفحات الدلائل وsitemap/feed، بينما الصفحات المخصصة ولوحة الإدارة لا تُخزّن في الكاش العام.

الهوية مقسومة إلى نظامين. الإدارة تعتمد على cookie موقّع HMAC باسم `jn_admin` مرتبط بسر `ADMIN_PASSWORD`، والمستخدمون يعتمدون على `jf_session` يحمل token عشوائيًا بينما يخزّن D1 hash فقط. نماذج الحساب تستخدم CSRF stateless، أما POST الإدارة فيمر عبر بوابة CSRF عامة في `admin.router.js` بالإضافة إلى فحوصات كل sub-router.

## B. Database Architecture

تهيئة D1 موجودة في `src/db/schema.js` باستخدام `CREATE TABLE IF NOT EXISTS` و`ensureColumn()` وflags داخل Worker isolate. لا توجد ملفات migration مستقلة تقليدية؛ التغييرات schema-healing additive عند bootstrap. هذا يحافظ على التوافق مع قواعد البيانات السابقة لكنه يجعل وقت cold start حساسًا لعدد أوامر DDL/PRAGMA.

الجداول التشغيلية الرئيسية هي `jobs` و`job_postings` و`subscribers` و`sync_logs` و`cleanup_logs` و`rate_limits`. جداول الحسابات هي `users` و`user_profiles` و`user_sessions` و`email_verifications` و`password_resets` و`saved_jobs` و`job_alerts` و`applications`. الشركات تمثلها `companies` و`company_members` مع ربط nullable من `jobs.company_id`، مع استمرار وجود `jobs.company` النصي للوظائف القديمة والمزودة.

المونيتايزيشن مفصول إلى `monetization_products` و`monetization_orders` و`monetization_transactions` و`monetization_entitlements` و`monetization_campaigns` و`monetization_refunds` و`monetization_revenue_events` و`monetization_webhook_events`. أما Phase 14 فأضافت `analytics_event_queue` و`analytics_daily` و`analytics_search_daily` و`analytics_filter_daily` و`analytics_alerts`.

توجد فهارس جيدة على status/id للشواغر، الشركة، created/updated/expiry، الحسابات، التطبيقات، جلسات المستخدم، الشركات، المعاملات، rate limits، queue analytics، daily analytics وaffiliate. توجد فهارس مخصصة على `visits(path)` و`jobs(company)`، لكن لا يوجد فهرس مركب يغطي كل أنماط البحث العامة، ولا يوجد full-text index أو search service.

أبرز مخاطر قاعدة البيانات هي أن `visits` جدول خام دائم النمو، وأن سجلات `blog_automation_log` و`admin_activity_log` لا يظهر لهما retention عام في المسار المفحوص. كما أن bootstrap يستخدم عددًا كبيرًا من الرحلات عند أول isolate، ويحتوي على `DROP INDEX IF EXISTS` لإزالة فهرس قديم؛ هذا لا يحذف صفوفًا لكنه يحتاج سياسة migration موثقة ومراجعة قبل النشر.

## C. Security Assessment

تمت مراجعة مسارات SQL الأساسية، والـdynamic SQL المرئي حاليًا يستخدم allow-lists أو placeholders. `api.router.js` يضمّن أسماء أعمدة/ترتيبًا فقط من ثوابت داخلية مثل `JOB_LISTING_COLUMNS` و`JOB_SORT_OPTIONS`، ويستخدم bindings لقيم البحث والفلاتر. هذا يقلل خطر SQL injection، لكنه لا يلغي الحاجة لاختبار كل route مدخلاته وحدوده.

حماية XSS جيدة في أغلب واجهة SSR عبر `escapeHtml` و`safeImageUrl`، كما أن المحتوى المخصص للصفحات يُعرض في iframe معزول بحسب تعليقات الكود. مع ذلك، وجود CMS code blocks و`unsafe-inline` في CSP يعني أن مساحة المخاطر كبيرة؛ يجب تنفيذ اختبار payloads على HTML/CSS/JS وحقول الصور والـmetadata، وعدم اعتبار CSP الحالية بديلًا عن escaping أو sanitization.

تمت إضافة security headers عامة في `src/index.js`، منها `nosniff` و`SAMEORIGIN` وHSTS وCSP وPermissions-Policy. CSP ما زالت تسمح بـ`unsafe-inline` لأنها مطلوبة للبنية الحالية، ولذلك تصنّف كدفاع إضافي لا كعزل كامل. يجب مراجعة مصادر third-party مثل Google Analytics وAdsterra وR2 عندما تتغير إعدادات الإنتاج.

أهم الملاحظات الأمنية ذات الأولوية هي fallback السري في `lib/accounts/csrf.js` عند غياب `CSRF_SECRET`، وكون limiter الحالي fail-open وغير ذري، وكون `/api/sync` يستطيع معالجة GET رغم أن العملية تغير البيانات وتستحق POST/CSRF فقط، وغياب حد body واضح على webhook قبل قراءة النص. توجد أيضًا مسارات إدارية كثيرة تعيد `Unauthorized` الخام بدل تجربة login موحدة، وهي ليست bypass بحد ذاتها لكنها تزيد احتمالات سوء التشغيل.

## D. Performance Assessment

أغلى مسار عام هو `/api/jobs`. كل طلب يشغّل استعلام قائمة واستعلام `COUNT(*)` متوازيًا، وقد يستخدم LIKE على عدة أعمدة و`json_each(jobs.skills)` وترتيب relevance، ثم يستدعي hydration للشعارات وHOT PAY والتحقق من الشركات والإعدادات. يوجد rate limit وحد page، لكن الصفحة القصوى 1000 تعني أن OFFSET قد يسبب scans كبيرة مع نمو الجدول.

صفحات `/job/:id` تنفذ قراءة الوظيفة ثم قراءة related jobs باستخدام شروط OR وترتيب CASE. صفحات الشركات القديمة قد تعتمد على `jobs.company` النصي حتى مع وجود `company_id`. مسارات الدلائل وsitemap تستخدم Cache API، وهذا جيد لتقليل D1، لكن توليد بعض sitemaps يجمع حتى آلاف الشركات/المهارات/الدول في Worker واحد ويعتمد على نتائج D1 الحية.

مزامنة المزودين لديها warm-up cap وhard cap وsubrequest governor وretry/backoff وprovider locks وbatch inserts، كما أن الفشل يعزل المصدر بدرجة جيدة. الخطر المتبقي هو أن التقدير المحافظ للـsubrequests قد لا يعكس كل عمليات provider فعلًا، وأن جميع مصادر `api_sources` تُقرأ وتحاول المزامنة في نفس invocation حتى حدود governor.

الإعدادات تستخدم cache مدة 60 ثانية، وهو حل عملي لكنه قد يعطي قيمًا قديمة مؤقتًا بين isolates. `ensureTable` و`ensureAccountTables` يستخدمان flags، لكن كل cold isolate يدفع كلفة bootstrap. كما أن `attachCompanyLogos` و`hydrateHotPay` يحتاجان تحققًا من عدم تنفيذ query لكل وظيفة، خصوصًا في صفحات نتائج كبيرة.

## E. Cloudflare Assessment

الإعداد الحالي يستفيد من D1 وR2 وWorkers AI وCache API وCron. ملف `wrangler.toml` يضم خمسة cron schedules: مزامنة كل ست ساعات، تنظيف يومي، Job Alerts، Blog Generation، وتجميع Analytics كل ساعة. لا توجد secrets داخل الملف بحسب المراجعة، وتظهر الأسرار المطلوبة في التعليقات فقط.

الـWorker يطبق security headers مركزيًا، ويستثني assets وR2 وlogo proxy من تهيئة D1، وهي نقطة أداء صحيحة. في المقابل، طلبات HTML العامة غير cached باستثناء الدلائل/feed وبعض صفحات SEO، ولا يوجد public API cache strategy لنتائج البحث. يجب قياس Cloudflare subrequests وCPU وD1 reads/writes فعليًا بدل افتراض أن الحدود الحالية كافية لكل أحجام البيانات.

الـcron handler يستخدم `waitUntil` للتشغيل غير المتزامن، لكن لا يوجد lock عام لكل cron job؛ sync لديه locks لكل provider، بينما analytics/cleanup/blog/alerts يمكن نظريًا أن تتداخل مع تشغيل يدوي أو isolate آخر. يجب إضافة idempotency أو lease قصيرة حيث يكون التداخل مؤثرًا.

## F. Provider Assessment

المستودع يسجل تسعة adapters: Greenhouse وLever وAshby وSmartRecruiters وWorkable وTeamtailor وRecruitee وWorkday وiCIMS. المزودات تستخدم AbortController وtimeout في الملفات المفحوصة، وتتحقق من `response.ok` أو تعالج JSON، وتقصّر الوصف والحقول الطويلة قبل التخزين.

طبقة `syncJobs()` تفصل النتائج حسب المصدر، وتستخدم retries فقط للأخطاء المؤقتة، وتمنع مزودًا فاشلًا من إيقاف دورة المزودين بالكامل. deduplication الأساسي يعتمد على `jobs.url UNIQUE` مع تحديث الوظيفة الموجودة، وهو قوي نسبيًا لكنه قد لا يمنع duplicates الدلالية إذا تغيّر رابط المزود.

يجب استكمال اختبار كل مزود برد malformed وHTTP 401/403/404/429/5xx وtimeout وpayload ضخم وpartial response. كما يجب مراجعة Teamtailor لأن `api_key` يُستخدم كـtoken في Authorization، في حين أن التعليقات العامة تصف المزودات بأنها keyless؛ هذه ليست ثغرة تلقائيًا لكنها نقطة توثيق وحوكمة أسرار يجب توحيدها.

## G. Payment Assessment

المونيتايزيشن الحالي provider-neutral ولا يدّعي وجود checkout حقيقي. السعر يأتي من `monetization_products` عبر backend، والـorder يُنشأ بحالة pending، ولا يتم تفعيل entitlement إلا بعد webhook موقّع يطابق order amount/currency ويخلق transaction idempotently. هذا يحقق مبدأ عدم الثقة في `payment_success` القادم من المتصفح.

الـwebhook يستخدم HMAC مع timestamp window قدرها خمس دقائق وevent-id deduplication وprovider reference unique. لكنه يحتاج حدًا لحجم body وrate limit مخصصًا وحماية أوضح من حالات event sequencing، إضافة إلى اختبار replay وduplicate delivery عبر حالات success/failure/retry.

المخاطر المتبقية تشمل أن `requestRefund()` يتحقق من أن refund منفرد لا يتجاوز قيمة الطلب، لكنه لا يراجع مجموع refunds السابقة، ما قد يسمح نظريًا بطلبات متراكمة تتجاوز الإجمالي. كما أن `activateOrderEntitlement()` يسجل `entitlement_activated` في revenue events، بينما يجب التأكد من أن تقارير الإيراد لا تجمع event confirmation مع transaction success مرتين. يوجد أيضًا نداء analytics بــ`event_type: null` لتفعيل boost، وهو يُرفض harmlessly لكنه يدل على مسار يحتاج تنظيفًا.

لا يوجد provider دفع حقيقي مفعّل في الكود الحالي؛ لذلك لا يجوز إعلان checkout أو payment production-ready قبل تركيب provider adapter موثوق واختبار webhook الحقيقي في بيئة معزولة.

## H. SEO Assessment

بنية SEO قوية نسبيًا: sitemap index مع child sitemaps، chunk jobs عند 20,000، XML escaping، Cache API لمدة ساعة، fallback XML عند فشل D1، وRSS منفصل. الوظائف غير المتاحة تستخدم 410 تقريبيًا إذا كان ID تحت MAX الحالي، وصفحات SEO تُرجع noindex عند حالات المحتوى الرقيق أو feature flag.

مسار `/jobs` غير cached عمدًا لأنه قد يكون مخصصًا للمستخدم، بينما الدلائل العامة cached. يجب تدقيق canonical/meta/structured data في جميع renderers فعليًا، والتحقق من أن URLs المولدة من CMS لا تتكرر مع routes المحجوزة وأن sitemap لا يدرج صفحات unpublished أو deleted.

الاعتماد على MAX(id) للتمييز بين 404 و410 heuristic وليس سجلًا تاريخيًا دقيقًا. كما أن sitemap company/skills/countries قد يجمع حتى 5000/3000/1000 نتيجة في invocation؛ هذا bounded لكنه يحتاج قياسًا عند أحجام كبيرة.

## I. Analytics Assessment

Phase 14 أضاف whitelist للأحداث، redaction للmetadata، rate limiting، queue bounded، تجميعًا ساعيًّا، جداول daily/search/filter، retention settings، admin reports وCSV، وتنبيهات. هذه بنية مناسبة لتجنب جعل analytics مصدر نمو D1 الأساسي.

الملاحظات المؤكدة هي أن `normalizeAnalyticsEvent()` ما زالت تقبل `company_id` من client input، وأن `unique_count` يُجمع من batches مختلفة وقد يضاعف session نفسها، وأن overview يعيد `growth.comparison = not_available`. كما أن public search event كان يحتاج فصلًا أوثق عن `results_count` الذي يمكن للمتصفح تزويره، وربط job/company attribution بمصادر D1 الموثوقة.

يوجد خطأ SQL في endpoint affiliate analytics يستخدم `session_hash` بينما جدول `affiliate_clicks` يحتوي `ip_hash`. توجد كذلك legacy `visits` التي ما زالت تسجل raw rows لكل page view، ولا يظهر في مسار cleanup العام احتفاظ واضح لها. يجب تحديد هل ستبقى للتوافق، أو تُخفف/تُرحّل إلى سياسة retention بدون كسر dashboard القديم.

## J. Reliability Assessment

أغلب الوظائف المهمة تستخدم catch/fallback ولا تسمح بخطأ analytics أو provider أن يكسر HTML العام. feed/sitemap يعيدان XML صالحًا عند فشل D1، وauth يخفي account enumeration في login/reset، وsync يسجل outcomes لكل source.

نقاط الفشل المحتملة هي فشل schema bootstrap الذي يحدث قبل معظم الراوتات، وتداخل cron/manual sync، فشل email بعد نجاح payment، فشل entitlement بعد تسجيل transaction paid، والـrate limiter الذي يفشل open. كما أن `handleApiRoute()` لا يستلم `ctx` من `index.js` حاليًا، ما يمنع بعض عمليات `waitUntil` المطلوبة لتسجيل غير متزامن دون إبطاء استجابة API.

لا يوجد centralized error monitoring أو correlation/request ID واضح في الكود المفحوص. توجد `console.error` وadmin activity logs، لكنها ليست نظام incident telemetry ولا تضمن كشف cron failure المستمر أو قياس latency.

## K. Cost Assessment

مصادر التكلفة الرئيسية هي D1 reads/writes، `COUNT(*)` وLIKE/json_each في البحث، raw visits، event queue، provider fetches، R2 proxy requests، وcron invocations. توجد تحسينات مهمة بالفعل مثل cache الدلائل، batching للمزامنة، analytics aggregation، pagination، caps وrate limits.

أكثر الإجراءات الاقتصادية تأثيرًا هي إيقاف raw visit growth غير المحدود أو وضع retention، تقليل count/search work عند عدم الحاجة، تحسين keyset pagination أو search indexing داخل حدود D1، منع hydration N+1، وفرض limits على webhook/upload/payload. لا أوصي بإضافة search engine خارجي قبل قياس D1 على dataset حقيقي.

## L. Recommended Fixes by Severity

| Issue | Severity | Location | Impact | Recommended Fix | Status بعد تنفيذ Phase 15 |
|---|---|---|---|---|---|
| CSRF secret fallback إذا غاب `CSRF_SECRET` | CRITICAL | `src/lib/accounts/csrf.js` | يمكن إضعاف حماية نماذج الحساب في misconfigured production | Fail closed في production، health check يوضح secret المفقود، والإبقاء على fallback محصورًا في development | DONE |
| Webhook body بلا حد حجم/rate limit مخصص | HIGH | `src/routes/api.router.js` | استهلاك ذاكرة/CPU أو abuse قبل التحقق | فرض Content-Length/body cap، rate limit، ورسائل عامة، مع tests للـreplay/duplicates | DONE |
| Refund cumulative overage غير مفحوص | HIGH | `src/lib/monetization.js` | إجمالي refunds قد يتجاوز قيمة الطلب | جمع refunds السابقة مع conditional reservation additive قبل إنشاء refund | DONE |
| `/api/sync` يقبل GET لعملية mutating | HIGH | `src/routes/api.router.js` | CSRF/سلوك غير متوقع واستهلاك provider resources | السماح بـPOST فقط مع admin auth وCSRF وprovider allow-list | DONE |
| `rate-limit` read-then-write وfail-open | HIGH | `src/lib/rate-limit.js` | تجاوز limits تحت التزامن أو أثناء D1 failure | D1 atomic UPSERT+read، hashed keys، وfail-closed للمسارات الحساسة | DONE |
| Analytics يثق في client company_id | HIGH | `src/lib/analytics.js` | نسب analytics خاطئة أو attribution مزور | تجاهل client ownership IDs وإثراء من jobs/companies في backend | DONE |
| Unique analytics overcount عبر batches | HIGH | `src/lib/analytics.js` | أرقام visitors مضخمة | جدول daily hashed dedupe bounded مع retention | DONE |
| Affiliate SQL يستخدم `session_hash` غير موجود | HIGH | `src/routes/api.router.js` | endpoint يرجع rows فارغة أو يفشل | استخدام `ip_hash` في unique click count | DONE |
| `visits` raw growth بلا lifecycle واضح | HIGH | `src/db/analytics.js`, `schema.js` | نمو D1 واحتفاظ بيانات زيارة أطول من اللازم | bot filtering، analytics_enabled gate، وretention cleanup متوافق | DONE |
| `/api/jobs` count + LIKE + OFFSET عميق | HIGH | `src/routes/api.router.js` | latency وD1 scans عند 100K+ وظيفة | page cap، short public cache، bounded filters وindexes مركبة؛ keyset/search index مؤجل لقياس dataset الحقيقي | PARTIAL |
| settings enum fallback قد يصبح undefined | MEDIUM | `src/lib/settings.js` | سلوك إعدادات غير متوقع بعد قيمة غير صالحة | fallback إلى default صالح في كل metadata types | DONE |
| Cron لا يملك lease عامًا لكل المهام | MEDIUM | `src/index.js` | تداخل execution وduplicate work | ترتيب analytics aggregation ثم cleanup، وlocks per provider للمزامنة؛ لا يوجد global lease لكل cron | PARTIAL |
| analytics intake لا يستعمل ctx.waitUntil من API | MEDIUM | `src/index.js`, `api.router.js` | صعوبة تسجيل trusted events دون انتظار | تمرير ctx واستخدام waitUntil في API وauth trusted events | DONE |
| Error monitoring غير مركزي | MEDIUM | `src/index.js`, routes, lib | صعوبة اكتشاف failures المتكررة | observability redacted logs وربط أخطاء feed/API؛ request-wide correlation/cron history ما زال محدودًا | PARTIAL |
| Sitemap detail pages تعتمد على heuristic 410 | MEDIUM | `src/routes/pages.router.js`, `src/db/cleanup.js` | status غير دقيق لبعض IDs المحذوفة/الفارغة | job_tombstones يحفظ identity minimal قبل الحذف، مع fallback قديم للقواعد السابقة | DONE |
| Dependency audit بلا lockfile | MEDIUM | repository root | لا يمكن تحديد vulnerabilities آليًا بـ`npm audit` | إنشاء package-lock من dependencies الحالية وتشغيل audit دون ترقية عمياء | DONE |
| CSP تسمح `unsafe-inline` | MEDIUM | `src/index.js` | يقلل فعالية CSP أمام XSS | nonce migration مستقبلية، مع إبقاء escaping الحالي وعدم توسيع origins | OPEN |
| عدم توحيد UX للـadmin unauthorized | LOW | admin subrouters | تجربة تشغيل أقل وضوحًا | analytics GET يعرض Admin Login مع إبقاء API 401؛ توحيد كل subrouters مؤجل | PARTIAL |
| growth comparison في Analytics غير متاح | LOW | `src/lib/analytics.js` | تقارير الإدارة أقل فائدة | previous equal-period percentages مع No prior baseline عند غياب البيانات | DONE |

## أولويات التنفيذ المقترحة

يجب تنفيذ الإصلاحات بالترتيب التالي: أولًا أسرار CSRF، webhook limits، refund guard، ومنع GET mutation؛ ثانيًا حدود الإدخال والـrate limiting وtrusted attribution؛ ثالثًا query performance وraw growth والفهارس المثبتة بالقياس؛ رابعًا leases/observability/cache؛ خامسًا SEO/mobile/provider/payment/analytics regression tests؛ وأخيرًا scalability/cost measurements والتوثيق النهائي.

## منهج القياس قبل إعلان الجاهزية

لن تُعلن أرقام capacity أو readiness percentage دون test فعلي. يلزم تشغيل اختبارات SQL/Worker محلية غير إنتاجية، قياس `npm test` وsyntax/bundle، اختبار endpoint statuses، فحص sitemap/robots، محاكاة provider failures، واختبار payment webhook idempotency. أما أحجام 20K/50K/100K/500K/1M jobs فتحتاج benchmark data غير إنتاجية ونتائج زمنية فعلية، أو تُعرض كتحليل معماري مشروط لا كسعة مضمونة.

**نتيجة التدقيق بعد التنفيذ:** أُغلقت المخاطر الحرجة والعالية الخاصة بـCSRF، حدود webhook، refund reservation، GET mutation، rate limiting، attribution، unique dedupe، affiliate SQL، raw visits، والـtombstones. نجحت اختبارات المشروع، وفحص syntax، و`git diff --check`، وWorker dry-run، وcron/aggregation المحلي. تبقى **قيود معلنة**: بحث `LIKE` و`OFFSET` يحتاج benchmark حقيقي قبل keyset أو محرك خارجي، CSP nonce migration لم تُجرَ، توحيد admin unauthorized جزئي، وقياس سعة 20K–1M يحتاج dataset غير إنتاجي. لذلك التصنيف هو **HARDENED WITH MEASURED LIMITATIONS** وليس إعلانًا مطلقًا لـProduction Ready أو ضمان سعة غير مقاسة.

## M. Scalability and cost review

لم يتم إدخال بيانات اصطناعية إلى بيئة الإنتاج، لذلك لا تُعرض أرقام capacity كحقائق مقاسة. المصفوفة التالية تلخص السلوك المتوقع ونقطة القياس المطلوبة:

| Scenario | Current behavior | Main bottleneck to measure | Safe next step |
|---|---|---|---|
| 20,000 jobs | D1 pagination, bounded result sets, composite status/date indexes and short public cache | Search `LIKE`, count latency and cache hit rate | Benchmark an isolated copy before changing query semantics. |
| 50,000 jobs | Same bounded request path; sync uses caps and batched writes | Search/filter scans and sitemap generation | Measure `EXPLAIN QUERY PLAN`, p95 latency and D1 rows read. |
| 100,000 jobs | Architecture remains bounded per request, but deep `OFFSET` is not guaranteed efficient | Deep pagination and free-text search | Introduce keyset pagination or a search index only after measured evidence. |
| 500,000 jobs | Not certified by this phase | D1 read cost, sitemap partitioning and sync duration | Separate search/read optimization from operational tables; test in staging. |
| 1,000,000 jobs | Not certified by this phase | Database capacity, query plans and provider ingestion volume | Evaluate a dedicated search/read model or external index based on observed cost. |

The same rule applies to 1,000, 10,000 and 100,000 daily users: Worker request isolation and caching reduce repeated work, but no concurrency or p95 claim is made without a controlled load test. Current cost controls include bounded body/event batches, deduplicated analytics, rate-limit cleanup, short public cache, provider subrequest governor, provider locks, cron leases, and retention cleanup. Payment and transaction rows are intentionally excluded from size-based deletion.

## N. Phase 15 verification record

| Check | Result | Scope |
|---|---|---|
| Repository test suite | PASS | Salary tier, homepage layout, trust strip, monetization and analytics tests. |
| JavaScript syntax | PASS | All `src/**/*.js` files. |
| Diff whitespace | PASS | `git diff --check`. |
| Dependency audit | PASS | `npm audit --audit-level=high --omit=dev` found 0 vulnerabilities. |
| Worker bundle | PASS | `npx wrangler deploy --dry-run`; no production deployment performed. |
| Local admin protection | PASS | Unauthenticated `/admin/analytics` returns the admin login page; purge returns 401. |
| Local analytics ingestion | PASS | Valid non-bot event accepted, duplicate event id was not double-counted. |
| Local aggregation | PASS | Scheduled local invocation moved the event into `analytics_daily` and created a daily hashed unique row. |
| Production verification | NOT PERFORMED | No production data or Cloudflare deployment was modified by these checks. |

The verification record is deliberately scoped: a local Worker dry-run and local D1 checks prove build and bounded behavior, not production availability, Cloudflare account configuration, real payment-provider operation, or a guaranteed capacity number.

## O. Change-management summary

| File area | Change | Reason | Risk | Test |
|---|---|---|---|---|
| CSRF, rate limiting and API parsing | Fail-closed sensitive limits, hashed limiter keys, bounded JSON, POST-only sync | Reduce abuse and configuration failure impact | Legitimate requests can be rejected during D1 outage on sensitive routes | npm test, syntax check and local status checks |
| Analytics and schema | Trusted attribution, daily unique hashes, retention, purge, bounded D1 batches | Prevent forged metrics and unbounded analytics growth | Aggregate counts intentionally remain secondary estimates | Analytics tests and local aggregation |
| Monetization | Transaction-authoritative reporting and atomic refund reservation | Prevent revenue duplication and cumulative refund overage | Existing historical rows remain authoritative and are not deleted | Monetization tests and syntax check |
| Cron, cleanup and SEO | Cron leases, tombstones, legacy visit retention and bot filtering | Prevent overlap and improve truthful 410 responses | Tombstones add a small bounded operational table | Syntax check and local Worker cron |
| Observability and admin health | Redacted operational errors and expanded System Health | Improve diagnosis without logging secrets | Health labels distinguish configuration from verified production uptime | npm test and render-path review |

The remaining open items are intentionally recorded rather than hidden: CSP nonce migration, complete admin unauthorized UX unification, deeper search benchmarking/keyset decision, and an externally configured backup/restore drill. These require either broader UI migration, real production-like data, or Cloudflare account operations beyond a safe local code change.
