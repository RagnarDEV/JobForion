// End-to-end smoke test: boots the REAL Worker (src/index.js) against an
// in-memory SQLite database that emulates Cloudflare D1, then walks every
// public route, the admin login flow and the security-critical behaviours.
// Requires Node >= 22.5 (node:sqlite). Skips itself otherwise.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readSchemaSource } from './helpers/read-schema.mjs';

let D1Shim;
try { ({ D1Shim } = await import('./helpers/d1-shim.mjs')); } catch (e) {
  console.log('smoke tests skipped: node:sqlite is unavailable on this Node version');
  process.exit(0);
}
const { pickTasks } = await import('../src/app/cron.js');
const { sanitizeRichHtml } = await import('../src/lib/platform/html-sanitizer.js');
const { safeDecodeURIComponent, keywordCondition, likeContains } = await import('../src/lib/platform/search-utils.js');

// ── minimal Workers Cache API ──
const mem = new Map();
globalThis.caches = { default: {
  async match(req) { return mem.get(new URL(req.url).toString())?.clone(); },
  async put(req, res) { mem.set(new URL(req.url).toString(), res); },
  async delete(req) { return mem.delete(new URL(req.url).toString()); },
} };

const worker = (await import('../src/index.js')).default;
const DB = new D1Shim();
const baseEnv = { DB, ADMIN_PASSWORD: 'test-admin-pass-123', CSRF_SECRET: 'csrf-secret-test-value-xyz' };
const pending = [];
const ctx = { waitUntil(p) { pending.push(p); } };
const BASE = 'https://jobforion.com';
async function call(path, { headers = {}, method = 'GET', body = null, ip = '203.0.113.7' } = {}) {
  const res = await worker.fetch(new Request(BASE + path, { method, headers: { 'CF-Connecting-IP': ip, ...headers }, body, redirect: 'manual' }), { ...baseEnv }, ctx);
  await Promise.allSettled(pending.splice(0));
  return res;
}

let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); passed++; };
const status = async (path, expected, opts) => {
  const res = await call(path, opts);
  assert.ok([].concat(expected).includes(res.status), `${opts?.method || 'GET'} ${path} → ${res.status}, expected ${expected}`);
  passed++;
  return res;
};

// ── schema warm-up: the resumable migration completes within a few requests ──
for (let i = 0; i < 60; i++) {
  await call('/privacy');
  if (await DB.prepare("SELECT v FROM _schema_meta WHERE k='version'").first()) break;
}
const tables = (await DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(r => r.name);
const ddl = readSchemaSource()
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const expectedTables = [...new Set([...ddl.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_0-9]+)/gi)].map(m => m[1]))];
ok(expectedTables.length >= 50, `schema DDL discovered (${expectedTables.length} tables)`);
const missing = expectedTables.filter(t => !tables.includes(t));
ok(missing.length === 0, `resumable migration must create every table (missing: ${missing.join(', ')})`);

for (const j of [
  ['Senior Backend Developer', 'Acme Corp', 'Remote', 'https://example.com/1', 'Great <b>role</b> with python', '$120k - $150k', 'fully_remote', '["Python","Go"]'],
  ['Product Designer', 'Globex', 'Berlin, Germany', 'https://example.com/2', 'Design things', '$90k - $110k', 'hybrid', '["Figma"]'],
  ['Marketing Manager', 'Initech', 'Austin, TX', 'https://example.com/3', 'Market things', '', 'fully_remote', '["SEO"]'],
]) {
  await DB.prepare(`INSERT INTO jobs (title,company,location,url,description,salary,remote_type,skills,status,updated_at,expires_at,source) VALUES (?,?,?,?,?,?,?,?, 'active', CURRENT_TIMESTAMP, datetime('now','+45 days'),'test')`).bind(...j).run();
}

// ── public routes ──
for (const p of ['/', '/jobs', '/jobs?q=python', '/job/1', '/blog', '/companies', '/companies/acme-corp', '/countries', '/countries/germany', '/companies?q=acme', '/skills', '/skills/python', '/categories', '/categories/developer', '/search/python', '/remote-jobs', '/privacy', '/terms', '/disclaimer', '/pricing', '/login', '/register', '/forgot-password', '/robots.txt', '/sitemap.xml', '/feed.rss', '/manifest.json', '/favicon.svg', '/api/jobs?page=1']) await status(p, 200);
await status('/job/9999', [404, 410]);
await status('/nonexistent-page-xyz', 404);
await status('/api/debug', 404);
await status('/api/sync', 404, { method: 'POST' });
await status('/sitemap-jobs-1.xml', 200);

// ── every API sub-router is reachable (guards against undefined identifiers after the split) ──
const json = { 'Content-Type': 'application/json' };
const beacon = await call('/api/analytics/events', { method: 'POST', headers: { ...json, 'User-Agent': 'Mozilla/5.0 Chrome' }, body: JSON.stringify({ events: [{ event_type: 'page_view', event_id: 'e-1', session_id: 's-1', page: '/' }, { event_type: 'job_impression', event_id: 'e-2', session_id: 's-1', job_id: 1, page: '/jobs' }] }) });
ok(beacon.status === 200 && (await beacon.json()).accepted === 2, 'batched analytics beacon accepts multiple events in ONE request');
await status('/api/subscribe', [200, 400], { method: 'POST', headers: json, body: JSON.stringify({ email: 'bad', keywords: [] }) });
await status('/api/post-job', [200, 400], { method: 'POST', headers: json, body: JSON.stringify({}) });
await status('/api/monetization/products', 200);
await status('/api/auth/session', [200, 401]);
await status('/api/user/saved-jobs', 401);
await status('/api/admin/analytics/overview', 401);
await status('/api/does-not-exist', 404);

// ── regression: malformed percent-escape used to crash with HTTP 500 ──
await status('/search/%E0%A4%A', 404);
ok(safeDecodeURIComponent('%E0%A4%A') === null, 'safeDecodeURIComponent returns null on malformed input');

// ── search hardening ──
const sPage = await call('/search/python');
const sHtml = await sPage.text();
ok(/<meta name="robots" content="noindex/.test(sHtml), '/search/* is always noindex');
const xss = await (await call('/search/%3Cscript%3Ealert(1)%3C%2Fscript%3E')).text();
ok(!xss.includes('<script>alert(1)</script>'), 'search term is escaped');
const wild = await (await call('/api/jobs?search=%25')).json();
ok(wild.total === 0, 'a literal "%" must not act as a match-everything wildcard');
ok(likeContains('50%_x') === '%50\\%\\_x%', 'LIKE wildcards are escaped');
ok(keywordCondition('x').sql.includes("ESCAPE '\\'"), 'keyword condition uses ESCAPE');
let got429 = false;
for (let i = 0; i < 40 && !got429; i++) got429 = (await call(`/search/term${i}`, { ip: '198.51.100.9' })).status === 429;
ok(got429, 'search cache-misses are rate limited per IP (429)');

// ── edge cache: query-string spam must not create new cache entries / D1 work ──
await call('/categories?x=1');
const before = DB.calls;
await call('/categories?x=2&y=3');
ok(DB.calls - before <= 3, `normalised cache key: second variant must be a cache hit (D1 calls: ${DB.calls - before})`);
await call('/job/1');
const beforeJob = DB.calls;
const jobHit = await call('/job/1', { headers: { Cookie: '_ga=GA1.2.123' } });
ok(jobHit.status === 200 && DB.calls - beforeJob <= 3, `anonymous job page is edge-cached even with analytics cookies (D1 calls: ${DB.calls - beforeJob})`);

// ── headers & escaping ──
const job = await call('/job/1');
const jobHtml = await job.text();
ok((job.headers.get('Content-Security-Policy') || '').includes("default-src 'self'"), 'CSP header present');
ok(!jobHtml.includes('Great <b>role</b>'), 'job description is escaped');

// ── admin ──
const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
ok((await call('/admin/login', { method: 'POST', headers: form, body: 'password=wrong' })).status === 401, 'wrong admin password → 401');
const good = await call('/admin/login', { method: 'POST', headers: form, body: 'password=test-admin-pass-123' });
ok(good.status === 302, 'correct admin password → 302');
const admin = { Cookie: (good.headers.get('Set-Cookie') || '').split(';')[0] };
for (const p of ['/admin', '/admin/jobs', '/admin/sources', '/admin/system', '/admin/settings', '/admin/analytics', '/admin/blog', '/admin/monetization', '/admin/security', '/admin/homepage', '/admin/categories', '/admin/companies', '/admin/accounts/users', '/admin/pages', '/admin/blog-automation']) {
  const r = await call(p, { headers: admin });
  ok([200, 302, 404].includes(r.status), `ADMIN ${p} → ${r.status}`);
}
// no unresolved template placeholders / raw SVG-as-text leaking from the emoji→Lucide migration
for (const p of ['/admin', '/admin/jobs', '/admin/system', '/admin/settings', '/admin/categories', '/admin/directory', '/admin/pages', '/admin/blog', '/admin/ads', '/admin/homepage']) {
  const html = await (await call(p, { headers: admin })).text();
  ok(!/\$\{icon|\[object Object\]|&lt;svg/.test(html), `${p}: icons render as real SVG`);
}
for (const p of ['/', '/jobs?q=zzzz', '/categories/developer', '/skills/zzz', '/blog', '/search/nomatch-zzz']) {
  const html = await (await call(p)).text();
  ok(!/\$\{icon|\[object Object\]|&lt;svg/.test(html), `${p}: icons render as real SVG`);
}
const gate = await (await call('/admin/some-unknown-admin-route')).text();
ok(/name="password"/.test(gate), 'central gate: unauthenticated /admin/* shows the login form');
ok((await call('/admin/jobs/delete', { method: 'POST', headers: form, body: 'id=1' })).status === 401, 'unauthenticated admin POST → 401');

// ── source-level security invariants ──
const idx = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
ok(!/ADMIN_PASSWORD/.test(idx), 'index.js never reads the admin password (no ?jf_debug=<password>)');

// ── cron dispatcher: ONE trigger fans out by UTC time ──
const at = (h, m) => pickTasks({ cron: '*/30 * * * *', scheduledTime: Date.UTC(2026, 8, 20, h, m) });
ok(JSON.stringify(at(1, 30)) === '["analytics"]', 'xx:30 → analytics');
ok(JSON.stringify(at(6, 0)) === '["job-sync"]', '06:00 → sync');
ok(JSON.stringify(at(3, 0)) === '["daily-maintenance"]', '03:00 → daily maintenance');
ok(JSON.stringify(at(8, 0)) === '["job-alerts"]', '08:00 → alerts');
ok(JSON.stringify(at(9, 0)) === '["blog-generation"]', '09:00 → blog generation');
ok(at(1, 0).length === 0, '01:00 → nothing due');
ok(JSON.stringify(pickTasks({ cron: '0 */6 * * *' })) === '["job-sync"]', 'legacy cron patterns still map to their old task');

// ── scheduled handler: every task group actually runs without throwing ──
for (const [h, m] of [[1, 30], [6, 0], [3, 0], [8, 0], [9, 0]]) {
  await worker.scheduled({ cron: '*/30 * * * *', scheduledTime: Date.UTC(2026, 8, 20, h, m) }, { ...baseEnv }, ctx);
  await Promise.allSettled(pending.splice(0));
}
const cronErrors = (await DB.prepare("SELECT path, message FROM error_logs WHERE path LIKE 'cron:%'").all()).results;
ok(cronErrors.length === 0, `scheduled tasks completed without errors (${JSON.stringify(cronErrors)})`);

// ── REGRESSION (the recurring site-wide "temporary error" page): while the schema
// is being (re)built, page requests share Cloudflare's 50-call ceiling with the
// migration. A brand-new database + a hard 50-call limit per request must never
// produce a 500 on the way to a complete schema. ──
{
  const fresh = new D1Shim();
  const freshWorker = (await import('../src/index.js?fresh-db')).default;
  const freshEnv = { DB: fresh, ADMIN_PASSWORD: 'test-admin-pass-123', CSRF_SECRET: 'csrf-secret-test-value-xyz' };
  const codes = [];
  for (let i = 0; i < 40; i++) {
    fresh.startRequest(50);
    const res = await freshWorker.fetch(new Request(`${BASE}/`, { headers: { 'CF-Connecting-IP': '198.51.100.1' } }), { ...freshEnv }, ctx);
    await res.text();
    codes.push(res.status);
    fresh.startRequest(0);
    if (await fresh.prepare("SELECT v FROM _schema_meta WHERE k='version'").first().catch(() => null)) break;
  }
  ok(codes.length > 3 && codes.every((c) => c === 200), `no 500 while the schema builds under the 50-call limit (${codes.join(',')})`);

  mem.clear(); // the edge "schema OK" marker written above belongs to a different database
  const repairDb = new D1Shim();
  const { repairSchema: repair } = await import('../src/db/schema.js?repair-db');
  let last;
  for (let i = 0; i < 12; i++) { repairDb.startRequest(50); last = await repair({ DB: repairDb }); if (last.complete) break; }
  ok(last.complete, `repairSchema() completes within a few background-budget rounds (${JSON.stringify(last)})`);
}

// ── sanitizer ──
ok(sanitizeRichHtml('<p onclick="x()">a<script>1</script><img src=x onerror=1><a href="javascript:1">l</a></p>') === '<p>a<a>l</a></p>', 'sanitizer strips script/handlers/javascript:');

console.log(`smoke tests: ${passed} assertions passed`);
