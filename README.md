# JobForion

لوحة وظائف عن بُعد مبنية على **Cloudflare Workers + D1 (SQLite)** — بدون خادم تقليدي.

- **الموقع:** https://jobforion.com
- **المستودع الرئيسي:** GitLab (`jobforion-group/JobForion`) — يُزامَن تلقائياً إلى GitHub عبر Push Mirror
- **النطاق:** يُدار من سطر واحد: `BASE_URL` في `src/config/constants.js`. النطاقات القديمة تُعاد توجيهها 301 عبر `RETIRED_HOSTS` في `src/index.js`

---

## خريطة المشروع

```
jobforion/
├─ wrangler.toml          ← إعدادات Worker + جدولة الكرون
├─ package.json
└─ src/
   ├─ index.js            ← نقطة الدخول (راوتر رفيع + إعادة توجيه النطاقات القديمة)
   ├─ config/             ← constants.js: BASE_URL + التصنيفات
   ├─ routes/             ← معالجات HTTP (كل ملف = مجموعة مسارات، يُرجع null إن لم يختص)
   │  ├─ pages.router.js      /  /job/:id  /blog  /privacy ...
   │  ├─ seo-pages.router.js  /categories /companies /skills /search
   │  ├─ admin.router.js      /admin/* (محمي بكوكي HMAC)
   │  ├─ api.router.js        /api/* (jobs, subscribe, post-job, sync)
   │  ├─ feed.router.js       /sitemap.xml  /feed.rss
   │  └─ assets.router.js     /favicon.*  /manifest.json  /robots.txt
   ├─ pages/              ← توليد HTML (home, job-page, blog, admin/...)
   ├─ components/         ← nav, footer, job-card, ad-slot, post-job-modal
   ├─ layout/             ← base-layout.js (قالب HTML العام)
   ├─ styles/             ← shared-css.js (كل التنسيقات المشتركة)
   ├─ providers/          ← 9 مزوّدي وظائف، إضافة مزوّد = ملف + سطر في index.js
   ├─ db/                 ← schema (ترحيل آمن)، sync، cleanup، analytics
   ├─ auth/               ← admin-auth.js (كوكي HMAC بلا جلسات)
   ├─ lib/                ← أدوات SEO: sitemap, meta, JSON-LD, escapeHtml, cache
   ├─ data/               ← محتوى ثابت (مدونة، صفحات)
   └─ assets/             ← favicon, manifest, أيقونات SVG
```

## كيف يعمل

1. **الطلبات:** `index.js` يمرر كل طلب على الراوترات بالترتيب، أول راوتر يتعرف على المسار يرد.
2. **المزامنة:** كرون `0 */6 * * *` يسحب الوظائف من المزوّدين النشطين إلى D1 (دفعات batch).
3. **التنظيف:** كرون `0 3 * * *` يحذف الوظائف منتهية الصلاحية أو الراكدة (+30 يوم بلا تحديث).
4. **الإدارة:** `/admin` محمية بكلمة مرور (سر `ADMIN_PASSWORD`) وكوكي موقّع HMAC.
5. **Featured Remote Employers:** شريط ديناميكي في الصفحة الرئيسية يعرض أعلى 6 شركات حسب عدد الوظائف، والضغط على الشركة يفتح موقعها الرسمي في تبويب جديد.

## الإعداد والنشر

```bash
# الأسرار (مرة واحدة)
wrangler secret put API_KEY
wrangler secret put ADMIN_PASSWORD

# التطوير المحلي
npm run dev

# النشر
npx wrangler deploy
```

سير العمل: عدّل على GitLab → ادمج في `main` → المزامنة إلى GitHub تلقائية → انشر بـ `wrangler deploy`.

## ملاحظات مهمة

- **الخطة المجانية:** حد 50 طلباً فرعياً لكل تنفيذ — المزامنة مصممة للتعامل معه.
- **الأمان:** كل محتوى خارجي يمر عبر `escapeHtml()`. استعلامات SQL كلها parameterized.
- **ديون مؤجلة (للإصلاح لاحقاً):** حماية `/api/sync` بمصادقة، فصل سر الجلسة عن `ADMIN_PASSWORD`، إضافة rate limiting، ونقل `deploy.yml` من `src/.github/workflows/` إلى جذر المستودع لتفعيل النشر التلقائي.
