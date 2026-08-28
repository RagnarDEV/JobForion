// src/db/cleanup.js
// Daily job-lifecycle cleanup — separate from sync.js on purpose (sync.js
// is scoped to "talk to providers and save results"; this file is scoped
// to "decide what no longer belongs in the database"). Wired into the
// Worker's scheduled() handler via a second cron pattern in wrangler.toml.
//
// STAGE 5 (Job Management) — three-phase soft lifecycle, replacing the
// old direct-delete-once-stale approach:
//
//   active/paused/closed --[stale/expires_at passed]--> expired
//   expired              --[+ARCHIVE_AFTER_DAYS]-------> archived
//   archived             --[+DELETE_AFTER_DAYS]---------> DELETED
//
// WHY this changed: the old version deleted a job's row the moment it
// went stale — but saved_jobs and applications both hold a plain
// job_id REFERENCES jobs(id) with no ON DELETE CASCADE (D1/SQLite does
// not enforce that automatically), so an instant hard-delete silently
// orphaned every saved-jobs/applications row pointing at it — a user's
// "Saved Jobs" list would just have a dangling reference. Introducing a
// real `expired` → `archived` soft-status window before the eventual
// hard-delete means those referencing rows keep resolving to a real job
// row (which pages/job-page.js can render as "no longer available") for
// weeks, instead of vanishing the moment the source stops returning it.
//
// A job REVIVES back to 'active' automatically the moment it's touched
// again — sync.js's saveJobs() UPDATE phase always sets status='active'
// on every successful re-sync, and routes/company.router.js's
// pause/resume actions do the same — so a provider hiccup that briefly
// drops a job from its feed doesn't strand it in 'expired' forever.

import { ensureTable, ensureAccountTables } from './schema.js';
import { BASE_URL } from '../config/constants.js';
import { JOBS_PER_SITEMAP } from '../lib/sitemap.js';

// Cloudflare D1 hard-caps bound parameters at 100 per query (confirmed:
// https://developers.cloudflare.com/d1/platform/limits) — well below
// SQLite's usual 999. Every batched UPDATE/DELETE below binds one
// placeholder per id in a single `id IN (?,?,...)` clause, so 100 is
// also the batch size ceiling here (unlike DB_BATCH_SIZE in sync.js,
// which batches separate INSERT/UPDATE statements via env.DB.batch()
// and only needs ~11 params each).
const BATCH_SIZE = 100;

// How long a job stays visibly 'expired' (findable in admin/company
// dashboards, still resolvable as a real row for saved_jobs/
// applications) before moving to 'archived'. Tune here — nothing else
// needs to change.
const ARCHIVE_AFTER_DAYS = 14;
// How long a job stays 'archived' before permanent deletion. Total
// worst-case lifetime of a dead job's row: the original ~30-45 day
// staleness window (see PHASE 1 below) + ARCHIVE_AFTER_DAYS + this.
const DELETE_AFTER_DAYS = 30;

async function batchUpdateStatus(env, ids, newStatus) {
  let changed = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const r = await env.DB.prepare(`UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).bind(newStatus, ...chunk).run();
    changed += r.meta?.changes || 0;
  }
  return changed;
}

export async function cleanupStaleJobs(env) {
  await ensureTable(env);
  await ensureAccountTables(env);

  const breakdown = { expired: 0, archived: 0, deleted: 0 };
  let totalDeleted = 0;

  try {
    // ── PHASE 1: active/paused/closed → expired ──────────────────
    // A job qualifies once EITHER condition is true:
    //  - expires_at has passed (our own computed 45-day lease, extended
    //    every time a sync still finds the job at its source, or the
    //    owner explicitly pauses/resumes it)
    //  - updated_at is more than 30 days old (the source has stopped
    //    returning this job for over a month — treated as gone for good)
    // These two thresholds overlap in practice (expires_at is set from
    // updated_at + 45 days), which is intentional: the shorter of the two
    // always wins, so a source that briefly hiccups doesn't lose jobs
    // prematurely, while a source that goes fully silent doesn't hold
    // onto stale listings for the full 45 days. Excludes rows already
    // past this phase (expired/archived) so they aren't re-touched here.
    const { results: toExpire } = await env.DB.prepare(
      `SELECT id FROM jobs WHERE status NOT IN ('expired','archived') AND (
         (expires_at IS NOT NULL AND expires_at < datetime('now'))
         OR ((expires_at IS NULL OR expires_at >= datetime('now')) AND (updated_at IS NULL OR updated_at < datetime('now','-30 day')) AND created_at < datetime('now','-30 day'))
       )`
    ).all();
    breakdown.expired = await batchUpdateStatus(env, (toExpire || []).map(r => r.id), 'expired');

    // ── PHASE 2: expired → archived ───────────────────────────────
    const { results: toArchive } = await env.DB.prepare(
      `SELECT id FROM jobs WHERE status = 'expired' AND updated_at < datetime('now','-' || ? || ' day')`
    ).bind(ARCHIVE_AFTER_DAYS).all();
    breakdown.archived = await batchUpdateStatus(env, (toArchive || []).map(r => r.id), 'archived');

    // ── PHASE 3: archived → permanently deleted ───────────────────
    const { results: toDelete } = await env.DB.prepare(
      `SELECT id,job_handle,url FROM jobs WHERE status = 'archived' AND updated_at < datetime('now','-' || ? || ' day')`
    ).bind(DELETE_AFTER_DAYS).all();
    const deleteRows = toDelete || [];
    for (let i = 0; i < deleteRows.length; i += BATCH_SIZE) {
      const chunk = deleteRows.slice(i, i + BATCH_SIZE);
      const ids = chunk.map(row => row.id);
      const placeholders = ids.map(() => '?').join(',');
      // Preserve only the URL identity before hard deletion so the public
      // route can return a truthful 410 instead of guessing from MAX(id).
      const tombstones = chunk.map(row => env.DB.prepare('INSERT OR IGNORE INTO job_tombstones (job_id,job_handle,url,deleted_at) VALUES (?,?,?,CURRENT_TIMESTAMP)').bind(row.id, row.job_handle || null, row.url || null));
      if (typeof env.DB.batch === 'function') await env.DB.batch(tombstones);
      else for (const statement of tombstones) await statement.run();
      // Remove dependent rows first. D1/SQLite does not automatically
      // cascade these legacy references, so deleting jobs alone would leave
      // broken Saved Jobs, Applications, and job-intelligence records.
      const dependents = [
        env.DB.prepare(`DELETE FROM saved_jobs WHERE job_id IN (${placeholders})`).bind(...ids),
        env.DB.prepare(`DELETE FROM applications WHERE job_id IN (${placeholders})`).bind(...ids),
        env.DB.prepare(`DELETE FROM job_intelligence WHERE job_id IN (${placeholders})`).bind(...ids),
      ];
      if (typeof env.DB.batch === 'function') await env.DB.batch(dependents);
      else for (const statement of dependents) await statement.run();
      const r = await env.DB.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).bind(...ids).run();
      totalDeleted += r.meta?.changes || 0;
    }
    breakdown.deleted = totalDeleted;
  } catch (e) {
    breakdown.error = String(e.message || e).slice(0, 200);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO cleanup_logs (deleted, reason_breakdown) VALUES (?, ?)`
    ).bind(totalDeleted, JSON.stringify(breakdown)).run();
  } catch (e) {}

  // Sitemap cache reflects status changes immediately rather than waiting
  // up to an hour for the existing Cache-Control TTL to expire naturally
  // — a stale sitemap listing a job that's now expired/archived (and so
  // excluded from PUBLIC_JOB_STATUS_SQL) is exactly the kind of mismatch
  // Google Search Console flags. Since /sitemap.xml is now an INDEX (see
  // lib/sitemap.js), it's the per-page job sitemaps (/sitemap-jobs-N.xml)
  // that actually go stale — invalidated here regardless of whether a job
  // was deleted this run or merely changed status, since either one can
  // shift which jobs are in each chunk.
  try {
    const cache = caches.default;
    await cache.delete(new Request(`${BASE_URL}/sitemap.xml`));
    const { results: cntRows } = await env.DB.prepare("SELECT COUNT(*) c FROM jobs WHERE status = 'active'").all();
    const jobCount = cntRows?.[0]?.c || 0;
    const chunks = Math.max(1, Math.ceil(jobCount / JOBS_PER_SITEMAP));
    for (let i = 1; i <= chunks; i++) {
      await cache.delete(new Request(`${BASE_URL}/sitemap-jobs-${i}.xml`));
    }
  } catch (e) {}

  // Rate-limit bookkeeping cleanup — piggybacks on this same daily cron
  // rather than getting its own schedule, since it's cheap and the two
  // jobs are already "things that tidy up D1 once a day". Every row in
  // rate_limits (see lib/rate-limit.js) becomes irrelevant once its
  // window has fully elapsed; the longest window used anywhere today is
  // 60 minutes (subscribe/post-job/admin-login), so anything with a
  // window_start older than 48 hours is unambiguously stale no matter
  // which endpoint created it. Without this, the table grows by one row
  // per distinct IP forever and never shrinks.
  try {
    await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < datetime('now','-48 hours')").run();
    await env.DB.prepare("DELETE FROM job_tombstones WHERE deleted_at < datetime('now','-730 days')").run();
  } catch (e) {}

  return { deleted: totalDeleted, breakdown };
}
