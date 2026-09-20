# JobForion — تقرير استكمال وثيقة Design System وAdmin Control Center

**المشروع:** JobForion — Cloudflare Workers ES Modules + D1 + R2 + Workers AI.

**النطاق:** استكمال المتطلبات القابلة للتنفيذ بأمان فوق النسخة الحالية، من دون إعادة بناء أو تغيير المعمارية أو استبدال الواجهة المطورة أو تغيير binding/model الخاص بـWorkers AI.

**الحالة الحالية:** **NOT READY لإعلان تحقق الإنتاج الكامل** إلى أن تُنشر هذه الجولة ويُجرى قبول مصادق عليه على بيئة الإنتاج. أما التغييرات البرمجية نفسها فقد اجتازت الفحوص المحلية الموضحة أدناه.

## 1. المعمارية قبل الاستكمال

كان الموقع يستخدم Worker واحدًا بنمط ES Modules في `src/index.js`، مع SSR HTML للصفحات العامة والإدارة والحسابات، وطبقات منفصلة للـroutes والـpages والـcomponents والـlib وD1 وR2 وproviders. كانت `site_settings` مصدرًا للإعدادات العامة، وكان `homepage_sections` يتحكم في تفعيل وترتيب مجموعات الصفحة الرئيسية، بينما كان `job_card_styles` يتحكم في شكل بطاقات الوظائف حسب النوع.

كانت Theme Engine السابقة تغطي appearance الأساسية، لكن Company Card وNavigation ونسخًا من homepage كانت تعتمد جزئيًا على literals داخل renderer. كما كانت بعض مفاتيح AI وSEO غير قابلة للإيقاف التفصيلي من لوحة الإدارة، وكان Hot KPI الإداري يعتمد على `salary_max_usd` فقط، فلا يطابق سياسة HOT PAY التي تستخدم midpoint للنطاق.

## 2. المعمارية بعد الاستكمال

أصبحت `site_settings` مصدرًا موحدًا للقيم الإضافية من دون إنشاء جدول إعدادات موازٍ. يمر كل إعداد جديد عبر `SETTINGS_KEYS` وvalidation المركزي، وتعود القيم الفاسدة أو الغائبة إلى defaults آمنة. ينتج `resolveTheme()` كائنًا موحدًا، بينما يحول `themeCssVariables()` القيم إلى CSS variables مقيدة تُحقن في `base-layout.js` وفي homepage renderer المستقل.

يستمر `homepage_sections` في التحكم بالتفعيل والترتيب ضمن جميع كتل Homepage الحالية، بينما تحفظ `homepage_custom_sections` الأقسام التي ينشئها المشرف. ويستمر `job_card_styles` في التحكم التفصيلي المنظم ببطاقات الوظائف. أما HTML/CSS/JavaScript الخام فيبقى محصورًا في محرر Code Blocks المعزول، ولا يتحول النظام إلى page builder حر داخل Theme controls.

## 3. CSS وتنظيم Design System

تم توصيل Company Card وNavigation وhomepage بالـtokens المركزية بدل إدخال stylesheet override أو طبقة patch جديدة. تتضمن tokens الجديدة مقاييس Company Card، وحجم الشعار، وpadding، وgrid gap، وshadow، وسلوك hover، إضافة إلى حجم شعار Navigation وارتفاع header وgap وCTA state. تستخدم البطاقة المتغيرات مع fallback داخلي، وتحتفظ بتخفيضات mobile الآمنة للحفاظ على قابلية القراءة في الشاشات الصغيرة.

| المجموعة | ما أصبح مركزيًا | المصدر |
|---|---|---|
| Appearance | الألوان، السطوح، النصوص، الحدود، radius، العرض، المسافات، density، الخطوط | `src/lib/settings.js` |
| Company Card | radius، padding، logo size، grid gap، shadow، hover | `themeCssVariables()` و`company-card.js` |
| Navigation | logo size، header height، gap، CTA label، إظهار CTA | `themeCssVariables()` و`nav.js` و`shared-css.js` |
| Homepage Copy | عناوين الأقسام، الأوصاف، أزرار CTA | `HOMEPAGE_COPY_DEFAULTS` و`home.js` |
| Motion/spacing | transition وspacing scale وradius variants | `themeCssVariables()` و`shared-css.js` |

لم تُحذف كل القيم literal من المصدر؛ جرى نقل القيم الواضحة والمؤثرة فقط. أما CSS المضمن داخل SSR والصفحات التي لا توجد لها contract موحدة فما زال مصنفًا **MIGRATE/KEEP** وليس DELETE، لأن حذفًا واسعًا بلا تحقق بصري قد يعيد التصميم القديم أو يكسر mobile layout.

## 4. تنظيف الكود المكرر وDead Code

أُجري repository-wide scan للـimports والـexports ومراجع routes وHTML strings وdynamic SSR usage وcron usage وadmin navigation. لم يُحذف أي ملف أو component أو API أو function، لأن العناصر المرشحة لم يثبت أنها غير مستخدمة بعد احتساب string-based references وroute composition وSSR.

| نوع الحذف | النتيجة | سبب القرار |
|---|---|---|
| ملفات | لا يوجد | لا توجد ملفات غير مستخدمة مثبتة بأمان |
| components | لا يوجد | Job Card وCompany Card وNavigation لها implementations authoritative واضحة |
| APIs/routes | لا يوجد | قد تكون routes مستعملة من forms أو cron أو redirects |
| CSS selectors | نقل محدود إلى tokens فقط | الحذف الشامل يحتاج mapping بصري لكل صفحة |
| imports/functions | لا يوجد حذف | لم يثبت عدم الاستخدام في runtime الديناميكي |

## 5. Design System وTheme Engine

تضم `APPEARANCE_DEFAULTS` appearance الأساسية، وتضم `COMPONENT_DEFAULTS` إعدادات Company Card وNavigation، وتضم `HOMEPAGE_COPY_DEFAULTS` النصوص المدعومة للواجهة الرئيسية. تحفظ هذه القيم additive في `site_settings` وتستفيد من cache الحالي ذي TTL قدره 60 ثانية، مع إسقاط cache فور `setSettings()`.

التحقق يفرض hex colors، وأرقامًا bounded، وenums محددة للخطوط والكثافة والظلال وسلوك hover، ونصوصًا مقصوصة إلى حد أقصى. لا تصل القيم إلى CSS إلا بعد sanitation، ولا توجد مدخلات raw CSS أو raw HTML أو raw JavaScript في لوحة الإدارة.

## 6. Admin Control Center

تحتوي `/admin/settings` الآن على أسطح التحكم التالية ضمن form مركزي واحد محمي:

| السطح | التحكم المتاح |
|---|---|
| Appearance Theme | colors، typography، density، radius، container width، section spacing، card gap |
| Company Card | radius، padding، logo size، grid gap، shadow، hover، preview حي |
| Navigation | logo size، header height، gap، CTA label، إظهار/إخفاء CTA |
| Homepage Copy | عناوين وأوصاف وCTA للأقسام المدعومة فقط |
| SEO & Indexing | `seo_indexing_enabled` لإصدار `noindex, nofollow` للصفحات العامة عند التعطيل |
| Job Sync | warm-up threshold وper-provider caps |
| HOT PAY | enable switch وannual threshold |
| AI | kill switch عام ومفاتيح مستقلة لكل feature |
| Maintenance | تشغيل الصيانة ورسالة الزوار |
| Feature Flags | blog، job alerts، company/country/skill pages، featured jobs |
| Analytics/Social/General | الإعدادات العامة الموجودة سابقًا |

تتحكم الصفحة الآن في جميع كتل Homepage الحالية عبر Homepage Builder الآمن، بما في ذلك Hero وFeatured Companies وCategories وJob Listing وبطاقات Job Alerts وBoost Your Career وCareer Resources وCareer Insights وTrust Strip وEmployer CTA. كما تسمح بإنشاء أقسام Homepage مخصصة محدودة الحقول مع HTML/CSS/JavaScript معزول داخل iframe sandbox. تبقى Theme controls نفسها دون raw code، وتوجد لكل مجموعة إعدادات reset مستقلة مثل `reset-appearance` و`reset-components` و`reset-homepage-copy`.

## 7. Backend Control

أضيفت مفاتيح AI التالية مع enforcement داخل `runAiRequest()` قبل استدعاء binding: `ai_foundation_smoke_enabled` و`ai_job_intelligence_enabled` و`ai_matching_enabled` و`ai_career_assistant_enabled` و`ai_content_intelligence_enabled` و`ai_admin_assistant_enabled`. يبقى `ai_enabled` kill switch عامًا.

أضيف `seo_indexing_enabled` إلى allow-list الخاصة بالإعدادات، وتستخدمه homepage و`baseLayout` لتغيير meta robots فقط عندما يكون الإعداد عامًا ومفتوحًا. لا يغير هذا المفتاح routes أو يحذف sitemap، ويظل sitemap متاحًا للفحص التشغيلي. كما صُحح Dashboard Hot KPI ليستخدم min-only وmax-only وmidpoint للنطاقات وفق `src/lib/hot-pay.js`.

## 8. Analytics وDashboard

يستخدم Dashboard بيانات D1 الحقيقية فقط. يعرض KPIs للوظائف الكلية والنشطة والمتوقفة والمغلقة والمنتهية والمؤرشفة، provider/employer jobs، expiring jobs، cleanup deletions، companies، users، subscribers، articles، visits، pending postings، skills sampled، وAI Activity.

توجد charts/برمجيات عرض للزيارات خلال 14 يومًا، الوظائف حسب category، الوظائف حسب source، AI Activity حسب feature، top pages، top countries، مع حالات empty state عند غياب البيانات. تبقى System Health ظاهرة لـWorker وD1 والمزودين وآخر sync وآخر cleanup. لا يُعرض أي billing-grade inference usage مصطنع؛ AI Activity يعتمد على `admin_activity_log` وstructured operational events.

## 9. قاعدة البيانات والتخزين

لم تُضف migration destructive. استخدمت الجولة الحالية مفاتيحًا additive داخل `site_settings` الموجودة أصلًا. لا تحتاج Company Card أو Navigation أو Homepage Copy أو AI feature flags إلى جدول جديد. يبقى schema bootstrap المركزي في `src/db/schema.js` هو المصدر لجداول التطبيق وAI.

يستمر R2 في استخدام `COMPANY_ASSETS` مع مفاتيح company asset المقيدة، ويرفض المسارات المتلاعبة. لا تغيّر هذه الجولة naming convention أو public asset policy.

## 10. الأمان

يستمر admin cookie وcentral CSRF gate في `src/routes/admin.router.js`، مع token في forms و`X-Admin-CSRF` لطلبات الإدارة ذات JSON. routes reset الجديدة تتحقق من admin authentication وCSRF قبل الكتابة وتستخدم allow-listed defaults فقط.

تُهارب نصوص Homepage Copy قبل SSR، وتُقيد القيم الرقمية والـenums، ولا توجد صلاحية raw code execution. لا تصل `env.AI` أو secrets إلى المتصفح. تبقى CSP دون `img-src *`، وتبقى روابط الصور الخارجية محكومة بمسار logo proxy أو R2 الموثق. لا تتأثر auth أو rate limits أو ownership checks.

## 11. الأداء والتوافق

تستخدم الإعدادات cache الحالي، ولا توجد query منفصلة لكل بطاقة أو لكل عنصر في الصفحة. لا يستدعي Company Card أو Navigation D1 بنفسه؛ يستهلك CSS variables أو settings الممررة أصلًا. AI feature switches تنهي الطلب قبل inference عند التعطيل، وDashboard Hot KPI يستخدم استعلامًا bounded على الأعمدة normalized بدل تحميل descriptions.

أُبقيت defaults كاملة عند فشل D1 أو غياب keys، كما بقيت الصفحات العامة وroutes القديمة متوافقة. لم يُغيّر هذا الاستكمال بنية Worker أو provider integrations أو R2 bindings أو AI model.

## 12. الاختبارات المنفذة

| الاختبار | النتيجة |
|---|---|
| `node --check` للملفات المتأثرة | PASS |
| `git diff --check` | PASS قبل آخر staging النهائي، وسيعاد في gate النهائي |
| Theme/CSRF unit | `THEME_CSRF_UNIT=PASS` |
| Company Card/Navigation/Homepage Copy/AI switches | `COMPLETION_CONTROLS_UNIT=PASS` |
| AI switch disabled prevents binding call | PASS داخل completion unit |
| AI service وJob Intelligence وMatching وCareer Assistant | PASS في regression السابقة |
| Admin Assistant وContent Intelligence وAI Control Center | PASS في regression السابقة |
| HOT PAY وR2/security/lifecycle | PASS في regression السابقة |
| Admin central CSRF gate | `ADMIN_CSRF_GATE_UNIT=PASS` |
| Static guards وsecret scan | PASS في regression السابقة؛ لا توجد أسرار فعلية |
| Local Worker fresh smoke | `/`, `/jobs`, `/companies`, `/blog`, `/robots.txt`, `/sitemap.xml`, `/api/jobs` = 200 |
| Unauthenticated account endpoint | `/api/user/saved-jobs` = 401 |
| Admin auth gate | `/admin/settings` أعاد login gate للزائر |
| Homepage markers | ظهرت `--nav-header-height:72px` و`--company-card-radius:14px` وcopy الحالية |
| Security headers | CSP وReferrer-Policy وXCTO وXFO موجودة |
| Wrangler local binding view | D1 وR2 ظهرا، وAI ظهر `not supported` في local inference |

الفحص البصري من المتصفح أظهر استمرار header والـhero والبحث والفلاتر وcategory grid وlatest jobs/sidebar/editorial/footer ضمن التصميم المطور. تعذر رفع screenshot في أحد تنقلات `/jobs`، لذلك لا يُدّعى أكثر من دليل DOM/status لذلك المسار. كما أن قاعدة D1 المحلية لا تحتوي jobs مملوءة، فلا يثبت smoke المحلي جميع حالات البطاقات المملوءة أو كل tiers.

## 13. الملفات المعدلة في جولة الاستكمال

| الملف | التعديل |
|---|---|
| `src/lib/settings.js` | defaults وmetadata وvalidation لـCompany Card وNavigation وHomepage Copy وAI switches وSEO |
| `src/lib/ai-service.js` | enforcement لمفاتيح AI feature قبل binding |
| `src/components/company-card.js` | استهلاك tokens للـradius/padding/logo/gap/shadow/hover |
| `src/components/nav.js` | CTA label وvisibility من settings |
| `src/styles/shared-css.js` | header/logo/navigation spacing tokens |
| `src/pages/home.js` | Homepage Copy وSEO robots وحقن theme variables في homepage renderer |
| `src/pages/admin/settings.js` | Company Card وNavigation وHomepage Copy وSEO وAI controls وpreviews/resets |
| `src/routes/admin/website.router.js` | reset routes جديدة وscope reset الصحيح لـAppearance |
| `src/pages/admin/dashboard.js` | Hot KPI مطابق لسياسة midpoint وmin/max-only |
| `README.md` | توثيق controls والـAI switches والـSEO والاختبارات |
| `DESIGN_SYSTEM_CONTROL_CENTER_REPORT.md` | هذا التقرير |

لم تُنشأ ملفات runtime جديدة، ولم تُحذف ملفات، ولم تُضمّن اختبارات `/tmp` أو `.wrangler` في المستودع.

## 14. القضايا المتبقية والمخاطر

يبقى تنظيف CSS الشامل غير مكتمل؛ ما زالت بعض القيم inline وblobs داخل SSR، ولم تُحذف إلا التكرارات التي ثبت نقلها إلى tokens. يحتاج هذا البند إلى refactor مستقل مع snapshots لكل route حتى لا تتأثر الواجهة الجديدة.

لا يوجد اختبار authenticated production لهذه الجولة. لذلك لم يُثبت بعد save/reset الحقيقي من `/admin/settings` داخل حساب admin، ولم يُختبر R2 replacement الحقيقي، ولم تُنفذ Workers AI inference حقيقية في local لأن Wrangler يعرض binding AI كـ`not supported` في local mode.

يظل `seo_indexing_enabled` تحكمًا في meta robots للـHTML وليس مفتاح حذف أو تعطيل sitemap. إذا كان المطلوب منع الزحف بالكامل، يجب إضافة سياسة robots ديناميكية مع مراجعة مستقلة لأثر cache قبل تفعيلها.

تظل صور بعض company records القديمة التي تحتوي `logo_url` خارجيًا خاضعة لـCSP الحالية، بينما يظل المسار الموحد المفضل هو override/R2/Worker logo proxy. لم تُوسّع CSP إلى مضيفات عامة لتجنب إضعاف الأمان.

## 15. Production Readiness

**NOT READY — blockers الدقيقة:**

| blocker | السبب |
|---|---|
| النشر الفعلي لهذه الجولة لم يُثبت بعد | الاختبارات الحالية local وdry-run، وليست remote production acceptance |
| admin authenticated acceptance غير منفذ | لا يمكن تأكيد save/reset وCSRF عبر حساب إنتاج حقيقي من دون جلسة مصادق عليها |
| Workers AI inference production غير منفذ | local Wrangler لا يدعم inference؛ يلزم smoke مصرح وآمن على البيئة المرتبطة بـ`AI` |
| R2 replacement production غير منفذ | اختبارات الترتيب والـrollback mock/unit فقط، من دون تعديل كائنات إنتاجية |
| CSS full cleanup غير مكتمل | بقيت literals وinline SSR مصنفة MIGRATE لا DELETE حفاظًا على الواجهة |

النتيجة الدقيقة: **التغييرات آمنة وقابلة للدمج بعد gate النهائي، لكنها ليست إثباتًا بأن الإنتاج يحملها أو أن كل بنود الوثيقة أصبحت READY**. بعد نجاح commit/push والنشر المصرح، يجب تنفيذ smoke غير مدمر لـhomepage وjobs وadmin settings وAI Control Center وR2 asset وrobots/meta، ثم تحديث الحالة إلى READY فقط إذا نجحت تلك الخطوات.

## 16. Post-audit D1 incident fix

بعد تشغيل النسخة المنشورة ظهر خطأ يمنع تحميل لوحة التحكم: `D1_ERROR: no such column: metadata at offset 15`. فحص schema أثبت أن الجدول `admin_activity_log` يعرف العمود `meta`، وهو الاسم الذي تستخدمه `logActivity()` و`CREATE TABLE`، بينما كان Dashboard يطلب `metadata` مباشرة في استعلام AI activity. لم تُمسح أي بيانات ولم يتغير schema الإنتاجي؛ صُحح الاستعلام إلى `SELECT action, meta AS metadata ...` حتى يبقى منطق العرض كما هو مع استخدام العمود الفعلي في D1.

أُعيد اختبار renderer عبر mock D1، وأثبت الاختبار `DASHBOARD_METADATA_UNIT=PASS` أن الاستعلام الجديد يستخدم `meta AS metadata` ولا يرسل الصيغة القديمة. كما شُغّل Worker محلي جديد، وأنشأ schema من المصدر، وأثبت PRAGMA أن الأعمدة الفعلية هي `id`, `action`, `target`, `meta`, و`created_at`، مع استجابة homepage `200`. لم يُنفذ أي أمر على قاعدة الإنتاج خلال التشخيص.

## References

[1]: ./src/lib/settings.js "Central settings, defaults, validation, and Theme Resolver"
[2]: ./src/lib/ai-service.js "Central Workers AI service and feature gates"
[3]: ./src/pages/home.js "Homepage SSR renderer and homepage copy"
[4]: ./src/pages/admin/settings.js "Admin settings controls and previews"
[5]: ./src/routes/admin/website.router.js "Admin settings/reset routes and CSRF checks"
[6]: ./src/pages/admin/dashboard.js "Real D1-backed dashboard metrics"
[7]: ./src/components/company-card.js "Authoritative Company Card component"
[8]: ./src/components/nav.js "Shared desktop/mobile navigation"
[9]: ./src/styles/shared-css.js "Shared public CSS and navigation tokens"
[10]: ./src/lib/hot-pay.js "HOT PAY normalization and classification policy"
