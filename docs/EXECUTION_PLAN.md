# خطة التنفيذ الكاملة وحالتها

كل مرحلة تنتهي بـ: `node scripts/audit.mjs` (0 أخطاء) + `npm test` + مقارنة ناتج الصفحات عند التقسيم.

| # | المرحلة | الحالة |
|---|---|---|
| 0 | فحص شامل (166 ملف JS) + تقرير | ✅ |
| 1 | أمان وأخطاء: jf_debug، بوابة الأدمن، ADMIN_SESSION_SECRET، المعقّم، خطأ 500 للبحث، إصلاح الترحيل المتقطّع، CI | ✅ |
| 2 | سرعة وتكلفة D1: كاش حافة، Rate limit، beacons مجمّعة، Cron واحد، تحميل متوازٍ | ✅ |
| 3 | تنظيف: ملفات يتيمة، imports/رموز ميتة، نقل التقارير، robots | ✅ |
| 4 | إعادة الهيكلة: lib/ بالنطاقات، schema، api، seo-pages، home (styles/script) | ✅ (data.js للصفحة الرئيسية مؤجّل — ROADMAP) |
| 5 | Lucide والهوية: ~110 إيموجي ← SVG، توحيد CSS البطاقة | ✅ |
| 6 | ميزات احترافية (FTS5، saved searches …) | 📝 موثّقة في ROADMAP.md — لم تُنفَّذ |
| 7 | README + خريطة الملفات + تغليف ZIP | ✅ |

## أدوات التحقق المرفقة
- `tests/smoke.test.mjs`: الـWorker الحقيقي على SQLite تحاكي D1 (100+ تأكيد).
- `scripts/audit.mjs`: syntax + import/export + يتامى + imports غير مستخدمة.
