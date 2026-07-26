// src/db/cleanup.js
// Daily job-lifecycle cleanup — separate from sync.js on purpose (sync.js
// is scoped to "talk to providers and save results"; this file is scoped
// to "decide what no longer belongs in the database"). Wired into the
// Worker's scheduled() handler via a second cron pattern in wrangler.toml.

import { ensureTable } from './schema.js';
import { BASE_URL } from '../config/constants.js';

// Cloudflare D1 hard-caps bound parameters at 100 per query (confirmed:
// https://developers.cloudflare.com/d1/platform/limits) — well below
// SQLite's usual 999. The DELETE below binds one placeholder per id in a
// single `id IN (?,?,...)` clause, so 100 is also the batch size ceiling
// here (unlike DB_BATCH_SIZE in sync.js, which batches separate INSERT/
// UPDATE statements via env.DB.batch() and only needs ~11 params each).
// A previous value of 200 silently failed this query outright (the whole
// DELETE statement is rejected before touching any row) whenever there
// were more than ~100 stale jobs to remove in one run — meaning cleanup
// had effectively stopped deleting anything past that point.
const DELETE_BATCH_SIZE = 100;

// A job is deleted once EITHER condition is true:
//  - expires_at has passed (our own computed 45-day lease, extended every
//    time a sync still finds the job at its source)
//  - updated_at is more than 30 days old (the source has stopped
//    returning this job for over a month — treated as gone for good)
// These two thresholds overlap in practice (expires_at is set from
// updated_at + 45 days, so the 30-day rule usually fires first), which is
// intentional: the shorter of the two always wins, so a source that
// briefly hiccups doesn't lose jobs prematurely, while a source that goes
// fully silent doesn't hold onto stale listings for the full 45 days.
export async function cleanupStaleJobs(env) {
  await ensureTable(env);

  const breakdown = { expired: 0, stale_30d: 0 };
  let totalDeleted = 0;

  try {
    // Count first (cheap, indexed by nothing but small enough tables to
    // scan) so the log records *why* jobs were removed, not just how many.
    const [{ results: expiredRows }, { results: staleRows }] = await Promise.all([
      env.DB.prepare("SELECT id FROM jobs WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").all(),
      env.DB.prepare("SELECT id FROM jobs WHERE (expires_at IS NULL OR expires_at >= datetime('now')) AND (updated_at IS NULL OR updated_at < datetime('now','-30 day')) AND created_at < datetime('now','-30 day')").all(),
    ]);

    const idsToDelete = [
      ...(expiredRows || []).map(r => r.id),
      ...(staleRows || []).map(r => r.id),
    ];
    breakdown.expired = (expiredRows || []).length;
    breakdown.stale_30d = (staleRows || []).length;

    // Delete in bounded batches via env.DB.batch() — same subrequest-saving
    // pattern used for saving jobs during sync (one D1 round trip per
    // batch, not one per row).
    for (let i = 0; i < idsToDelete.length; i += DELETE_BATCH_SIZE) {
      const chunk = idsToDelete.slice(i, i + DELETE_BATCH_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const r = await env.DB.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).bind(...chunk).run();
      totalDeleted += r.meta?.changes || 0;
    }
  } catch (e) {
    breakdown.error = String(e.message || e).slice(0, 200);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO cleanup_logs (deleted, reason_breakdown) VALUES (?, ?)`
    ).bind(totalDeleted, JSON.stringify(breakdown)).run();
  } catch (e) {}

  // Sitemap cache reflects deleted jobs immediately rather than waiting up
  // to an hour for the existing Cache-Control TTL to expire naturally —
  // a stale sitemap listing a job that now 410s is exactly the kind of
  // mismatch Google Search Console flags. Uses the canonical BASE_URL
  // (config/constants.js) rather than a hardcoded domain, so this stays
  // correct automatically if the site's domain ever changes again.
  try {
    const cache = caches.default;
    await cache.delete(new Request(`${BASE_URL}/sitemap.xml`));
  } catch (e) {}

  return { deleted: totalDeleted, breakdown };
}
