// src/db/job-lifecycle.js
// ════════════════════════════════════════════════════════════════
// Shared job-removal primitives. cleanup.js (scheduled) and the admin routes
// (manual) both go through here so the rules live in ONE place.
//
//   softDeleteJobs()  — what the admin "Delete" button does. The row stays,
//                       status becomes 'deleted' (content is kept so Restore is
//                       lossless). Why not DELETE FROM jobs?
//                         1. sync.js re-inserts any URL it can no longer find
//                            in `jobs`, so a hard-deleted provider job came
//                            back on the next 3-hourly sync. A row with
//                            status='deleted' is recognised by sync.js and
//                            skipped (it also is never revived by the touch /
//                            update statements — they all carry
//                            `AND status != 'deleted'`).
//                         2. saved_jobs / applications reference jobs(id)
//                            without ON DELETE CASCADE; keeping the row means
//                            those references still resolve (job page shows
//                            "no longer available").
//                       Fully reversible from Admin → Jobs → Restore.
//
//   hardDeleteJobs()  — physical removal, used only by the scheduled cleanup
//                       (archived → deleted, and soft-deleted rows after
//                       SOFT_DELETE_RETENTION_DAYS). ONE D1 batch per chunk
//                       (tombstone + dependents + job, atomic) = 1 subrequest
//                       per ≤100 ids, which matters on the free plan's
//                       50-subrequest budget.
// ════════════════════════════════════════════════════════════════

// D1 allows at most 100 bound parameters per statement.
export const JOB_ID_CHUNK = 100;

// How long an admin-deleted row is kept (as a hidden tombstone) so that sync
// does not resurrect it. After this, it is physically removed; if its source
// is STILL listing the job it would be re-imported — at that point the job is
// plainly wanted by the source and the admin can delete it again.
export const SOFT_DELETE_RETENTION_DAYS = 180;

function cleanIds(ids) {
  const out = [];
  const seen = new Set();
  for (const raw of ids || []) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

export async function softDeleteJobs(env, ids) {
  const list = cleanIds(ids);
  let changed = 0;
  for (let i = 0; i < list.length; i += JOB_ID_CHUNK) {
    const chunk = list.slice(i, i + JOB_ID_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const r = await env.DB.prepare(
      `UPDATE jobs SET status='deleted', featured=0, updated_at=CURRENT_TIMESTAMP
       WHERE status != 'deleted' AND id IN (${placeholders})`
    ).bind(...chunk).run();
    changed += r.meta?.changes || 0;
  }
  return changed;
}

export async function hardDeleteJobs(env, ids) {
  const list = cleanIds(ids);
  let deleted = 0;
  for (let i = 0; i < list.length; i += JOB_ID_CHUNK) {
    const chunk = list.slice(i, i + JOB_ID_CHUNK);
    const ph = chunk.map(() => '?').join(',');
    const stmts = [
      // Keep only the URL identity so the public route can answer 410 Gone.
      env.DB.prepare(`INSERT OR IGNORE INTO job_tombstones (job_id,job_handle,url,deleted_at) SELECT id,job_handle,url,CURRENT_TIMESTAMP FROM jobs WHERE id IN (${ph})`).bind(...chunk),
      env.DB.prepare(`DELETE FROM saved_jobs WHERE job_id IN (${ph})`).bind(...chunk),
      env.DB.prepare(`DELETE FROM applications WHERE job_id IN (${ph})`).bind(...chunk),
      env.DB.prepare(`DELETE FROM job_intelligence WHERE job_id IN (${ph})`).bind(...chunk),
      env.DB.prepare(`DELETE FROM jobs WHERE id IN (${ph})`).bind(...chunk),
    ];
    const results = typeof env.DB.batch === 'function'
      ? await env.DB.batch(stmts)
      : await Promise.all(stmts.map((s) => s.run()));
    deleted += results[results.length - 1]?.meta?.changes || 0;
  }
  return deleted;
}
