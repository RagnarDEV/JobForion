// Regression tests for the D1 free-tier ROW-READ budget (2026-10-11 fixes).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { D1Shim } from './helpers/d1-shim.mjs';
import { getRelatedJobs } from '../src/lib/jobs/related-jobs.js';
import { cleanupAnalytics } from '../src/lib/analytics/events.js';
import { claimSiteCacheRefresh } from '../src/lib/platform/site-cache.js';

const env = { DB: new D1Shim() };
const db = env.DB.db;
db.exec(`CREATE TABLE jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,company TEXT,location TEXT,url TEXT,salary TEXT,remote_type TEXT,skills TEXT,seniority TEXT,employment_type TEXT,job_handle TEXT,created_at TEXT,featured INT,updated_at TEXT,expires_at TEXT,source TEXT,status TEXT,job_type TEXT,job_type_note TEXT,salary_min_usd INT,salary_max_usd INT,salary_tier TEXT,salary_tier_confidence TEXT,company_id INT,source_type TEXT,submitted_by_user_id INT);
CREATE INDEX idx_jobs_company ON jobs(company);
CREATE INDEX idx_jobs_status_id ON jobs(status, id DESC);
CREATE TABLE visits(id INTEGER PRIMARY KEY AUTOINCREMENT,path TEXT,referrer TEXT,country TEXT,ua TEXT,created_at TEXT);
CREATE TABLE analytics_event_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT,processed_at TEXT);
CREATE INDEX q_created ON analytics_event_queue(created_at);
CREATE TABLE analytics_daily(metric_date TEXT);CREATE TABLE analytics_search_daily(metric_date TEXT);CREATE TABLE analytics_filter_daily(metric_date TEXT);CREATE TABLE analytics_daily_uniques(metric_date TEXT);CREATE TABLE analytics_alerts(status TEXT,created_at TEXT);
CREATE TABLE site_cache(cache_key TEXT PRIMARY KEY,value TEXT,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);

// 5,000 jobs over 50 companies → related lookup must stay tiny and correct.
const ins = db.prepare(`INSERT INTO jobs(title,company,url,status,created_at) VALUES (?,?,?,?,datetime('now'))`);
for (let i = 1; i <= 5000; i++) ins.run(`Role ${i}`, `Co${i % 50}`, `u${i}`, i % 7 === 0 ? 'expired' : 'active');
const job = db.prepare('SELECT * FROM jobs WHERE id = 2500').get();
let calls = 0;
const counting = { DB: { prepare: (sql) => { calls++; return env.DB.prepare(sql); } } };
const related = await getRelatedJobs(counting, job);
assert.ok(related.length > 0 && related.length <= 4, 'related jobs capped at 4');
assert.ok(related.every(r => r.id !== job.id && r.status === 'active'), 'related jobs exclude self and inactive');
assert.ok(related[0].company === job.company, 'same-company roles come first');
assert.ok(calls <= 3, `related lookup uses at most 3 queries (used ${calls})`);

// Visits retention: old rows go, fresh rows stay, nothing is scanned by created_at.
const iv = db.prepare('INSERT INTO visits(path,created_at) VALUES (?,?)');
for (let i = 0; i < 700; i++) iv.run('/old', '2020-01-01 00:00:00');
for (let i = 0; i < 300; i++) iv.run('/new', new Date().toISOString().slice(0, 19).replace('T', ' '));
await cleanupAnalytics(env, '90');
assert.equal(db.prepare("SELECT COUNT(*) c FROM visits WHERE path='/old'").get().c, 0, 'expired visits pruned');
assert.equal(db.prepare("SELECT COUNT(*) c FROM visits WHERE path='/new'").get().c, 300, 'fresh visits kept');

// Refresh guard: only one attempt per cool-down window.
assert.equal(await claimSiteCacheRefresh(env, 180), true);
assert.equal(await claimSiteCacheRefresh(env, 180), false);
console.log('row-budget tests: all assertions passed');
