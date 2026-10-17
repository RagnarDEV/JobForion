// Developer tool — finds D1 "rows read" hot spots WITHOUT touching production.
//   node --no-warnings scripts/profile-reads.mjs [jobs=6000] [--cron]
// Boots the real Worker on an in-memory D1, seeds a realistic catalogue, requests each public /
// admin URL once (cold cache) and prints, per URL, every statement that SCANS a table (the
// source of rows_read: an index SEARCH reads a handful of rows, a SCAN reads the whole table)
// with an estimated rows-read figure. Use it before/after changing a query.
import { D1Shim } from '../tests/helpers/d1-shim.mjs';

const JOBS = parseInt(process.argv[2], 10) || 6000;
const mem = new Map();
globalThis.caches = { default: { async match(r) { return mem.get(r.url)?.clone(); }, async put(r, res) { mem.set(r.url, res); }, async delete(r) { return mem.delete(r.url); } } };
const shim = new D1Shim();
const env = { DB: shim, ADMIN_PASSWORD: 'profile-pass-123456', CSRF_SECRET: 'profile-csrf-secret-xyz' };
const ctx = { waitUntil(p) { pending.push(p); } };
const pending = [];
const worker = (await import('../src/index.js')).default;
const call = (p, o = {}) => worker.fetch(new Request(`https://jobforion.com${p}`, { redirect: 'manual', ...o }), { ...env }, ctx);

for (let i = 0; i < 16; i++) await call('/');           // finish the resumable schema migration
await Promise.all(pending.splice(0));

// ── seed ──
const db = shim.db;
const cats = ['developer', 'designer', 'marketing', 'data', 'devops', 'writer', 'sales', 'support', 'product', 'finance', 'recruit', 'quality', 'manager'];
const skills = ['python', 'react', 'sql', 'aws', 'figma', 'seo', 'node', 'go', 'docker', 'excel'];
const ins = db.prepare(`INSERT INTO jobs (title,company,location,url,description,salary,remote_type,skills,seniority,employment_type,status,created_at,updated_at,expires_at,source,featured)
  VALUES (?,?,?,?,?,?,?,?,?,?,'active',datetime('now',?),datetime('now'),datetime('now','+30 day'),?,?)`);
db.exec('BEGIN');
for (let i = 1; i <= JOBS; i++) {
  ins.run(`${cats[i % 13]} Role ${i}`, `Company ${i % 300}`, i % 3 ? 'Remote' : `City ${i % 40}, Country ${i % 25}`, `https://x.test/${i}`,
    'Lorem ipsum '.repeat(40), i % 4 ? '$90k - $130k' : '', 'fully_remote', JSON.stringify([skills[i % 10], skills[(i + 3) % 10]]), 'Senior', 'full_time', `-${i % 3000} minutes`, ['lever', 'greenhouse', 'ashby'][i % 3], i % 200 === 0 ? 1 : 0);
}
const vis = db.prepare('INSERT INTO visits (path,referrer,country,ua) VALUES (?,?,?,?)');
const VISITS = parseInt(process.env.VISITS, 10) || 3000;
for (let i = 0; i < VISITS; i++) vis.run(`/job/${i % 500}`, '', ['US', 'DE', 'AE'][i % 3], 'Mozilla');
db.exec('COMMIT');
try { db.exec(`UPDATE jobs SET company_id = NULL`); } catch (e) {}
const size = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch (e) { return 0; } };
const sizes = {}; for (const t of ['jobs', 'visits', 'companies', 'site_cache']) sizes[t] = size(t);

// production always has the precomputed site_cache rows (cron refreshes them ~2×/day)
const { refreshSiteCache } = await import('../src/lib/platform/site-cache.js');
await refreshSiteCache(env);
sizes.site_cache = 1;
// ── plan capture ──
let log = [];
const origPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const stmt = origPrepare(sql);
  if (!/^\s*(select|with)/i.test(sql)) return stmt;
  const wrap = (name) => (...params) => {
    try {
      const plan = origPrepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => r.detail);
      log.push({ sql, plan });
    } catch (e) { /* un-explainable statement: ignore */ }
    return stmt[name](...params);
  };
  return { all: wrap('all'), get: wrap('get'), run: stmt.run.bind(stmt), iterate: stmt.iterate?.bind(stmt) };
};

// Estimated rows read by ONE statement. A SCAN costs the whole table unless a LIMIT bounds it:
//   FROM (SELECT … LIMIT n)         → n   (the "window" pattern used all over lib/platform/job-window.js)
//   top-level ORDER BY id … LIMIT n → n   (walks the primary key / matching index)
// Anything else that scans is O(table) — exactly the statements that grow with the catalogue.
function estimate(sql, line, table) {
  if (!(table in sizes)) return 0;
  const sub = /\(\s*SELECT[^()]*?LIMIT\s+(\d+)\s*\)/is.exec(sql);
  if (sub) return Math.min(sizes[table], Number(sub[1]));
  const lim = /LIMIT\s+(\d+)/i.exec(sql);
  if (lim && /USING (?:COVERING )?INDEX|USING INTEGER PRIMARY KEY/i.test(line) && !/GROUP BY|COUNT\(|DISTINCT/i.test(sql)) return Math.min(sizes[table], Number(lim[1]));
  if (lim && /ORDER BY\s+(?:\w+\.)?id\b/i.test(sql) && !/GROUP BY|COUNT\(|DISTINCT|LIKE|json_each/i.test(sql)) return Math.min(sizes[table], Number(lim[1]));
  return sizes[table];
}

function summarize(label) {
  const rows = [];
  for (const q of log) {
    for (const line of q.plan) {
      const m = /^SCAN (?:TABLE )?(\w+)/.exec(line);
      if (!m) continue;
      const est = estimate(q.sql, line, m[1]);
      if (est > 0) rows.push({ table: m[1], est, sql: q.sql.replace(/\s+/g, ' ').slice(0, 150), line });
    }
  }
  const total = rows.reduce((s, r) => s + r.est, 0);
  console.log(`\n${label}  — ${log.length} statements, ~${total.toLocaleString()} rows scanned`);
  for (const r of rows.sort((a, b) => b.est - a.est).slice(0, 5)) console.log(`   ${String(r.est).padStart(7)}  ${r.line}\n            ${r.sql}`);
  return total;
}

const results = [];
async function hit(path, opts) {
  log = [];
  const res = await call(path, opts);
  await res.arrayBuffer?.();
  await Promise.all(pending.splice(0));
  results.push([path, summarize(`${path} → ${res.status}`)]);
}
console.log('table sizes:', sizes);
const login = await call('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=profile-pass-123456' });
const cookie = (login.headers.get('Set-Cookie') || '').split(';')[0];
const anon = { headers: { 'User-Agent': 'Mozilla/5.0 Safari' } };
for (const p of ['/', '/api/jobs?page=1', '/api/jobs?category=developer', '/api/jobs?search=python', '/job/2500', '/companies', '/companies/company-5', '/skills', '/skills/python', '/categories', '/categories/developer', '/search/python', '/blog', '/sitemap.xml', '/feed.rss']) await hit(p, anon);
for (const p of ['/admin', '/admin/jobs', '/admin/system', '/admin/analytics', '/admin/sources']) await hit(p, { headers: { Cookie: cookie } });
if (process.argv.includes('--cron')) {
  // seed an analytics backlog like a busy week: 40k processed + 200 pending events
  db.exec('BEGIN');
  const q = db.prepare(`INSERT INTO analytics_event_queue (event_id, event_type, page, country, device_type, metric_date, created_at, processed_at) VALUES (?,?,?,?,?,date('now'),datetime('now',?),?)`);
  for (let i = 0; i < 40200; i++) q.run(`ev${i}`, ['page_view', 'job_view', 'apply_click'][i % 3], `/job/${i % 900}`, 'US', 'mobile', `-${i % 5000} minutes`, i < 40000 ? "2026-10-14 00:00:00" : null);
  db.exec('COMMIT');
  sizes.analytics_event_queue = 40200;
  const { aggregateAnalytics, cleanupAnalytics, evaluateAnalyticsAlerts } = await import('../src/lib/analytics/events.js');
  const { getSettings } = await import('../src/lib/platform/settings.js');
  for (const [name, fn] of [['cron: aggregateAnalytics', () => aggregateAnalytics(env)], ['cron: evaluateAnalyticsAlerts', async () => evaluateAnalyticsAlerts(env, await getSettings(env))], ['cron: refreshSiteCache (2×/day)', () => refreshSiteCache(env)], ['cron: cleanupAnalytics (daily)', () => cleanupAnalytics(env, '90')]]) {
    log = []; try { await fn(); } catch (e) { console.log('  task error', name, e.message); }
    results.push([name, summarize(name)]);
  }

  const { cleanupStaleJobs } = await import('../src/db/cleanup.js');
  log = []; await cleanupStaleJobs(env); results.push(['cron: cleanup', summarize('cron: cleanupStaleJobs')]);
}
console.log('\n── worst URLs ──');
for (const [p, t] of results.sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${String(t).padStart(9)}  ${p}`);
