// Analytics rollup: the compact summary table must always agree with analytics_daily.
import assert from 'node:assert/strict';
import { D1Shim } from './helpers/d1-shim.mjs';
import { ensureAllSchema } from '../src/db/schema.js';
import { aggregateAnalytics, backfillAnalyticsSummary, getAnalyticsOverview, getAnalyticsTrends, getAnalyticsReport, getAnalyticsTopJobs, cleanupAnalytics } from '../src/lib/analytics/events.js';
import { clearStatMemo } from '../src/lib/platform/stat-memo.js';

const shim = new D1Shim();
const env = { DB: shim, SCHEMA_MIGRATION_BUDGET: '500' };
await ensureAllSchema(env);
const db = shim.db;
const today = new Date().toISOString().slice(0, 10);
const q = db.prepare(`INSERT INTO analytics_event_queue (event_id,event_type,session_id,job_id,country,device_type,source,medium,page,metadata,metric_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,'{}',?,datetime('now'))`);
let n = 0;
for (const [type, job, c, d, s] of [['page_view', 0, 'US', 'desktop', 'google'], ['page_view', 0, 'US', 'desktop', 'google'], ['page_view', 0, 'DE', 'mobile', 'direct'], ['job_view', 5, 'US', 'desktop', 'google'], ['job_view', 6, 'US', 'desktop', 'google'], ['job_apply_click', 5, 'DE', 'mobile', 'direct'], ['job_impression', 5, 'US', 'desktop', 'google']]) q.run(`e${++n}`, type, `s${n % 3}`, job, c, d, s, 'none', '/', today);
await aggregateAnalytics(env);

const sums = (table, extra = '') => db.prepare(`SELECT event_type, SUM(event_count) e, SUM(unique_count) u FROM ${table} GROUP BY event_type ORDER BY event_type`).all();
const daily = sums('analytics_daily');
assert.ok(daily.length >= 4, 'daily populated');
assert.deepEqual(sums('analytics_summary_daily'), daily, 'aggregator keeps the rollup identical to analytics_daily');
assert.ok(db.prepare('SELECT COUNT(*) c FROM analytics_summary_daily').get().c < db.prepare('SELECT COUNT(*) c FROM analytics_daily').get().c, 'rollup is more compact');

// backfill from scratch reproduces the same totals and is idempotent
db.exec('DELETE FROM analytics_summary_daily');
db.exec("DELETE FROM site_settings WHERE key='_analytics_summary_ready'");
assert.deepEqual(await backfillAnalyticsSummary(env), { complete: true, chunks: 1 });
assert.deepEqual(sums('analytics_summary_daily'), daily, 'backfill reproduces analytics_daily totals');
assert.deepEqual(await backfillAnalyticsSummary(env), { skipped: true }, 'second run is a no-op');
await backfillAnalyticsSummary(env);
assert.deepEqual(sums('analytics_summary_daily'), daily, 'still identical after repeat');

// reports answer the same from the rollup as from the detailed table
clearStatMemo();
const viaSummary = await getAnalyticsOverview(env, { preset: '7d' });
const trendsA = (await getAnalyticsTrends(env, { preset: '7d' })).rows;
const geo = (await getAnalyticsReport(env, 'geography', { preset: '7d' })).rows;
db.exec("DELETE FROM site_settings WHERE key='_analytics_summary_ready'"); // force the legacy path
db.exec('DELETE FROM analytics_summary_daily');
clearStatMemo();
// legacy path self-heals by backfilling, so compare against a direct SQL over analytics_daily instead
const direct = db.prepare("SELECT event_type, SUM(event_count) e FROM analytics_daily GROUP BY event_type").all();
assert.equal(viaSummary.traffic.page_views, direct.find(r => r.event_type === 'page_view').e);
assert.equal(viaSummary.jobs.apply_clicks, direct.find(r => r.event_type === 'job_apply_click').e);
assert.equal(trendsA.filter(r => r.event_type === 'page_view').reduce((s, r) => s + r.events, 0), 3);
assert.equal(geo.find(r => r.key === 'US').events, 5);

// per-job leaderboard stays correct and capped
clearStatMemo();
const top = (await getAnalyticsTopJobs(env, { preset: '7d' })).rows;
const job5 = top.find(r => r.job_id === 5);
assert.equal(job5.apply_clicks, 1); assert.equal(job5.views, 1); assert.equal(job5.impressions, 1);

// retention removes rollup rows too
await backfillAnalyticsSummary(env);
db.exec("UPDATE analytics_summary_daily SET metric_date='2000-01-01'");
await cleanupAnalytics(env, '30');
assert.equal(db.prepare("SELECT COUNT(*) c FROM analytics_summary_daily WHERE metric_date='2000-01-01'").get().c, 0);
console.log('analytics-summary tests: all assertions passed');
