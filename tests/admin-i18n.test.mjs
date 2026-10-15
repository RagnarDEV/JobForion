// Admin Arabic (RTL) layer: translator, localizer, dictionary integrity, and admin-only scope.
import assert from 'node:assert/strict';
import { D1Shim } from './helpers/d1-shim.mjs';
import { makeTranslator, translateHtml, extractStrings, decodeEntities } from '../src/lib/admin-i18n/translate.js';
import { localizeHtml, localizeRedirect, localizeAdminResponse, getAdminLang } from '../src/lib/admin-i18n/localize.js';
import { AR_EXACT, AR_PATTERNS } from '../src/lib/admin-i18n/ar/index.js';
import { adminShell } from '../src/pages/admin/shell.js';

const tr = makeTranslator({ exact: AR_EXACT, patterns: AR_PATTERNS });
const T = (s) => tr.translate(s);

// ── translator: what changes, what must NOT ──
assert.equal(T('Dashboard'), 'لوحة التحكم');
assert.equal(T('  Save\n   settings '), 'حفظ الإعدادات', 'whitespace is normalised');
assert.equal(T('Acme & Sons Ltd'), null, 'company names / data are never touched');
assert.equal(T('Saved'), 'محفوظ');
assert.equal(T('Job deleted'), 'تم حذف الوظيفة', 'a numeric "{a}d" pattern must not swallow "Job delete" + d');
assert.equal(T('Page 2 of 9'), 'صفحة 2 من 9');
assert.equal(T('7d'), '7 يوم');
assert.equal(T('Reset Featured to the curated default style?'), 'إعادة ضبط المميّز إلى النمط الافتراضي المنسّق؟');
assert.equal(T('Every 3 hours · 00 · 03 · 06 · 09 · 12 · 15 · 18 · 21 UTC'), 'كل 3 ساعات · 00 · 03 · 06 · 09 · 12 · 15 · 18 · 21 UTC', 'all nine captures substituted');
assert.equal(T('~12 / 55,000 rows (0%)'), '~12 / 55,000 صف (0%)');

const html = [
  '<h1> Dashboard </h1>',
  '<input placeholder="Search title or company…" title="Delete" aria-label="Close">',
  '<form onsubmit="return confirm(\'Delete this job permanently?\')">x</form>',
  '<button onclick="if(window.goView=>1){}"> Save </button>',                // '>' inside a quoted attribute
  '<code>Dashboard</code><pre>Save</pre><textarea>Cancel</textarea>',
  '<script>jnToast(\'Cache purged\'); var Dashboard = 1; confirm("Cancel")</script>',
  '<style>.Dashboard{color:red}</style>',
  '<td>Senior Dashboard Engineer</td><td>Acme &amp; Sons</td>',
  '<!-- Dashboard -->',
].join('\n');
const out = translateHtml(html, tr);
assert.ok(out.includes('<h1> لوحة التحكم </h1>'));
assert.ok(out.includes('placeholder="ابحث بالعنوان أو الشركة…"') && out.includes('title="حذف"') && out.includes('aria-label="إغلاق"'));
assert.ok(out.includes("confirm('حذف هذه الوظيفة نهائياً؟')"), 'confirm() text in on* attributes');
assert.ok(out.includes('> حفظ </button>'), 'tags containing > in attribute values are tokenised correctly');
assert.ok(out.includes('<code>Dashboard</code><pre>Save</pre><textarea>Cancel</textarea>'), 'code / pre / textarea untouched');
assert.ok(out.includes("jnToast('تم مسح الذاكرة المؤقتة')") && out.includes('var Dashboard = 1') && out.includes('confirm("إلغاء")'), 'only string literals in scripts');
assert.ok(out.includes('.Dashboard{color:red}'), 'style untouched');
assert.ok(out.includes('Senior Dashboard Engineer') && out.includes('Acme &amp; Sons'), 'data cells untouched, entities preserved');
assert.ok(out.includes('<!-- Dashboard -->'));
assert.equal(translateHtml('<p>Delete</p>', tr), '<p>حذف</p>');
// escaping: an Arabic value can never inject markup
const evil = makeTranslator({ exact: { Hi: '<img src=x onerror=alert(1)>' } });
assert.equal(translateHtml('<p>Hi</p>', evil), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
assert.equal(translateHtml('<a title="Hi">x</a>', evil), '<a title="&lt;img src=x onerror=alert(1)&gt;">x</a>');
assert.deepEqual([...extractStrings('<p>Hello there</p><i title="Tip text"></i>')].sort(), ['Hello there', 'Tip text']);
assert.equal(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;'), 'a & b <c> "d" \'e\'');

// ── localizer ──
const page = '<!DOCTYPE html>\n<html lang="en"><head><title>Admin — JobForion</title></head><body><p>Dashboard</p></body></html>';
const ar = localizeHtml(page);
assert.ok(ar.includes('<html lang="ar" dir="rtl"') && ar.includes('Noto+Sans+Arabic') && ar.includes('html[dir="rtl"]'));
assert.ok(ar.includes('<title>الإدارة — JobForion</title>') && ar.includes('<p>لوحة التحكم</p>'));
const req = (cookie) => new Request('https://x.test/admin', { headers: cookie ? { Cookie: cookie } : {} });
assert.equal(getAdminLang(req('adm_lang=ar')), 'ar');
assert.equal(getAdminLang(req('a=1; adm_lang=ar; b=2')), 'ar');
for (const bad of [undefined, 'adm_lang=en', 'adm_lang=fr', 'adm_lang=ar<script>', 'xadm_lang=ar', 'adm_lang=arabic']) assert.equal(getAdminLang(req(bad)), 'en', `cookie ${bad} → English`);
const htmlRes = () => new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(page.length) } });
const untouched = htmlRes();
assert.equal(await localizeAdminResponse(untouched, req()), untouched, 'English responses are returned as the same object — zero cost');
const localized = await localizeAdminResponse(htmlRes(), req('adm_lang=ar'));
assert.match(await localized.text(), /dir="rtl"/);
assert.equal(localized.headers.get('Content-Language'), 'ar'); assert.equal(localized.headers.get('Content-Length'), null);
const json = new Response('{"a":"Dashboard"}', { headers: { 'Content-Type': 'application/json' } });
assert.equal(await (await localizeAdminResponse(json, req('adm_lang=ar'))).text(), '{"a":"Dashboard"}', 'JSON untouched');
assert.equal(localizeRedirect('/admin/jobs?q=a&flash=Job%20deleted&page=2'), '/admin/jobs?q=a&flash=%D8%AA%D9%85+%D8%AD%D8%B0%D9%81+%D8%A7%D9%84%D9%88%D8%B8%D9%8A%D9%81%D8%A9&page=2');
assert.equal(localizeRedirect('/admin?flash=Some%20unknown%20message'), '/admin?flash=Some%20unknown%20message', 'unknown messages pass through');
const redirect = new Response(null, { status: 302, headers: { Location: '/admin?flash=Settings%20saved' } });
assert.match((await localizeAdminResponse(redirect, req('adm_lang=ar'))).headers.get('Location'), /flash=.+/);
assert.ok(!(await localizeAdminResponse(new Response(null, { status: 302, headers: { Location: '/admin?flash=Settings%20saved' } }), req('adm_lang=ar'))).headers.get('Location').includes('Settings'));

// ── dictionary integrity ──
const placeholders = (s) => [...String(s).matchAll(/\{~?(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const [en, arText] of Object.entries(AR_PATTERNS)) assert.equal(placeholders(en), placeholders(arText), `placeholders match: ${en}`);
const technicalOk = /^(Cloudflare Worker|Ashby|Greenhouse|Lever|Recruitee|Teamtailor|Workable|Workday|[A-Za-z0-9 ./·+–—-]+)$/;
for (const [en, arText] of Object.entries({ ...AR_EXACT })) {
  assert.ok(arText && arText.trim() === arText, `value not empty/padded: ${en}`);
  assert.ok(/[\u0600-\u06FF]/.test(arText) || technicalOk.test(arText), `Arabic value expected: ${en}`);
  assert.ok(!/[<>]/.test(arText) || /^(<|>)/.test(arText) === false, `no markup in value: ${en}`);
}
assert.ok(Object.keys(AR_EXACT).length > 1000, 'dictionary covers the admin surface');

// ── the language button sits right after the dark-mode button, admin shell only ──
const shell = adminShell('dashboard', '<div>x</div>');
assert.ok(shell.indexOf('id="themeToggleBtn"') > 0 && shell.indexOf('id="langToggleBtn"') > shell.indexOf('id="themeToggleBtn"'), 'language button follows the theme button');
assert.ok(/Path=\/admin/.test(shell), 'language cookie is scoped to /admin');
assert.ok(shell.includes('jnToggleLang'));

// ── end to end through the Worker ──
const mem = new Map();
globalThis.caches = { default: { async match(r) { return mem.get(r.url)?.clone(); }, async put(r, res) { mem.set(r.url, res); }, async delete(r) { return mem.delete(r.url); } } };
const worker = (await import('../src/index.js')).default;
const env = { DB: new D1Shim(), ADMIN_PASSWORD: 'i18n-test-password-123', CSRF_SECRET: 'i18n-test-csrf-secret' };
const call = (p, o = {}) => worker.fetch(new Request(`https://jobforion.com${p}`, { redirect: 'manual', ...o }), { ...env }, { waitUntil() {} });
for (let i = 0; i < 14; i++) await call('/');
const login = await call('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=i18n-test-password-123' });
const session = (login.headers.get('Set-Cookie') || '').split(';')[0];
const en = await (await call('/admin', { headers: { Cookie: session } })).text();
const arPage = await (await call('/admin', { headers: { Cookie: `${session}; adm_lang=ar` } })).text();
assert.ok(!/dir="rtl"/.test(en) && /<html lang="en"/.test(en), 'English is the default');
assert.ok(/<html lang="ar" dir="rtl"/.test(arPage));
assert.ok(arPage.includes('لوحة التحكم') && arPage.includes('id="langToggleBtn"'));
const arJobs = await (await call('/admin/jobs', { headers: { Cookie: `${session}; adm_lang=ar` } })).text();
assert.ok(arJobs.includes('إدارة الوظائف'));
const loginPageAr = await (await call('/admin', { headers: { Cookie: 'adm_lang=ar' } })).text();
assert.ok(/dir="rtl"/.test(loginPageAr) && loginPageAr.includes('تسجيل الدخول'), 'login screen follows the language too');
// public site: the cookie has no effect and the toggle never appears
const publicHome = await (await call('/', { headers: { Cookie: 'adm_lang=ar' } })).text();
assert.ok(!/dir="rtl"/.test(publicHome) && !publicHome.includes('jnToggleLang') && !publicHome.includes('Noto+Sans+Arabic'), 'public site is untouched');
console.log('admin-i18n tests: all assertions passed');
