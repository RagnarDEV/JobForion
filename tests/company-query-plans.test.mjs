// Job-page company queries must be served by idx_jobs_company_status_id with NO sort step
// (a TEMP B-TREE here read every job of the company on every job-page view: ~2,255 rows for one Stripe job).
import assert from 'node:assert/strict';
import { D1Shim } from './helpers/d1-shim.mjs';
import { ensureAllSchema } from '../src/db/schema.js';
import { companySnapshot } from '../src/lib/directory/entities.js';
import { getRelatedJobs } from '../src/lib/jobs/related-jobs.js';

const shim = new D1Shim();
const env = { DB: shim, SCHEMA_MIGRATION_BUDGET: '500' };
await ensureAllSchema(env);
const db = shim.db;
db.exec('BEGIN');
const ins = db.prepare(`INSERT INTO jobs (title,company,location,url,status,created_at,updated_at,expires_at) VALUES (?,?,?,?,'active',datetime('now'),datetime('now'),datetime('now','+30 day'))`);
for (let i = 1; i <= 600; i++) ins.run(`dev ${i}`, i <= 500 ? 'Big Co' : `Co${i}`, 'Remote', `u${i}`);
db.exec('COMMIT');
db.exec('ANALYZE');

const plan = (sql, ...p) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p).map(r => r.detail).join(' | ');
for (const sql of [
  "SELECT created_at FROM jobs WHERE company = ? AND jobs.status = 'active' ORDER BY id ASC LIMIT 1",
  "SELECT id FROM jobs WHERE company = ? AND jobs.status = 'active' AND id != 5 ORDER BY id DESC LIMIT 4",
]) {
  const p = plan(sql, 'Big Co');
  assert.match(p, /idx_jobs_company_status_id \(company=\? AND status=\?\)/, p);
  assert.doesNotMatch(p, /TEMP B-TREE/, `no sort step: ${p}`);
}

// the real functions return correct data
const snap = await companySnapshot(env, 'Big Co');
assert.equal(snap.openPositions, 200); assert.equal(snap.capped, true); assert.ok(snap.firstSeen);
const rel = await getRelatedJobs(env, { id: 7, company: 'Big Co', title: 'dev 7' }, 4);
assert.ok(rel.length >= 1 && rel.every(j => j.id !== 7));
assert.ok(rel.slice(0, 4).filter(j => j.company === 'Big Co').length >= 1);
console.log('company-query-plans tests: all assertions passed');
