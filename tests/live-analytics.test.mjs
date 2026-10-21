// Live Analytics: data layer, router, auth, read-only guarantee, cost bounds, i18n.
import assert from 'node:assert/strict';
import { D1Shim } from './helpers/d1-shim.mjs';
import { getLiveInit, getLiveDelta, getLiveSeries, parseSince, selfHostSet, LIVE_DELTA_ROWS } from '../src/lib/analytics/live.js';
import { handleAdminLiveRoute } from '../src/routes/admin/live.router.js';
import { renderLiveContent } from '../src/pages/admin/live.js';
import { liveClientScript } from '../src/components/admin/live-charts.js';
import { makeAdminCookie } from '../src/auth/admin-auth.js';
import { clearStatMemo } from '../src/lib/platform/stat-memo.js';
import { makeTranslator, translateHtml } from '../src/lib/admin-i18n/translate.js';
import { AR_EXACT, AR_PATTERNS } from '../src/lib/admin-i18n/ar/index.js';

const db = new D1Shim();
await db.exec(`CREATE TABLE analytics_event_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE, event_type TEXT, session_id TEXT, user_id INTEGER, job_id INTEGER, company_id INTEGER, country TEXT, device_type TEXT, browser TEXT, os TEXT, referrer TEXT, source TEXT, medium TEXT, campaign TEXT, landing_page TEXT, page TEXT, metadata TEXT, metric_date TEXT, created_at TEXT, processed_at TEXT);
CREATE TABLE analytics_daily (id INTEGER PRIMARY KEY, metric_date TEXT, event_type TEXT, job_id INT DEFAULT 0, company_id INT DEFAULT 0, country TEXT, device_type TEXT, source TEXT, medium TEXT, event_count INT, unique_count INT);
CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, company TEXT);
CREATE TABLE sync_logs (id INTEGER PRIMARY KEY, created_at TEXT, inserted INT, errors TEXT);
CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);`);
await db.exec(`INSERT INTO jobs VALUES (7,'Senior <b>Dev</b>','Acme')`);
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
let n = 0;
const ev = (type, o = {}) => db.prepare(`INSERT INTO analytics_event_queue (event_id,event_type,session_id,job_id,country,device_type,referrer,source,page,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(`e${++n}`, type, o.s ?? 'sess-secret-1', o.job ?? null, o.c ?? 'US', o.d ?? 'desktop', o.ref ?? '', o.src ?? '', o.p ?? '/', o.meta ?? '{}', o.t ?? iso(1000)).run();
await ev('page_view', { p: '/', ref: 'https://www.google.com/x' });
await ev('page_view', { p: '/jobs', ref: 'https://jobforion.manasa.workers.dev/', s: 'sess-2', d: 'mobile', c: 'DE' });
await ev('job_view', { job: 7, p: '/job/7' });
await ev('job_apply_click', { job: 7 });
await ev('job_impression', { s: 'sess-3' });
await ev('search', { meta: JSON.stringify({ query: 'Python', results_count: 0 }) });
await ev('page_view', { t: iso(3 * 86400000) }); // outside 24h window

const hosts = selfHostSet('jobforion.manasa.workers.dev');
clearStatMemo();
const init = await getLiveInit({ DB: db }, hosts, { force: true });
assert.equal(init.ok, true);
assert.equal(init.totals.pv, 2, 'only last-24h page views counted');
assert.equal(init.totals.jv, 1); assert.equal(init.totals.ap, 1); assert.equal(init.totals.se, 1); assert.equal(init.totals.imp, 1);
assert.equal(init.tops.zero[0][0], 'python', 'zero-result search is lower-cased and surfaced');
assert.ok(init.tops.sources.some(([k]) => k === 'www.google.com' || k === 'google.com'), 'external referrer host becomes a source');
assert.ok(!init.tops.sources.some(([k]) => k === 'internal'), 'internal navigation is not a traffic source');
assert.equal(init.tops.jobs[0].title, 'Senior <b>Dev</b>', 'raw title returned; the browser escapes it');
assert.equal(init.active.length, 3, 'three distinct sessions active (impressions count as activity)');
assert.ok(JSON.stringify(init).indexOf('sess-secret-1') === -1 && JSON.stringify(init).indexOf('sess-2') === -1, 'raw session ids never leave the server');
assert.ok(init.feed.every(e => e.y !== 'job_impression'), 'impressions are not in the feed');

// delta reads only new rows
const before = init.lastId;
const empty = await getLiveDelta({ DB: db }, before, hosts);
assert.deepEqual([empty.events.length, empty.imp, empty.more], [0, 0, false]);
await ev('page_view', { p: '/new' }); await ev('job_impression', { s: 'sess-9' });
const delta = await getLiveDelta({ DB: db }, before, hosts);
assert.equal(delta.events.length, 1); assert.equal(delta.imp, 1); assert.equal(delta.events[0].p, '/new');
assert.equal(delta.lastId > before, true);
assert.equal(parseSince('abc'), 0); assert.equal(parseSince('-5'), 0); assert.equal(parseSince('42'), 42);

// bounded cost: a delta never returns more than the cap, and flags `more`
for (let i = 0; i < LIVE_DELTA_ROWS + 5; i++) await ev('page_view', { p: '/bulk' });
const big = await getLiveDelta({ DB: db }, delta.lastId, hosts);
assert.equal(big.events.length, LIVE_DELTA_ROWS); assert.equal(big.more, true);

// series reuses the aggregate table and tolerates an empty one
clearStatMemo();
const series = await getLiveSeries({ DB: db }, 7);
assert.equal(series.ok, true); assert.ok(Array.isArray(series.rows));
const today = new Date().toISOString().slice(0, 10);
for (let i = 0; i < 3; i++) await db.exec(`INSERT INTO analytics_daily (metric_date,event_type,job_id,country,event_count) VALUES ('${today}','page_view',0,'C${i}',5)`);
clearStatMemo();
const s2 = await getLiveSeries({ DB: db }, 7);
assert.equal(s2.rows.find(r => r.d === today).pv, 15, 'daily totals summed per day'); assert.equal(s2.capped, false);

// router: auth, methods, JSON headers, read-only
const env = { DB: db, ADMIN_PASSWORD: 'pw-for-test', ADMIN_SESSION_SECRET: 'secret-for-test' };
const cookie = `jn_admin=${await makeAdminCookie(env)}`;
const req = (path, o = {}) => new Request(`https://jobforion.manasa.workers.dev${path}`, { headers: o.cookie === false ? {} : { Cookie: cookie }, method: o.method || 'GET' });
const call = (path, o) => handleAdminLiveRoute(new URL(`https://jobforion.manasa.workers.dev${path}`), req(path, o), env);
assert.equal(await call('/admin/analytics'), null, 'other analytics paths are left to their own router');
assert.equal((await call('/admin/analytics/live/data?mode=init', { cookie: false })).status, 401);
assert.equal((await call('/admin/analytics/live/data?mode=init', { method: 'POST' })).status, 405);
assert.equal((await call('/admin/analytics/live/data?mode=nope')).status, 400);
const res = await call('/admin/analytics/live/data?mode=delta&since=0');
assert.equal(res.status, 200); assert.match(res.headers.get('Content-Type'), /application\/json/); assert.equal(res.headers.get('Cache-Control'), 'no-store');
const writesBefore = db.db.prepare('SELECT COUNT(*) c FROM analytics_event_queue').get().c;
const page = await call('/admin/analytics/live');
assert.equal(page.status, 200); assert.match(await page.text(), /Live Analytics/);
assert.equal(db.db.prepare('SELECT COUNT(*) c FROM analytics_event_queue').get().c, writesBefore, 'viewing the page writes nothing');

// client script: valid JS, no template-literal leaks, no eval
const html = renderLiveContent();
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
new Function(script); // throws on a syntax error
assert.ok(!/\$\{|eval\(|document\.write/.test(script), 'no leaked template expressions / eval / document.write');
assert.ok(liveClientScript({ x: '</script><script>alert(1)' }).indexOf('</script><script>alert') === -1, 'icon JSON cannot break out of the script tag');

// i18n: static + client strings are all translatable
const tr = makeTranslator({ exact: AR_EXACT, patterns: AR_PATTERNS });
const ar = translateHtml(html, tr);
assert.match(ar, /التحليلات المباشرة/); assert.match(ar, /data-k="live_on">مباشر</);
for (const k of ['pause', 'session_end', 'no_data', 'note_daily']) assert.doesNotMatch(ar, new RegExp(`data-k="${k}">[A-Za-z ]+<`), `client string ${k} translated`);
console.log('live-analytics tests: all assertions passed');
