// Tests for the 3-hourly sync: read-before-write, write budget, fair rotation, diversity.
import assert from 'node:assert/strict';
import { D1Shim } from './helpers/d1-shim.mjs';
import { saveJobs, interleaveByCompany, orderSourcesFairly, jobContentHash, ensureContentHashColumn, resetContentHashColumnProbe } from '../src/db/sync.js';
import { readFileSync } from 'node:fs';
import { pickRotatingWindow, syncSlot, SYNC_INTERVAL_MS } from '../src/lib/platform/rotation.js';
import { WRITE_COST, runAllowance, syncRunsLeftToday, loadSyncState, saveSyncState, parseDailyBudget } from '../src/lib/platform/write-budget.js';

const env = { DB: new D1Shim() };
const db = env.DB.db;
db.exec(`CREATE TABLE jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,company TEXT,location TEXT,url TEXT UNIQUE,description TEXT,salary TEXT,remote_type TEXT,skills TEXT,seniority TEXT,employment_type TEXT,job_handle TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,featured INT,updated_at TEXT,expires_at TEXT,source TEXT,status TEXT,salary_min_usd INT,salary_max_usd INT,salary_tier TEXT,salary_tier_confidence TEXT,content_hash TEXT);
CREATE TABLE site_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);`);

const mk = (i, company = 'Acme') => ({ title: `Role ${i}`, company, location: 'Remote', url: `https://x.test/${company}/${i}`, description: `Desc ${i}`, salary: '', remote_type: 'fully_remote', skills: [], seniority: '', employment_type: 'full_time', job_handle: String(i) });
const fresh = () => ({ inserted: 0, updated: 0, skipped: 0 });
const errs = { add() {} };
const run = (jobs, budget = { remaining: 1e9 }) => { const c = fresh(); return saveJobs(env, jobs, c, errs, 'lever', {}, budget).then((r) => ({ ...r, c })); };

// 1. new jobs insert; hash stored
const batch = Array.from({ length: 120 }, (_, i) => mk(i));
let r = await run(batch);
assert.equal(r.inserted, 120);
assert.ok(db.prepare('SELECT COUNT(*) c FROM jobs WHERE content_hash IS NOT NULL').get().c === 120);

// 2. identical re-sync writes NOTHING
const updatedBefore = db.prepare('SELECT MAX(updated_at) m FROM jobs').get().m;
r = await run(batch);
assert.equal(r.inserted + r.updated + r.touched, 0, 'unchanged jobs are not rewritten');
assert.equal(r.unchanged, 120);

// 3. changed description → exactly one full update
const changed = batch.map((j, i) => (i === 5 ? { ...j, description: 'new text' } : j));
r = await run(changed);
assert.equal(r.updated, 1);
assert.equal(db.prepare('SELECT description d FROM jobs WHERE url=?').get(batch[5].url).d, 'new text');

// 4. stale lifecycle → touch only (content untouched)
db.prepare("UPDATE jobs SET updated_at=datetime('now','-12 day') WHERE id<=10").run();
r = await run(changed);
assert.equal(r.touched, 10, 'stale unchanged jobs are only touched');
assert.equal(r.updated, 0);

// 5. expired job that reappears is revived by a touch
db.prepare("UPDATE jobs SET status='expired' WHERE id=20").run();
r = await run(changed);
assert.equal(db.prepare('SELECT status s FROM jobs WHERE id=20').get().s, 'active');

// 6. admin-edited job ('manual') is never overwritten by the sync
db.prepare("UPDATE jobs SET content_hash='manual', title='Edited by admin' WHERE id=30").run();
await run(changed.map((j, i) => (i === 29 ? { ...j, title: 'Provider title changed' } : j)));
await run(changed); // settle: provider title for job 30 reverted (manual job stays manual)
assert.equal(db.prepare('SELECT title t FROM jobs WHERE id=30').get().t, 'Edited by admin');

// 7. legacy rows (NULL hash) are adopted cheaply, not fully rewritten
db.prepare("UPDATE jobs SET content_hash=NULL WHERE id BETWEEN 40 AND 49").run();
r = await run(changed);
assert.equal(r.updated, 0, 'legacy rows are adopted, not rewritten');
assert.equal(db.prepare('SELECT COUNT(*) c FROM jobs WHERE content_hash IS NULL').get().c, 0);

// 8. write budget: new jobs beyond the allowance are deferred, never over-written
const budget = { remaining: WRITE_COST.insert * 7 };
r = await run(Array.from({ length: 50 }, (_, i) => mk(i, 'Beta')), budget);
assert.equal(r.inserted, 7);
assert.equal(r.deferred, 43);
assert.ok(budget.remaining >= 0 && budget.remaining < WRITE_COST.insert);
r = await run(Array.from({ length: 50 }, (_, i) => mk(i, 'Beta')));
assert.equal(r.inserted, 43, 'deferred jobs arrive on a later run');

// 9. duplicate URLs inside one fetch are collapsed
r = await run([mk(900, 'Dup'), mk(900, 'Dup')]);
assert.equal(r.inserted, 1);

// 10. subrequests per chunk: one read + one write
const callsBefore = env.DB.calls;
await saveJobs(env, Array.from({ length: 80 }, (_, i) => mk(i, 'Gamma')), fresh(), errs, 'lever', {}, { remaining: 1e9 });
const calls = env.DB.calls - callsBefore;
assert.ok(calls <= 2, `80 new jobs cost ≤ 2 D1 calls (used ${calls})`);

// ── rotation: 3-hour cadence must visit EVERY window ──
const items = Array.from({ length: 15 }, (_, i) => `b${i}`);
const seen = new Set();
const t0 = Date.UTC(2026, 9, 14, 0, 0);
for (let run = 0; run < 3; run++) pickRotatingWindow(items, 5, syncSlot(t0 + run * SYNC_INTERVAL_MS)).forEach((x) => seen.add(x));
assert.equal(seen.size, 15, '15 boards / 5 per run are all covered within 3 runs (old hourly slot repeated one window)');
assert.equal(syncSlot(t0 + SYNC_INTERVAL_MS) - syncSlot(t0), 1);

// ── fair source order ──
const srcs = [3, 1, 2, 4].map((id) => ({ id, provider: 'lever' }));
assert.deepEqual(orderSourcesFairly(srcs, 0).map((s) => s.id), [1, 2, 3, 4]);
assert.deepEqual(orderSourcesFairly(srcs, 2).map((s) => s.id), [3, 4, 1, 2]);
assert.deepEqual(orderSourcesFairly(srcs, 6).map((s) => s.id), [3, 4, 1, 2], 'cursor wraps');

// ── diversity: capped window mixes companies ──
const many = [...Array.from({ length: 30 }, (_, i) => mk(i, 'A')), ...Array.from({ length: 30 }, (_, i) => mk(i, 'B')), ...Array.from({ length: 30 }, (_, i) => mk(i, 'C'))];
const first = interleaveByCompany(many).slice(0, 9);
assert.equal(new Set(first.map((j) => j.company)).size, 3, 'a window of 9 contains all three companies');

// ── budget math ──
assert.equal(syncRunsLeftToday(Date.UTC(2026, 9, 14, 0, 0)), 8);
assert.equal(syncRunsLeftToday(Date.UTC(2026, 9, 14, 21, 0)), 1);
assert.equal(runAllowance({ dailyBudget: 8000, usedToday: 0, now: Date.UTC(2026, 9, 14, 0, 0) }), 1000);
assert.equal(runAllowance({ dailyBudget: 8000, usedToday: 8000, now: Date.UTC(2026, 9, 14, 9, 0) }), 0);
assert.equal(parseDailyBudget('999999'), 95000);
assert.equal(parseDailyBudget('abc'), 55000);
assert.notEqual(jobContentHash(mk(1)), jobContentHash(mk(2)));

// ── state persistence + day rollover ──
const now = Date.UTC(2026, 9, 14, 6, 0);
await saveSyncState(env, { day: '2026-10-14', used: 1234, cursor: 5 });
let st = await loadSyncState(env, now);
assert.deepEqual([st.used, st.cursor], [1234, 5]);
st = await loadSyncState(env, Date.UTC(2026, 9, 15, 0, 0));
assert.equal(st.used, 0, 'counter resets on a new UTC day');
assert.equal(st.cursor, 5, 'cursor survives the day change');
// ── REGRESSION (v2.5.0 outage): code needs jobs.content_hash but the migration did not run ──
const legacy = { DB: new D1Shim() };
legacy.DB.db.exec('CREATE TABLE jobs(id INTEGER PRIMARY KEY, url TEXT UNIQUE, title TEXT)');
resetContentHashColumnProbe();
const healed = await ensureContentHashColumn(legacy);
assert.ok(healed.ok && healed.healed, 'missing content_hash column is added by the sync itself');
assert.ok(legacy.DB.db.prepare('PRAGMA table_info(jobs)').all().some((c) => c.name === 'content_hash'));
resetContentHashColumnProbe();
assert.ok((await ensureContentHashColumn(legacy)).ok, 'second probe is a no-op');

// ── GUARD: new migration units are useless unless SCHEMA_VERSION changes ──
// Fingerprint of the migration source; when it changes, SCHEMA_VERSION in db/schema.js
// MUST change too (otherwise the migration never runs on deployed databases).
const migrationSource = ['account-tables', 'core-tables', 'ai-tables'].map((f) => readFileSync(new URL(`../src/db/schema/${f}.js`, import.meta.url), 'utf8')).join('\n');
let fp = 2166136261;
for (let i = 0; i < migrationSource.length; i++) { fp ^= migrationSource.charCodeAt(i); fp = Math.imul(fp, 16777619) >>> 0; }
const schemaVersion = /const SCHEMA_VERSION = '([^']+)'/.exec(readFileSync(new URL('../src/db/schema.js', import.meta.url), 'utf8'))[1];
const RECORDED = { version: '2026-10-21.1', fingerprint: 1299468558 }; // update BOTH when migrations change
if (RECORDED.fingerprint !== 0 && fp !== RECORDED.fingerprint) assert.notEqual(schemaVersion, RECORDED.version, 'migration source changed — bump SCHEMA_VERSION');
console.log(`schema fingerprint ${fp} @ SCHEMA_VERSION ${schemaVersion}`);
console.log('sync-budget tests: all assertions passed');
