// src/app/cron.js
// ════════════════════════════════════════════════════════════════
// Scheduled-task dispatcher.
//
// WHY ONE TRIGGER: Cloudflare's free plan allows only 5 Cron Triggers per
// ACCOUNT (not per Worker). JobForion used all five on its own. A single
// "*/30 * * * *" trigger is now dispatched here by UTC time instead:
//
//   minute :30 (every hour)  → analytics aggregation + retention + alerts
//   minute :00, hour % 6 = 0 → job sync           (00, 06, 12, 18 UTC)
//   minute :00, hour = 3     → daily maintenance  (job cleanup, blog expiry,
//                                                  monetization campaigns)
//   minute :00, hour = 8     → job-alerts digest dispatch
//   minute :00, hour = 9     → blog generation check
//
// EACH INVOCATION RUNS AT MOST ONE TASK GROUP. That is deliberate: the free
// plan's 50-subrequest budget is per invocation (D1 queries count), so the
// sync governor's ceiling (see db/sync.js) must never share an invocation
// with another task. Slots never collide (:00 vs :30).
//
// LEGACY: if the old five triggers are still registered on the account
// (event.cron matches one of them) they keep working exactly as before.
// ════════════════════════════════════════════════════════════════

import { ensureAllSchema } from '../db/schema.js';
import { syncJobs } from '../db/sync.js';
import { cleanupStaleJobs } from '../db/cleanup.js';
import { getSettings } from '../lib/platform/settings.js';
import { runBlogGeneration } from '../lib/content/blog-automation/generator.js';
import { runBlogExpirationCleanup } from '../lib/content/blog-automation/expiration.js';
import { runJobAlertsDispatch } from '../lib/jobs/job-alerts-dispatcher.js';
import { expireMonetizationCampaigns } from '../lib/monetization/core.js';
import { aggregateAnalytics, cleanupAnalytics, evaluateAnalyticsAlerts } from '../lib/analytics/events.js';
import { reportOperationalError } from '../lib/platform/observability.js';

const CRON_LEASE_MS = 10 * 60 * 1000;

export async function withCronLease(env, name, task) {
  await ensureAllSchema(env);
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
    await cleanupAnalytics(env, settings.analytics_retention);
    await evaluateAnalyticsAlerts(env, settings);
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
  if (when.getUTCMinutes() >= 30) return ['analytics'];
  if (hour === 3) return ['daily-maintenance'];
  if (hour === 8) return ['job-alerts'];
  if (hour === 9) return ['blog-generation'];
  if (hour % 6 === 0) return ['job-sync'];
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
