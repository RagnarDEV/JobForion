// src/db/cleanup.js
// Daily job-lifecycle cleanup — separate from sync.js on purpose (sync.js
// is scoped to "talk to providers and save results"; this file is scoped
// to "decide what no longer belongs in the database"). Runs once a day at
// 03:30 UTC from the daily-maintenance task in src/app/cron.js (the sync itself
// runs every 3 hours — see SYNC_INTERVAL_HOURS in lib/platform/rotation.js).
// Physical deletion + tombstones live in ./job-lifecycle.js.
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

import { getSiteStats } from '../lib/platform/site-cache.js';
import { cappedCount } from '../lib/platform/job-window.js';
import { ensureTable, ensureAccountTables } from './schema.js';
import { BASE_URL } from '../config/constants.js';
import { JOBS_PER_SITEMAP } from '../lib/seo/sitemap.js';
import { hardDeleteJobs, SOFT_DELETE_RETENTION_DAYS } from './job-lifecycle.js';

// SUBREQUEST / WRITE BUDGET: this runs inside the daily-maintenance cron
// invocation, which shares Cloudflare's free-plan limit of 50 subrequests
// (every D1 call counts) with the blog-expiry, monetization and affiliate
// tasks. Phases 1-2 are therefore ONE set-based UPDATE each (no id lists,
// no chunk loops, nothing that grows with the backlog), and physical
// deletion is capped per run — a backlog simply drains over a few days.
// (The earlier version fetched every id first and updated them 100 at a
// time, which scales its D1 calls with the number of expired jobs.)
const MAX_STATUS_CHANGES_PER_RUN = 3000;
const MAX_HARD_DELETES_PER_RUN = 800; // 8 chunks of 100 = 8 D1 batches

// How long a job stays visibly 'expired' (findable in admin/company
// dashboards, still resolvable as a real row for saved_jobs/
// applications) before moving to 'archived'. Tune here — nothing else
// needs to change.
const ARCHIVE_AFTER_DAYS = 14;
// How long a job stays 'archived' before permanent deletion. Total
// worst-case lifetime of a dead job's row: the original ~30-45 day
// staleness window (see PHASE 1 below) + ARCHIVE_AFTER_DAYS + this.
const DELETE_AFTER_DAYS = 30;

// Log-table retention (days). Without it sync_logs / cleanup_logs / error_logs
// grow forever; the dashboards only ever read the latest few rows. sync_logs
// must stay well above the 72h window used by the safety valve below.
const LOG_RETENTION_DAYS = { sync_logs: 30, cleanup_logs: 90, error_logs: 30 };

// PHASE 1 predicate — a job becomes 'expired' once EITHER is true:
//  (a) expires_at has passed, or
//  (b) it is provider-synced AND its source stopped returning it: updated_at
//      older than 30 days (every successful sync resets updated_at).
// Rule (b) deliberately does NOT apply to employer-submitted / admin-approved
// jobs (source='manual' / source_type='employer'): no provider ever refreshes
// them, so under rule (b) they were being expired after 30 days instead of the
// 45-day lease they are promised. They live exactly until expires_at.
// 'deleted' is excluded so an admin-deleted row is never turned back into
// 'expired' (which would let the lifecycle later hard-delete it and sync
// re-import it).
const EXPIRE_WHERE = `status NOT IN ('expired','archived','deleted') AND (
  (expires_at IS NOT NULL AND expires_at < datetime('now'))
  OR (
    COALESCE(source_type,'provider') = 'provider' AND COALESCE(source,'') != 'manual'
    AND (expires_at IS NULL OR expires_at >= datetime('now'))
    AND (updated_at IS NULL OR updated_at < datetime('now','-30 day'))
    AND created_at < datetime('now','-30 day')
  )
)`;

class CleanupSkipped extends Error {}

export async function cleanupStaleJobs(env) {
  await ensureTable(env);
  await ensureAccountTables(env);

  const breakdown = { expired: 0, archived: 0, deleted: 0 };
  let totalDeleted = 0;
  // Used only for the (non-critical) sitemap-cache invalidation further down —
  // a stale/approximate number there just means a chunk boundary is briefly off
  // by a few jobs, not a real problem. Read once, unconditionally (0 D1 rows on
  // a warm cache), including on the "skipped" early-return path below.
  const cachedStatsForSitemap = await getSiteStats(env);

  try {
    // ── SAFETY VALVE (added after a production incident) ─────────────────
    // Lifecycle assumes the sync keeps refreshing updated_at on every job the
    // sources still return. If syncing has been BROKEN (site errors, provider
    // outage, quota) every job looks "stale" at once and this cleanup would
    // silently expire — and later permanently delete — the whole catalogue.
    // So: never advance the lifecycle unless a sync ran cleanly in the last
    // 72 hours, and never expire more than 50% of a large catalogue in one run.
    let healthy = true;
    try {
      const recent = await env.DB.prepare(
        `SELECT 1 AS ok FROM sync_logs WHERE created_at >= datetime('now','-72 hours') AND (COALESCE(inserted,0) > 0 OR errors IS NULL OR errors = '[]') LIMIT 1`
      ).first();
      healthy = !!recent;
    } catch (e) { healthy = true; /* no sync_logs yet: do not block */ }
    if (!healthy) {
      breakdown.skipped = 'no_healthy_sync_72h';
      throw new CleanupSkipped();
    }

    // ── PHASE 1: active/paused/closed → expired ──────────────────
    // See EXPIRE_WHERE above for the exact rule. The candidate count is a
    // LIVE (capped) count: it gates a potentially destructive mass-expiry
    // decision and must reflect the database as it is right now, not an
    // aggregate that may be hours stale — the exact condition (something has
    // gone wrong) this safety valve exists to catch.
    const candidates = await cappedCount(env, 'jobs', EXPIRE_WHERE, [], 20000);
    const activeTotal = await cappedCount(env, 'jobs', "status = 'active'", [], 20000);
    if (activeTotal >= 200 && candidates > activeTotal * 0.5) {
      breakdown.skipped = `mass_expiry_blocked (${candidates}/${activeTotal})`;
      throw new CleanupSkipped();
    }
    const expireRes = await env.DB.prepare(
      `UPDATE jobs SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE id IN (SELECT id FROM jobs WHERE ${EXPIRE_WHERE} LIMIT ${MAX_STATUS_CHANGES_PER_RUN})`
    ).run();
    breakdown.expired = expireRes.meta?.changes || 0;

    // ── PHASE 2: expired → archived ───────────────────────────────
    const archiveRes = await env.DB.prepare(
      `UPDATE jobs SET status = 'archived', updated_at = CURRENT_TIMESTAMP
       WHERE id IN (SELECT id FROM jobs WHERE status = 'expired' AND updated_at < datetime('now','-' || ? || ' day') LIMIT ${MAX_STATUS_CHANGES_PER_RUN})`
    ).bind(ARCHIVE_AFTER_DAYS).run();
    breakdown.archived = archiveRes.meta?.changes || 0;

    // ── PHASE 3: archived → permanently deleted ───────────────────
    // hardDeleteJobs() writes the URL tombstone, removes saved_jobs /
    // applications / job_intelligence rows and the job in ONE atomic D1 batch
    // per 100 ids (see db/job-lifecycle.js).
    const { results: toDelete } = await env.DB.prepare(
      `SELECT id FROM jobs WHERE status = 'archived' AND updated_at < datetime('now','-' || ? || ' day') ORDER BY id LIMIT ?`
    ).bind(DELETE_AFTER_DAYS, MAX_HARD_DELETES_PER_RUN).all();
    totalDeleted += await hardDeleteJobs(env, (toDelete || []).map((row) => row.id));

    // ── PHASE 4: admin-deleted ('deleted') rows past their retention ──
    // Admin deletes are soft (db/job-lifecycle.js softDeleteJobs) so sync.js
    // cannot resurrect them. Once SOFT_DELETE_RETENTION_DAYS have passed they
    // are removed for real (with a tombstone, so /job/:id answers 410).
    const room = MAX_HARD_DELETES_PER_RUN - (toDelete || []).length;
    if (room > 0) {
      const { results: oldSoft } = await env.DB.prepare(
        `SELECT id FROM jobs WHERE status = 'deleted' AND updated_at < datetime('now','-' || ? || ' day') ORDER BY id LIMIT ?`
      ).bind(SOFT_DELETE_RETENTION_DAYS, room).all();
      breakdown.purged_soft_deleted = await hardDeleteJobs(env, (oldSoft || []).map((row) => row.id));
      totalDeleted += breakdown.purged_soft_deleted;
    }
    breakdown.deleted = totalDeleted;
  } catch (e) {
    if (!(e instanceof CleanupSkipped)) breakdown.error = String(e.message || e).slice(0, 200);
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
  // lib/seo/sitemap.js), it's the per-page job sitemaps (/sitemap-jobs-N.xml)
  // that actually go stale — invalidated here regardless of whether a job
  // was deleted this run or merely changed status, since either one can
  // shift which jobs are in each chunk.
  try {
    const cache = caches.default;
    await cache.delete(new Request(`${BASE_URL}/sitemap.xml`));
    // ROW-READ BUDGET: reuse the same stats read from the safety valve above
    // (0 extra D1 rows) instead of a second live COUNT(*) over every active job.
    const jobCount = cachedStatsForSitemap ? Number(cachedStatsForSitemap.totalActive || 0)
      : Number((await env.DB.prepare("SELECT COUNT(*) c FROM jobs WHERE status = 'active'").first())?.c || 0);
    const chunks = Math.max(1, Math.ceil(jobCount / JOBS_PER_SITEMAP));
    for (let i = 1; i <= chunks; i++) {
      await cache.delete(new Request(`${BASE_URL}/sitemap-jobs-${i}.xml`));
    }
  } catch (e) {}

  // Rate-limit bookkeeping cleanup — piggybacks on this same daily cron
  // rather than getting its own schedule, since it's cheap and the two
  // jobs are already "things that tidy up D1 once a day". Every row in
  // rate_limits (see lib/platform/rate-limit.js) becomes irrelevant once its
  // window has fully elapsed; the longest window used anywhere today is
  // 60 minutes (subscribe/post-job/admin-login), so anything with a
  // window_start older than 48 hours is unambiguously stale no matter
  // which endpoint created it. Without this, the table grows by one row
  // per distinct IP forever and never shrinks.
  try {
    await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < datetime('now','-48 hours')").run();
    await env.DB.prepare("DELETE FROM job_tombstones WHERE deleted_at < datetime('now','-730 days')").run();
  } catch (e) {}

  // Operational-log retention (one independent statement per table so a table
  // that does not exist yet can never block the others).
  for (const [table, days] of Object.entries(LOG_RETENTION_DAYS)) {
    try {
      await env.DB.prepare(`DELETE FROM ${table} WHERE created_at IS NULL OR created_at < datetime('now','-' || ? || ' day')`).bind(days).run();
    } catch (e) {}
  }

  return { deleted: totalDeleted, breakdown };
}
