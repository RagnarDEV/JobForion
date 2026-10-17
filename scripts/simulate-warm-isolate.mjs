// Developer tool: what does ONE warm Worker isolate read from D1 while it just sits serving traffic?
//   node --no-warnings scripts/simulate-warm-isolate.mjs [hours=6]
// Fakes the clock, sends a public request every 10 s (mixed pages) and totals the rows D1 returns
// plus the number of statements — i.e. the *standing* read cost per isolate (config, settings,
// schema probes ...), which multiplies by the number of isolates Cloudflare keeps warm.
import { D1Shim } from '../tests/helpers/d1-shim.mjs';
const HOURS = parseInt(process.argv[2], 10) || 6;
const mem = new Map();
globalThis.caches = { default: { async match(r) { return mem.get(r.url)?.clone(); }, async put(r, res) { mem.set(r.url, res); }, async delete(r) { return mem.delete(r.url); } } };
const shim = new D1Shim();
const env = { DB: shim, ADMIN_PASSWORD: 'x'.repeat(16), CSRF_SECRET: 'y'.repeat(16) };
const ctx = { waitUntil() {} };
const worker = (await import('../src/index.js')).default;
const call = (p, h = {}) => worker.fetch(new Request(`https://jobforion.com${p}`, { headers: { 'User-Agent': 'Mozilla/5.0 Safari', ...h } }), { ...env }, ctx);
for (let i = 0; i < 16; i++) await call('/');
const db = shim.db;
db.exec('BEGIN');
const ins = db.prepare('INSERT OR REPLACE INTO site_settings(key,value) VALUES (?,?)');
for (let i = 0; i < 150; i++) ins.run(`custom_${i}`, 'v'.repeat(40));                       // a site with a lot of saved settings
const j = db.prepare("INSERT INTO jobs(title,company,url,status,description,skills,created_at) VALUES (?,?,?,'active','d','[\"python\"]',datetime('now'))");
for (let i = 0; i < 3000; i++) j.run(`developer ${i}`, `Co${i % 100}`, `u${i}`);
db.exec('COMMIT');
const { refreshSiteCache } = await import('../src/lib/platform/site-cache.js');
await refreshSiteCache(env);

let now = Date.now();
const realNow = Date.now.bind(Date);
Date.now = () => now;
let stmts = 0, rows = 0; const by = new Map();
const orig = db.prepare.bind(db);
db.prepare = (sql) => { const s = orig(sql); if (!/^\s*(select|with)/i.test(sql)) return s; const w = (n) => (...a) => { const r = s[n](...a); const c = n === 'all' ? r.length : r ? 1 : 0; stmts++; rows += c; const k = sql.replace(/\s+/g, ' ').slice(0, 90); const e = by.get(k) || { n: 0, rows: 0 }; e.n++; e.rows += c; by.set(k, e); return r; }; return { all: w('all'), get: w('get'), run: s.run.bind(s) }; };
const pages = ['/', '/job/5', '/companies', '/skills', '/categories', '/blog', '/api/jobs?page=1', '/job/9', '/privacy'];
const requests = HOURS * 360;
for (let i = 0; i < requests; i++) { now += 10000; await call(pages[i % pages.length]); }
Date.now = realNow;
console.log(`simulated ${HOURS}h, ${requests} requests on ONE warm isolate`);
console.log(`D1 statements: ${stmts} (${Math.round(stmts / HOURS)}/h) · rows returned: ${rows} (${Math.round(rows / HOURS)}/h, ≈ ${Math.round(rows / HOURS * 24).toLocaleString()}/day/isolate)`);
for (const [k, v] of [...by.entries()].sort((a, b) => b[1].rows - a[1].rows).slice(0, 8)) console.log(String(v.rows).padStart(7), 'rows ×', String(v.n).padStart(4), ' ', k);
