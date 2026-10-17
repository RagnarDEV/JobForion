// Job lifecycle: set-based cleanup, soft delete (no resurrection by sync),
// employer-job lease, log retention, URL validation, UTC date parsing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { D1Shim } from './helpers/d1-shim.mjs';

globalThis.caches = { default: { async match() { return undefined; }, async put() {}, async delete() { return true; } } };

const { ensureAllSchema } = await import('../src/db/schema.js');
const { cleanupStaleJobs } = await import('../src/db/cleanup.js');
const { saveJobs } = await import('../src/db/sync.js');
const { softDeleteJobs, hardDeleteJobs } = await import('../src/db/job-lifecycle.js');
const { isSafeHttpUrl, safeExternalUrl } = await import('../src/lib/platform/safe-url.js');
const { parseDbDate, dbDateYmd } = await import('../src/lib/platform/db-date.js');

const env = { DB: new D1Shim() };
const db = env.DB.db;
// ensureTable() & co. are no-ops outside a migration — the real bootstrap is ensureAllSchema().
await ensureAllSchema({ ...env, SCHEMA_MIGRATION_BUDGET: '100000' });

const ins = db.prepare(`INSERT INTO jobs (title,company,location,url,description,source,source_type,status,created_at,updated_at,expires_at,content_hash)
  VALUES (?,?,?,?,?,?,?,?,datetime('now',?),datetime('now',?),datetime('now',?),?)`);
const add = (n, o = {}) => ins.run(`Job ${n}`, 'Acme', 'Remote', `https://x.test/${n}`, 'desc', o.source ?? 'lever', o.type ?? 'provider', o.status ?? 'active',
  o.created ?? '-1 day', o.updated ?? '-1 day', o.expires ?? '+40 days', o.hash ?? 'h');
const statusOf = (n) => db.prepare('SELECT status FROM jobs WHERE url=?').get(`https://x.test/${n}`)?.status;

// healthy sync recently (safety valve) — and 250 fresh active jobs so the 50% valve has a denominator
db.prepare("INSERT INTO sync_logs (inserted,skipped,errors,created_at) VALUES (5,0,'[]',datetime('now','-2 hours'))").run();
for (let i = 1000; i < 1250; i++) add(i);

// ── 1. cleanup phases are set-based, and the lease rules are right ─────────
add(1, { created: '-50 days', updated: '-31 days', expires: '+14 days' });                       // provider, source silent >30d  → expired
add(2, { created: '-5 days', updated: '-1 day', expires: '-1 day' });                              // lease passed                  → expired
add(3, { source: 'manual', type: 'employer', created: '-35 days', updated: '-35 days', expires: '+10 days' }); // employer: 30d rule must NOT apply
add(4, { source: 'manual', type: 'employer', created: '-46 days', updated: '-46 days', expires: '-1 day' });   // employer past 45d lease        → expired
add(5, { status: 'expired', updated: '-15 days', created: '-80 days', expires: '-30 days' });      // expired > 14d                 → archived
add(6, { status: 'archived', updated: '-31 days', created: '-120 days', expires: '-60 days' });    // archived > 30d                → hard-deleted
add(7, { status: 'deleted', updated: '-1 day', created: '-60 days', expires: '-10 days' });        // admin-deleted, recent         → must stay 'deleted'
add(8, { status: 'deleted', updated: '-181 days', created: '-300 days', expires: '-200 days' });   // admin-deleted, past retention → purged
const id6 = db.prepare("SELECT id FROM jobs WHERE url='https://x.test/6'").get().id;
db.prepare("INSERT INTO users (email,password_hash) VALUES ('t@example.test','x')").run();
db.prepare('INSERT INTO saved_jobs (user_id,job_id) VALUES (1,?)').run(id6);

env.DB.startRequest(0);
const before = env.DB.calls;
const res = await cleanupStaleJobs(env);
const used = env.DB.calls - before;
assert.equal(res.breakdown.error, undefined, 'cleanup must not error: ' + res.breakdown.error);
assert.equal(statusOf(1), 'expired');
assert.equal(statusOf(2), 'expired');
assert.equal(statusOf(3), 'active', 'employer job keeps its 45-day lease (30-day stale rule is provider-only)');
assert.equal(statusOf(4), 'expired');
assert.equal(statusOf(5), 'archived');
assert.equal(statusOf(6), undefined, 'archived >30d is physically deleted');
assert.equal(statusOf(7), 'deleted', 'recent admin-deleted row is never touched by the lifecycle');
assert.equal(statusOf(8), undefined, 'soft-deleted row past retention is purged');
assert.equal(db.prepare('SELECT COUNT(*) c FROM saved_jobs WHERE job_id=?').get(id6).c, 0, 'dependents removed with the job');
assert.ok(db.prepare('SELECT 1 FROM job_tombstones WHERE job_id=?').get(id6), 'tombstone written → public route answers 410');
assert.ok(used <= 30, `cleanup must stay far below the 50-subrequest budget (used ${used})`);

// ── 2. mass-expiry safety valve still blocks a runaway ────────────────────
db.prepare("UPDATE jobs SET updated_at=datetime('now','-40 days'), created_at=datetime('now','-60 days') WHERE url LIKE 'https://x.test/1___'").run();
const blocked = await cleanupStaleJobs(env);
assert.match(String(blocked.breakdown.skipped || ''), /mass_expiry_blocked/);
assert.equal(db.prepare("SELECT COUNT(*) c FROM jobs WHERE status='active' AND url LIKE 'https://x.test/1___'").get().c, 250);

// ── 3. cleanup refuses to run without a recent healthy sync ───────────────
db.prepare('DELETE FROM sync_logs').run();
const noSync = await cleanupStaleJobs(env);
assert.equal(noSync.breakdown.skipped, 'no_healthy_sync_72h');

// ── 4. log retention ──────────────────────────────────────────────────────
db.prepare("INSERT INTO sync_logs (inserted,skipped,errors,created_at) VALUES (1,0,'[]',datetime('now','-40 days')),(1,0,'[]',datetime('now','-1 hours'))").run();
db.prepare("INSERT INTO cleanup_logs (deleted,reason_breakdown,created_at) VALUES (0,'{}',datetime('now','-100 days'))").run();
db.prepare("INSERT INTO error_logs (path,message,stack,created_at) VALUES ('x','old','',datetime('now','-45 days')),('x','new','',datetime('now','-1 days'))").run();
await cleanupStaleJobs(env);
assert.equal(db.prepare("SELECT COUNT(*) c FROM sync_logs WHERE created_at < datetime('now','-30 days')").get().c, 0);
assert.equal(db.prepare("SELECT COUNT(*) c FROM sync_logs WHERE created_at >= datetime('now','-2 hours')").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) c FROM error_logs WHERE message='old'").get().c, 0);
assert.equal(db.prepare("SELECT COUNT(*) c FROM error_logs WHERE message='new'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) c FROM cleanup_logs WHERE created_at < datetime('now','-90 days')").get().c, 0);

// ── 5. soft delete: sync can neither revive nor re-insert it ──────────────
add(50);
const id50 = db.prepare("SELECT id FROM jobs WHERE url='https://x.test/50'").get().id;
assert.equal(await softDeleteJobs(env, [id50, id50, 'nope', -3]), 1, 'ids are de-duplicated and validated');
const feed = { title: 'Job 50 (changed upstream)', company: 'Acme', location: 'Remote', url: 'https://x.test/50', description: 'new text', salary: '', remote_type: '', skills: [], seniority: '', employment_type: '', job_handle: '50' };
const counters = { inserted: 0, updated: 0, skipped: 0 };
await saveJobs(env, [feed], counters, { add() {} }, 'lever', {}, { remaining: 1e9 });
assert.equal(statusOf(50), 'deleted', 'sync must not resurrect an admin-deleted job');
assert.equal(db.prepare("SELECT description d FROM jobs WHERE url='https://x.test/50'").get().d, 'desc', 'content untouched');
assert.equal(counters.inserted + counters.updated, 0);
assert.equal(db.prepare("SELECT COUNT(*) c FROM jobs WHERE url='https://x.test/50'").get().c, 1, 'and does not insert a duplicate');
// the statements themselves are also guarded (race safety)
db.prepare("UPDATE jobs SET content_hash='stale-hash' WHERE url='https://x.test/50'").run();
await saveJobs(env, [{ ...feed, description: 'again' }], counters, { add() {} }, 'lever', {}, { remaining: 1e9 });
assert.equal(statusOf(50), 'deleted');

// ── 6. ingest rejects non-http(s) apply URLs ──────────────────────────────
const bad = ['javascript:alert(1)', 'data:text/html,x', '//evil.test/x', 'https://', 'ftp://x.test/a', 'https://x.test/a b'];
const c2 = { inserted: 0, updated: 0, skipped: 0 };
await saveJobs(env, bad.map((u, i) => ({ ...feed, title: `Bad ${i}`, url: u })), c2, { add() {} }, 'lever', {}, { remaining: 1e9 });
assert.equal(c2.inserted, 0);
assert.equal(db.prepare("SELECT COUNT(*) c FROM jobs WHERE title LIKE 'Bad %'").get().c, 0);
for (const u of bad) assert.equal(isSafeHttpUrl(u), false, u);
assert.equal(isSafeHttpUrl('https://jobs.example.com/a?b=1'), true);
assert.equal(safeExternalUrl('javascript:alert(1)'), '');
assert.equal(isSafeHttpUrl('https://x.test/Path/'), true);

// ── 7. UTC date parsing (SQLite timestamps carry no zone) ─────────────────
assert.equal(parseDbDate('2026-10-17 10:00:00').toISOString(), '2026-10-17T10:00:00.000Z');
assert.equal(parseDbDate('2026-10-17T10:00:00Z').toISOString(), '2026-10-17T10:00:00.000Z');
assert.equal(dbDateYmd('2026-10-17 23:59:59'), '2026-10-17');
assert.match(dbDateYmd(null), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(dbDateYmd('garbage', false), '');
// the browser copy in client-script.js must implement the same rule
const client = fs.readFileSync(new URL('../src/pages/home/client-script.js', import.meta.url), 'utf8');
assert.ok(client.includes("function parseDbDate(v)") && client.includes("parseDbDate(j.created_at)"), 'client-script must parse DB dates as UTC');
const fn = new Function(client.match(/function parseDbDate\(v\)\{[^\n]*\}/)[0] + '; return parseDbDate;')();
assert.equal(fn('2026-10-17 10:00:00').toISOString(), '2026-10-17T10:00:00.000Z');

// ── 8. hardDeleteJobs is one atomic batch per 100 ids ─────────────────────
for (let i = 2000; i < 2230; i++) add(i, { status: 'archived', updated: '-90 days' });
const ids = db.prepare("SELECT id FROM jobs WHERE url LIKE 'https://x.test/2___'").all().map((r) => r.id);
const b0 = env.DB.calls;
assert.equal(await hardDeleteJobs(env, ids), 230);
assert.equal(env.DB.calls - b0, 3, '230 ids → 3 D1 batches');

console.log('job-lifecycle tests: all assertions passed');
