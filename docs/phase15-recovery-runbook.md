# JobForion Phase 15 — Backup, Recovery & Disaster Runbook

## Scope

هذا المستند يحدد طريقة حماية واستعادة بيانات JobForion الحرجة مع الحفاظ على الفصل بين بيانات التشغيل، بيانات المدفوعات، Analytics، والسجلات المؤقتة. لا ينفذ Worker نسخًا احتياطيًا تلقائيًا داخل طلبات المستخدم أو الـcron؛ فالنسخ الاحتياطي عملية تشغيلية مستقلة حتى لا تضيف حملًا أو خطرًا على حركة الموقع.

## ما يجب نسخه احتياطيًا

| Data set | Priority | Recommended treatment |
|---|---:|---|
| `jobs`, `companies`, `users`, applications and saved jobs | Critical | D1 export before schema changes and on the daily schedule. |
| `monetization_orders`, `monetization_transactions`, `monetization_refunds`, webhook event records | Critical | Retain according to business/legal policy; never delete them as a size optimization. |
| `site_settings`, CMS pages/blog content, categories and API-source configuration metadata | High | Include in D1 export; provider secrets are backed up separately in the secret manager, never in the database export. |
| R2 company assets and uploaded media | High | Use versioning/replication or an independent object-storage backup policy. |
| Analytics queue and aggregates | Medium | Use the configured retention policy; export only when needed for reporting or compliance. |
| `rate_limits`, temporary queues and local cache state | Low | Rebuildable; do not treat them as business backups. |

## Frequency and storage

يوصى بتصدير D1 مرة يوميًا مع نسخة إضافية قبل كل migration أو تغيير كبير، والاحتفاظ بنسخ يومية لمدة 30 يومًا ونسخ شهرية لمدة 12 شهرًا على الأقل، مع تعديل المدة وفق متطلبات العمل والقانون. يجب وضع النسخ في مساحة تخزين خاصة ومشفرة ومنفصلة عن الحساب أو المنطقة التشغيلية الأساسية كلما أمكن، مع تفعيل versioning وقيود وصول least-privilege. لا تُحفظ كلمات المرور أو API keys أو payment secrets داخل ملفات النسخ الاحتياطي إلا إذا كانت جزءًا من نظام الأسرار المخصص وبسياسة منفصلة.

## Recovery procedure

1. أوقف النشر أو الـmigration الذي سبب المشكلة، ولا تنفذ SQL تدميريًا إضافيًا على قاعدة الإنتاج.
2. احفظ نسخة تشخيصية read-only من الحالة الحالية، وسجل وقت الحادث ورقم commit والـcron المتأثر.
3. استعد النسخة إلى قاعدة D1 منفصلة أو بيئة staging أولًا، ثم شغّل schema bootstrap والتحقق من الأعمدة والفهارس.
4. تحقق من عدد الصفوف، unique constraints، آخر transaction مرجعي، حالات الطلبات، وعدد الوظائف النشطة، ثم افحص روابط الصفحات و`/sitemap.xml` و`/robots.txt`.
5. اختبر login، البحث، صفحة وظيفة، company page، admin authorization، إنشاء order pending، وwebhook idempotency في البيئة المستعادة دون استخدام بيانات دفع حقيقية.
6. بعد موافقة التشغيل، نفذ cutover وفق إعدادات Cloudflare/D1 المعتمدة، ثم راقب 5xx وD1 errors وprovider failures وpayment/webhook failures.
7. سجّل نتيجة الاستعادة والفرق بين backup والبيانات الحالية، ولا تحذف النسخة الأصلية أو قاعدة الإنتاج القديمة قبل انتهاء فترة التحقق.

## Disaster scenarios

| Scenario | Safe response |
|---|---|
| Worker failure | Roll back to the last verified GitHub commit; keep D1 unchanged and inspect Worker logs. |
| D1 outage | Keep public reads graceful where possible, pause mutating admin/sync actions, and restore only after the provider confirms database health. |
| Bad migration | Stop further deploys, restore to a separate database, compare schema and data, then apply a forward additive repair; do not casually drop production tables. |
| Accidental deletion | Recover the latest verified D1 export or use the operational lifecycle/tombstones for deleted jobs; never infer financial recovery from Analytics. |
| Provider outage | Pause or defer the affected source, rely on per-provider sync isolation, and allow other providers to continue. |
| Payment provider outage | Keep checkout unavailable rather than simulating success; accept only verified webhook state and reconcile transactions after recovery. |
| Analytics failure | Keep search, job view, apply, auth and payment flows available; inspect queue/cron health and replay only bounded, deduplicated events. |

## Validation and ownership

يجب إجراء اختبار استعادة كامل على الأقل ربع سنويًا، وبعد أي تغيير كبير في schema أو Cloudflare bindings. هذه الوثيقة توصف **إجراء التشغيل المطلوب** ولا تدّعي أن النسخ الاحتياطي الخارجي أو replication قد فُعّل تلقائيًا في حساب Cloudflare؛ تفعيل ذلك يتم من إعدادات الحساب وسياسة فريق التشغيل، مع تسجيل آخر وقت نجاح في سجل الحوادث الداخلي.

## Migration safety

كل تغييرات Phase 15 في `src/db/schema.js` additive وidempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` و`ensureColumn`). قبل كل نشر يجب تشغيل الاختبارات، `git diff --check`، Worker dry-run، ومراجعة SQL. لا يتضمن هذا الـphase حذف جداول التشغيل أو الطلبات أو المعاملات المالية.

## Operational checklist

- [ ] Export D1 before migration.
- [ ] Verify backup can be downloaded and opened in an isolated environment.
- [ ] Record commit SHA and schema change summary.
- [ ] Confirm no secrets are inside the export or logs.
- [ ] Run post-restore functional smoke tests.
- [ ] Record recovery result and retention date.
- [ ] Keep production deployment claims separate from local dry-run results.

**Owner:** JobForion operations team

**Status:** Documented runbook; external backup scheduling and restore drill must be enabled and performed in the Cloudflare account according to the team’s operating policy.

> لا يُعد وجود هذا المستند وحده إثباتًا بأن backup أو disaster recovery قد اختُبر في الإنتاج؛ إثبات الجاهزية يتطلب export وrestore drill فعليين في بيئة معزولة.

## References

- [Cloudflare D1 documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare R2 documentation](https://developers.cloudflare.com/r2/)
