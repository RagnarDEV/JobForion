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
const sysHtml = await (await call('/admin/system', { headers: admin })).text();
ok(/Jobs by status/.test(sysHtml) && /Repair schema/.test(sysHtml), '/admin/system shows the jobs-by-status card and the Repair schema button');
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
  mem.clear(); // start from an empty edge cache, like a brand-new deployment
  // per-isolate schema flags live in a shared module: reset them so this DB is treated as brand new
  const { schemaState } = await import('../src/db/schema/state.js');
  Object.assign(schemaState, { core: false, ai: false, account: false, versionConfirmed: false, ensurePromise: null });
  const fresh = new D1Shim();
  const freshWorker = (await import('../src/index.js?fresh-db')).default;
  const freshEnv = { DB: fresh, ADMIN_PASSWORD: 'test-admin-pass-123', CSRF_SECRET: 'csrf-secret-test-value-xyz' };
  const codes = [];
  let seededMidMigration = false;
  const seenListing = [];
  for (let i = 0; i < 40; i++) {
    fresh.startRequest(50);
    const res = await freshWorker.fetch(new Request(`${BASE}/?nocache=${i}`, { headers: { 'CF-Connecting-IP': '198.51.100.1' } }), { ...freshEnv }, ctx);
    const html = await res.text();
    codes.push(res.status);
    fresh.startRequest(0);
    if (seededMidMigration) seenListing.push(html.includes('Mid Migration Job') && !html.includes('<div class="loader-wrap">'));
    if (!seededMidMigration) {
      try {
        await fresh.prepare("INSERT INTO jobs (title,company,location,url,description,salary,remote_type,skills) VALUES ('Mid Migration Job','Acme','Remote','https://example.com/mid','d','','fully_remote','[]')").run();
        seededMidMigration = true;
      } catch (e) { /* jobs table not created yet */ }
    }
    if (await fresh.prepare("SELECT v FROM _schema_meta WHERE k='version'").first().catch(() => null)) break;
  }
  ok(seenListing.length > 3 && seenListing.every(Boolean), 'homepage lists jobs (never an endless spinner) while columns are still being migrated');
  ok(codes.length > 3 && codes.every((c) => c === 200), `no 500 while the schema builds under the 50-call limit (${codes.join(',')})`);

  mem.clear(); // the edge "schema OK" marker written above belongs to a different database
  const repairDb = new D1Shim();
  const { repairSchema: repair } = await import('../src/db/schema.js?repair-db');
  let last;
  for (let i = 0; i < 12; i++) { repairDb.startRequest(50); last = await repair({ DB: repairDb }); if (last.complete) break; }
  ok(last.complete, `repairSchema() completes within a few background-budget rounds (${JSON.stringify(last)})`);
}

// ── REGRESSION: admin lockout. With the D1 rate-limit table not created yet, a
// CORRECT password must still log in, and a wrong one must say so accurately. ──
{
  const lockDb = new D1Shim();
  const { schemaState } = await import('../src/db/schema/state.js');
  Object.assign(schemaState, { core: false, ai: false, account: false, versionConfirmed: false, ensurePromise: null });
  mem.clear();
  const lockWorker = (await import('../src/index.js?lockout')).default;
  const lockEnv = { DB: lockDb, ADMIN_PASSWORD: 'Correct-Pass-1', CSRF_SECRET: 'csrf-secret-test-value-xyz' };
  const login = async (pw, ip) => {
    lockDb.startRequest(50);
    const res = await lockWorker.fetch(new Request(`${BASE}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip }, body: `password=${pw}` }), { ...lockEnv }, ctx);
    return { status: res.status, html: await res.text(), cookie: (res.headers.get('Set-Cookie') || '').split(';')[0] };
  };
  const wrong = await login('nope', '203.0.113.50');
  ok(wrong.status === 401 && /Incorrect password/.test(wrong.html), 'wrong password says "Incorrect password" (401)');
  const good = await login('Correct-Pass-1', '203.0.113.51');
  ok(good.status === 302 && good.cookie.startsWith('jn_admin='), 'correct password logs in even while the rate-limit table is missing');
  let blocked = null;
  for (let i = 0; i < 8; i++) { const r = await login('nope', '203.0.113.52'); if (r.status === 429) { blocked = r; break; } }
  ok(blocked && /Too many attempts/.test(blocked.html) && !/Incorrect password/.test(blocked.html), 'lockout message is accurate ("Too many attempts"), not "Incorrect password"');
}

// ── REGRESSION: lifecycle safety valve — a broken sync must never cause a mass expiry ──
{
  const { cleanupStaleJobs } = await import('../src/db/cleanup.js');
  const seedStale = async (db, n) => {
    for (let i = 0; i < n; i++) await db.prepare("INSERT INTO jobs (title,company,location,url,description,salary,remote_type,skills,status,created_at,updated_at,expires_at,source) VALUES (?,?,?,?,?,?,?,?,'active',datetime('now','-100 day'),datetime('now','-100 day'),datetime('now','-10 day'),'t')").bind(`Stale ${i}`, 'Acme', 'Remote', `https://stale.example/${i}`, 'd', '', 'fully_remote', '[]').run();
  };
  await seedStale(DB, 250);
  await DB.prepare("DELETE FROM sync_logs").run();
  let res = await cleanupStaleJobs({ ...baseEnv });
  const stillActive = Number((await DB.prepare("SELECT COUNT(*) c FROM jobs WHERE title LIKE 'Stale %' AND status='active'").first()).c);
  ok(stillActive === 250 && /no_healthy_sync/.test(JSON.stringify(res.breakdown || {})), 'cleanup does nothing when no healthy sync ran in the last 72h');
  await DB.prepare("INSERT INTO sync_logs (inserted, skipped, errors, created_at) VALUES (5, 0, '[]', datetime('now'))").run();
  res = await cleanupStaleJobs({ ...baseEnv });
  const stillActive2 = Number((await DB.prepare("SELECT COUNT(*) c FROM jobs WHERE title LIKE 'Stale %' AND status='active'").first()).c);
  ok(stillActive2 === 250 && /mass_expiry_blocked/.test(JSON.stringify(res.breakdown || {})), 'cleanup refuses to expire >50% of a large catalogue in one run');
  await DB.prepare("DELETE FROM jobs WHERE title LIKE 'Stale %'").run();
}


// ── REGRESSION: D1 free-tier row-read budget. A single cold homepage render
// used to read ~70,000 rows (COUNT/GROUP BY/correlated-subquery scans over the
// whole `jobs` table); a few hundred visits exhausted Cloudflare's 5M-rows/day
// free-tier limit, after which EVERY query failed ("exceeded D1's free tier
// daily row read limit") — job listings, admin login, everything. See
// lib/platform/site-cache.js. This seeds a large catalogue, refreshes the
// precomputed aggregates, and asserts the homepage and the public directory
// pages stay cheap regardless of catalogue size. ──
{
  const budgetDb = new D1Shim();
  const { schemaState } = await import('../src/db/schema/state.js');
  Object.assign(schemaState, { core: false, ai: false, account: false, versionConfirmed: false, ensurePromise: null });
  mem.clear();
  const budgetWorker = (await import('../src/index.js?budget')).default;
  const budgetEnv = { DB: budgetDb, ADMIN_PASSWORD: 'test-admin-pass-123', CSRF_SECRET: 'csrf-secret-test-value-xyz' };
  for (let i = 0; i < 60; i++) {
    await budgetWorker.fetch(new Request(`${BASE}/privacy`), { ...budgetEnv }, ctx);
    if (await budgetDb.prepare("SELECT v FROM _schema_meta WHERE k='version'").first().catch(() => null)) break;
  }
  const N = 3000;
  for (let i = 0; i < N; i++) {
    await budgetDb.prepare(
      `INSERT INTO jobs (title,company,location,url,description,salary,remote_type,skills,status,created_at,updated_at,expires_at,source)
       VALUES (?,?,?,?,?,?,?,?, 'active', datetime('now','-' || ? || ' day'), datetime('now'), datetime('now','+30 day'), 'test')`
    ).bind(`Engineer ${i}`, `Company ${i % 200}`, i % 2 ? 'Remote' : 'Berlin, Germany', `https://example.com/${i}`, 'd'.repeat(200), i % 3 ? '$90k - $130k' : '', i % 2 ? 'fully_remote' : 'hybrid', '["Python","SQL"]', i % 20).run();
  }
  const { refreshSiteCache } = await import('../src/lib/platform/site-cache.js');
  await refreshSiteCache({ ...budgetEnv });

  const measure = async (path) => {
    budgetDb.startRequest(0);
    const before = budgetDb.calls;
    const res = await budgetWorker.fetch(new Request(BASE + path, { headers: { 'CF-Connecting-IP': '203.0.113.77' } }), { ...budgetEnv }, ctx);
    await res.text();
    return { status: res.status, calls: budgetDb.calls - before };
  };
  // A generous ceiling — a bounded, index-driven page issues a handful of D1
  // *calls* (not rows: this simple shim counts calls, not scanned rows, but a
  // page that regresses back to a live COUNT(*)/GROUP BY/correlated-subquery
  // scan of the whole table typically balloons the call count too, since the
  // old code paths issued one query per aggregate rather than reading one
  // site_cache row). The real per-request ROW cost is covered by manual
  // profiling (see the row-cost harness used during development); this test's
  // job is to catch a full regression back to "query 5-8+ live aggregates every load".
  for (const path of ['/', '/jobs', '/companies', '/categories/developer', '/skills/python', '/countries/germany']) {
    const m = await measure(path);
    ok(m.status === 200 && m.calls <= 25, `${path}: bounded D1 call count with a ${N}-job catalogue (${m.calls} calls)`);
  }
}


// ── REGRESSION: crawler-breadth row-read budget. A bounded window keeps any ONE
// page cheap, but a search-engine crawler that systematically visits every
// unique /skills/:slug URL in the sitemap turns "cheap per page" into "still
// huge in total" for high-cardinality entities like skills (effectively
// unbounded, free-text). See lib/platform/site-cache.js's `dir:skill_jobs`
// (precomputed per-skill job-ID lists) and lib/directory/entities.js's
// jobsBySkill(). This seeds many distinct skills, visits each skill's detail
// page ONCE (a crawler never revisiting the same URL — so a page-cache TTL
// alone cannot help), and asserts both correctness and a bounded total cost. ──
{
  const crawlDb = new D1Shim();
  const { schemaState } = await import('../src/db/schema/state.js');
  Object.assign(schemaState, { core: false, ai: false, account: false, versionConfirmed: false, ensurePromise: null });
  mem.clear();
  const crawlWorker = (await import('../src/index.js?crawl')).default;
  const crawlEnv = { DB: crawlDb, ADMIN_PASSWORD: 'test-admin-pass-123', CSRF_SECRET: 'csrf-secret-test-value-xyz' };
  for (let i = 0; i < 60; i++) {
    await crawlWorker.fetch(new Request(`${BASE}/privacy`), { ...crawlEnv }, ctx);
    if (await crawlDb.prepare("SELECT v FROM _schema_meta WHERE k='version'").first().catch(() => null)) break;
  }
  const SKILLS = 120;
  for (let i = 0; i < 1200; i++) {
    const skills = JSON.stringify([`crawlskill-${i % SKILLS}`, `crawlskill-${(i + 17) % SKILLS}`]);
    await crawlDb.prepare(
      `INSERT INTO jobs (title,company,location,url,description,salary,remote_type,skills,status,created_at,updated_at,expires_at,source)
       VALUES (?,?,?,?,?,?,?,?, 'active', datetime('now','-' || ? || ' day'), datetime('now'), datetime('now','+30 day'), 'test')`
    ).bind(`Crawl Job ${i}`, `Co ${i % 80}`, 'Remote', `https://example.com/crawl/${i}`, 'd', '', 'fully_remote', skills, i % 20).run();
  }
  const { refreshSiteCache } = await import('../src/lib/platform/site-cache.js');
  await refreshSiteCache({ ...crawlEnv });

  let totalCalls = 0;
  let sawJobsOnEveryPage = true;
  for (let i = 0; i < SKILLS; i++) {
    crawlDb.startRequest(0);
    const before = crawlDb.calls;
    const res = await crawlWorker.fetch(new Request(`${BASE}/skills/crawlskill-${i}`, { headers: { 'User-Agent': 'Googlebot/2.1', 'CF-Connecting-IP': `203.0.113.${i % 250}` } }), { ...crawlEnv }, ctx);
    const html = await res.text();
    await Promise.allSettled(pending.splice(0));
    totalCalls += crawlDb.calls - before;
    if (res.status !== 200 || !html.includes('Crawl Job')) sawJobsOnEveryPage = false;
  }
  ok(sawJobsOnEveryPage, 'every crawled skill page actually shows its jobs (cache path is correct, not just cheap)');
  const avgCalls = totalCalls / SKILLS;
  ok(avgCalls < 10, `crawling ${SKILLS} unique skill pages once each averages a bounded D1 call count (${avgCalls.toFixed(1)}/page) — must not scale with catalogue size`);
}

// ── sanitizer ──
ok(sanitizeRichHtml('<p onclick="x()">a<script>1</script><img src=x onerror=1><a href="javascript:1">l</a></p>') === '<p>a<a>l</a></p>', 'sanitizer strips script/handlers/javascript:');

console.log(`smoke tests: ${passed} assertions passed`);
