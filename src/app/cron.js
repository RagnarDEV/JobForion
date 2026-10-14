// src/app/cron.js
// ════════════════════════════════════════════════════════════════
// Scheduled-task dispatcher.
//
// WHY ONE TRIGGER: Cloudflare's free plan allows only 5 Cron Triggers per
// ACCOUNT (not per Worker). A single "*/30 * * * *" trigger is dispatched here
// by UTC time instead:
//
//   :00, hour % 3 = 0        → job sync           (00,03,06,09,12,15,18,21 UTC)
//   :30, hour = 3            → daily maintenance  (job cleanup, blog expiry,
//                                                  monetization campaigns) —
//                                                  runs right AFTER the 03:00 sync
//   :00, hour = 8            → job-alerts digest dispatch
//   :30, hour = 9            → blog generation check (09:00 is a sync slot)
//   :30, every other hour    → analytics aggregation + retention + alerts
//
// EACH INVOCATION RUNS AT MOST ONE TASK GROUP. That is deliberate: the free
// plan's 50-subrequest budget is per invocation (D1 queries count), so the
// sync governor's ceiling (see db/sync.js) must never share an invocation with
// another task. The sync cadence is SYNC_INTERVAL_HOURS in
// lib/platform/rotation.js — the two must stay in step.
//
// LEGACY: if the old five triggers are still registered on the account
// (event.cron matches one of them) they keep working exactly as before.
// ════════════════════════════════════════════════════════════════

import { ensureAllSchema, SCHEMA_MIGRATION_BUDGET_BACKGROUND } from '../db/schema.js';
import { syncJobs } from '../db/sync.js';
import { cleanupStaleJobs } from '../db/cleanup.js';
import { getSettings } from '../lib/platform/settings.js';
import { runBlogGeneration } from '../lib/content/blog-automation/generator.js';
import { runBlogExpirationCleanup } from '../lib/content/blog-automation/expiration.js';
import { runJobAlertsDispatch } from '../lib/jobs/job-alerts-dispatcher.js';
import { expireMonetizationCampaigns } from '../lib/monetization/core.js';
import { aggregateAnalytics, cleanupAnalytics, evaluateAnalyticsAlerts } from '../lib/analytics/events.js';
import { SYNC_INTERVAL_HOURS } from '../lib/platform/rotation.js';
import { reportOperationalError } from '../lib/platform/observability.js';
import { refreshSiteCache, siteCacheAgeMinutes, claimSiteCacheRefresh, SITE_CACHE_MAX_AGE_MINUTES } from '../lib/platform/site-cache.js';

const CRON_LEASE_MS = 10 * 60 * 1000;

export async function withCronLease(env, name, task) {
  // A scheduled invocation renders no page, so a pending schema migration may
  // use (almost) the whole 50-call budget — this is what heals a schema that a
  // page request could only advance in small steps.
  await ensureAllSchema({ ...env, SCHEMA_MIGRATION_BUDGET: String(SCHEMA_MIGRATION_BUDGET_BACKGROUND) });
  const key = `_cron_lock_${String(name).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)}`;
  const now = Date.now();
  let acquired = false;
  try {
    const result = await env.DB.prepare(`
      INSERT INTO site_settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP
      WHERE CAST(site_settings.value AS INTEGER) < ?
    `).bind(key, String(now), String(now - CRON_LEASE_MS)).run();
    acquired = Number(result?.meta?.changes || 0) === 1;
    if (!acquired) return { skipped: true };
    return await task();
  } finally {
    if (acquired) {
      try { await env.DB.prepare('DELETE FROM site_settings WHERE key = ?').bind(key).run(); } catch (e) {}
    }
  }
}

// Task registry — add a new scheduled job by adding one entry here and one
// line in pickTasks(); index.js never changes.
const TASKS = {
  analytics: async (env) => {
    // Keep this sequence in one chain: cleanup must never race aggregation
    // and delete queue rows before they are processed.
    await aggregateAnalytics(env);
    const settings = await getSettings(env);
    // Retention is a DAILY chore (04:30 UTC), not an hourly one — see cleanupAnalytics().
    if (new Date().getUTCHours() === 4) await cleanupAnalytics(env, settings.analytics_retention);
    await evaluateAnalyticsAlerts(env, settings);
    // Precomputed aggregates (see lib/platform/site-cache.js): refreshed at most
    // every ~6h, or immediately when missing (first run after a deploy).
    if (await siteCacheAgeMinutes(env) > SITE_CACHE_MAX_AGE_MINUTES && await claimSiteCacheRefresh(env)) await refreshSiteCache(env);
  },
  'daily-maintenance': async (env) => {
    await Promise.all([cleanupStaleJobs(env), runBlogExpirationCleanup(env), expireMonetizationCampaigns(env)]);
  },
  'job-alerts': (env) => runJobAlertsDispatch(env),
  'blog-generation': (env, ctx) => runBlogGeneration(env, { ctx }),
  'job-sync': (env) => syncJobs(env),
};

const LEGACY_CRONS = {
  '15 * * * *': ['analytics'],
  '0 3 * * *': ['daily-maintenance'],
  '0 8 * * *': ['job-alerts'],
  '0 9 * * *': ['blog-generation'],
  '0 */6 * * *': ['job-sync'],
};

export function pickTasks(event) {
  if (event && LEGACY_CRONS[event.cron]) return LEGACY_CRONS[event.cron];
  const when = new Date((event && event.scheduledTime) || Date.now());
  const hour = when.getUTCHours();
  const late = when.getUTCMinutes() >= 30;
  // Sync slots own the :00 minute of every 3rd hour. The two daily tasks that
  // would collide with a slot (03:00, 09:00) move to :30 of that same hour.
  if (late && hour === 3) return ['daily-maintenance'];
  if (late && hour === 9) return ['blog-generation'];
  if (late) return ['analytics'];
  if (hour === 8) return ['job-alerts'];
  if (hour % SYNC_INTERVAL_HOURS === 0) return ['job-sync'];
  return [];
}

async function logCronFailure(env, name, error) {
  reportOperationalError(`cron.${name}`, error);
  try {
    await env.DB.prepare('INSERT INTO error_logs (path, message, stack) VALUES (?, ?, ?)')
      .bind(`cron:${name}`, String((error && error.message) || error || 'Unknown error').slice(0, 500), String((error && error.stack) || '').slice(0, 4000)).run();
  } catch (e) { /* error_logs may not exist yet — never worth failing over */ }
}

export function runScheduled(event, env, ctx) {
  const names = pickTasks(event);
  for (const name of names) {
    const run = TASKS[name];
    if (!run) continue;
    ctx.waitUntil(
      withCronLease(env, name, () => run(env, ctx)).catch((e) => logCronFailure(env, name, e))
    );
  }
}
