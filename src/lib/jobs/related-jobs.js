// src/lib/jobs/related-jobs.js
// ════════════════════════════════════════════════════════════════
// "Similar jobs" for a single job page — D1 ROW-READ BUDGET SAFE.
//
// WHY THIS FILE EXISTS (root cause of the 5.18M rows-read/day overrun):
// the previous implementation ranked related jobs with a relevance CASE +
// `LOWER(title) LIKE ?` over the latest 1,500 active jobs. A LIKE with a
// leading wildcard can never use an index, so EVERY job-page cache miss
// cost ~1,500 rows. Search-engine and AI crawlers visit thousands of
// DISTINCT job URLs per day — each one is a cache miss by definition (it is
// requested once), so the edge cache never helped: 3,500 unique job pages
// × ~1,500 rows ≈ 5.2M rows ≈ the whole daily quota.
//
// NEW COST MODEL (per job page, regardless of catalogue size):
//   1. same-company roles     → company index, LIMIT 4          (≈ 4–8 rows)
//   2. id-neighbours (filler) → primary-key range scan, LIMIT n (≈ n rows)
// Both are index-driven and stop after `limit` matches, so the total is a
// small constant (≈ 10–20 rows) instead of ~1,500.
// ════════════════════════════════════════════════════════════════

import { JOB_LISTING_COLUMNS } from '../../config/constants.js';

export const RELATED_JOBS_LIMIT = 4;

// `+jobs.status` disables the (status, …) indexes for that term so SQLite
// seeks the selective `company` index instead of scanning every active job
// (see PUBLIC_JOB_STATUS_NOINDEX_SQL in config/constants.js for the full
// reasoning). For id-range queries the (status, id) index is the right one,
// so plain `status = 'active'` is used there.
async function safeAll(env, sql, binds) {
  try {
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return results || [];
  } catch (e) {
    return [];
  }
}

export async function getRelatedJobs(env, job, limit = RELATED_JOBS_LIMIT) {
  const jobId = Number(job?.id);
  if (!Number.isInteger(jobId) || jobId < 1) return [];
  const max = Math.max(1, Math.min(12, Number(limit) | 0 || RELATED_JOBS_LIMIT));
  const picked = new Map();
  const add = (rows) => { for (const r of rows) if (r && !picked.has(r.id) && picked.size < max) picked.set(r.id, r); };

  // 1) Other open roles at the same company (most recent first).
  //    NO `+` on status here: idx_jobs_company_status_id(company, status, id DESC) serves the filter AND
  //    the ORDER BY, so this reads ~`max` rows. With `+jobs.status` SQLite sorted every job of the
  //    company (measured: 2,255 rows for one Stripe job page vs 1 row).
  const company = String(job.company || '').trim();
  if (company) {
    add(await safeAll(
      env,
      `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE company = ? AND jobs.status = 'active' AND id != ? ORDER BY id DESC LIMIT ${max}`,
      [company, jobId]
    ));
  }

  // 2) Fill the remaining slots with the nearest neighbours by id. Jobs are
  //    inserted in provider batches, so id-neighbours are naturally fresh and
  //    varied; the company filter keeps them distinct from step 1.
  if (picked.size < max) {
    const need = max - picked.size;
    add(await safeAll(
      env,
      `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE status = 'active' AND id < ? AND company != ? ORDER BY id DESC LIMIT ${need + 2}`,
      [jobId, company]
    ));
  }
  if (picked.size < max) {
    const need = max - picked.size;
    add(await safeAll(
      env,
      `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE status = 'active' AND id > ? AND company != ? ORDER BY id ASC LIMIT ${need + 2}`,
      [jobId, company]
    ));
  }
  return [...picked.values()];
}
