// src/pages/admin/system.js
// System — cron status/manual triggers, cache purge, database row counts,
// and the full sync + cleanup history (the dashboard only teases the last
// few of each). Read-only except the two explicit action buttons, which
// reuse the exact same handlers as before (/api/sync, /admin/cleanup) —
// no new mutation logic, just a fuller view of what's already there.

import { getSiteStats, readSiteCache } from '../../lib/platform/site-cache.js';
import { cappedCount } from '../../lib/platform/job-window.js';
import { ensureTable } from '../../db/schema.js';
import { JOB_STATUS_ORDER, JOB_STATUS_META } from '../../config/constants.js';
import { getSettings } from '../../lib/platform/settings.js';
import { isAiConfigured } from '../../lib/ai/ai-service.js';
import { getAnalyticsHealth } from '../../lib/analytics/events.js';
import { paymentProviderStatus } from '../../lib/monetization/core.js';
import { escapeHtml } from '../../lib/directory/entities.js';

import { iconAlertTriangle, iconDatabase, iconMail, iconRefreshCw, iconServer, iconTrash2 } from '../../assets/icons.js';
// Tables considered safe/useful to show a row count for. Deliberately an
// explicit allow-list (not "every table in sqlite_master") so a future
// internal table never gets exposed here by accident.
const COUNTED_TABLES = [
  'jobs', 'subscribers', 'job_postings', 'api_sources', 'categories',
  'pages', 'blog_posts', 'nav_buttons', 'visits', 'admin_activity_log',
  'rate_limits', 'hidden_companies', 'directory_overrides',
  // Stage 7 addition — plan §28 explicitly asks for company/user/
  // applications/saved-jobs counts, which simply weren't in this
  // allow-list yet (every one of these tables already existed since
  // Stages 1/3/5 — this is purely making them visible here, not a new
  // table or query pattern).
  'companies', 'users', 'saved_jobs', 'applications', 'company_members',
  'analytics_event_queue', 'analytics_daily', 'analytics_daily_uniques',
  'analytics_search_daily', 'analytics_filter_daily', 'analytics_alerts',
  'job_tombstones', 'monetization_orders', 'monetization_transactions',
  'monetization_refunds',
];

export async function renderSystemContent(env) {
  await ensureTable(env);
  const q = (sql, ...params) => env.DB.prepare(sql).bind(...params).all();

  const [{ results: syncLogs }, { results: cleanupLogs }] = await Promise.all([
    q("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 15").catch(() => ({ results: [] })),
    q("SELECT * FROM cleanup_logs ORDER BY id DESC LIMIT 10").catch(() => ({ results: [] })),
  ]);

  // error_logs is written by index.js's top-level safety net on every
  // unhandled exception anywhere on the site — this is the single most
  // direct way to get a confirmed root cause for "the site broke" reports
  // without needing wrangler/terminal access or the ?jf_debug= URL trick.
  let errorLogs = [];
  try {
    ({ results: errorLogs } = await q("SELECT * FROM error_logs ORDER BY id DESC LIMIT 20"));
  } catch (e) { /* table not created yet on a brand-new install */ }

  // PERFORMANCE/RELIABILITY: this used to fire ~40 separate COUNT(*) queries in
  // parallel — on the free plan that alone exceeds the 50-call ceiling and
  // crashed the very page that hosts "Repair schema". Two queries now: one to
  // learn which tables exist, one UNION ALL over those.
  const siteStats = await getSiteStats(env);
  const tableCounts = {};
  try {
    const { results: existing } = await q("SELECT name FROM sqlite_master WHERE type='table'");
    const have = new Set((existing || []).map(r => r.name));
    // `jobs` comes from the precomputed stats row (0 D1 rows) instead of a live
    // COUNT(*) — by far the largest table, and this page hosts "Repair schema" /
    // "Refresh stats" themselves, so it must stay cheap even when those are needed.
    const present = COUNTED_TABLES.filter(t => t !== 'jobs' && have.has(t));
    for (const t of COUNTED_TABLES) tableCounts[t] = null; // missing table → em-dash
    if (have.has('jobs')) tableCounts.jobs = siteStats ? Number(siteStats.totalAll || 0) : await cappedCount(env, 'jobs', '', [], 20000);
    if (present.length) {
      const { results } = await q(present.map(t => `SELECT '${t}' AS t, COUNT(*) AS c FROM ${t}`).join(' UNION ALL '));
      for (const r of results || []) tableCounts[r.t] = r.c;
    }
  } catch (e) { for (const t of COUNTED_TABLES) tableCounts[t] = null; }

  // Jobs by lifecycle status — the first thing to look at when "my jobs disappeared".
  // ROW-READ BUDGET: precomputed status breakdown (0 D1 rows) instead of a live GROUP BY over every job.
  let statusBreakdown = (await readSiteCache(env, 'admin:status')) || [];
  if (!statusBreakdown.length) {
    try { ({ results: statusBreakdown } = await q("SELECT COALESCE(NULLIF(status,''),'(empty)') AS s, COUNT(*) AS c FROM jobs GROUP BY s ORDER BY c DESC")); } catch (e) { /* jobs.status not migrated yet */ }
  }
  const hiddenJobs = statusBreakdown.filter(r => ['expired', 'archived', '(empty)'].includes(r.s)).reduce((n, r) => n + Number(r.c || 0), 0);

  // ROW-READ BUDGET: precomputed per-tier counts (0 D1 rows) instead of a live
  // SUM(CASE...) aggregate over every job.
  let tierRows = await readSiteCache(env, 'admin:tiers');
  if (!tierRows) {
    const { results } = await q(
      `SELECT COALESCE(salary_tier,'UNKNOWN') AS tier, COUNT(*) AS c FROM jobs GROUP BY COALESCE(salary_tier,'UNKNOWN')`
    );
    tierRows = results || [];
  }
  const tierCount = (tier) => Number((tierRows || []).find(r => r.tier === tier)?.c || 0);
  const salaryTierStats = {
    pending: tierCount('UNKNOWN'),
    high: tierCount('HIGH'),
    good: tierCount('GOOD'),
    standard: tierCount('STANDARD'),
    unknown: tierCount('UNKNOWN'),
  };
  const salaryRemaining = Number(salaryTierStats.pending || 0);
  const emailConfigured = Boolean(env.BREVO_API_KEY && env.EMAIL_FROM_ADDRESS);
  const storageConfigured = Boolean(env.COMPANY_ASSETS);
  const settings = await getSettings(env);
  const aiEnabled = settings.ai_enabled !== '0';
  const aiConfigured = isAiConfigured(env);
  const [analyticsHealth] = await Promise.all([getAnalyticsHealth(env)]);
  const paymentStatus = paymentProviderStatus(env);
  const analyticsState = analyticsHealth.error ? 'critical' : Number(analyticsHealth.queued || 0) > 1000 ? 'warning' : 'healthy';
  const analyticsLabel = analyticsHealth.error ? 'Unavailable' : `${Number(analyticsHealth.queued || 0).toLocaleString()} queued`;
  const paymentLabel = paymentStatus.webhookConfigured && paymentStatus.provider !== 'unconfigured' ? `${paymentStatus.provider} webhook ready; checkout adapter pending` : 'Provider not configured';
  const explicitDevelopment = ['development', 'dev'].includes(String(env.ENVIRONMENT || env.NODE_ENV || env.CF_ENV || '').toLowerCase()) || String(env.JOBFORION_DEV || '') === '1';
  const csrfReady = Boolean(String(env.CSRF_SECRET || '').trim()) || explicitDevelopment;

  // ── Data Integrity report (plan §29) — read-only diagnostics only.
  // Nothing here is auto-fixed or deleted; an admin decides what (if
  // anything) to do about a nonzero count. All four are cheap: the first
  // two use idx_saved_jobs_job/idx_applications_job (already existed),
  // the status breakdown uses idx_jobs_status, and NOT EXISTS avoids
  // pulling any actual row data into memory just to count it.
  const [{ results: orphanSavedRows }, { results: orphanAppRows }] = await Promise.all([
    // Possible since Job Management's (Stage 5) 3-phase lifecycle can
    // eventually hard-delete a job ~89 days after it goes stale — a
    // saved_jobs row surviving that isn't a bug, it's expected, but an
    // admin should be able to SEE the count exists.
    // .catch: a table that is not migrated yet must not crash the page that hosts "Repair schema"
    q("SELECT COUNT(*) c FROM saved_jobs sj WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = sj.job_id)").catch(() => ({ results: [] })),
    q("SELECT COUNT(*) c FROM applications a WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = a.job_id)").catch(() => ({ results: [] })),
  ]);
  const orphanSaved = orphanSavedRows?.[0]?.c || 0;
  const orphanApps = orphanAppRows?.[0]?.c || 0;
  // ROW-READ BUDGET: reuse the status breakdown already read above (0 extra D1
  // rows) instead of a second, separate live GROUP BY over every job. Raw NULL/
  // empty status ('(empty)') folds into 'active' to match the original query's
  // `status || 'active'` behavior.
  const jobStatusMap = Object.fromEntries(statusBreakdown.map(r => [r.s, Number(r.c || 0)]));
  if (jobStatusMap['(empty)']) { jobStatusMap.active = (jobStatusMap.active || 0) + jobStatusMap['(empty)']; delete jobStatusMap['(empty)']; }

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">${iconServer({ size: 22 })} System</div>
        <div class="adm-sub">Cron jobs, cache, database size, and full sync/cleanup history</div>
      </div>
      <a href="/admin" class="adm-btn">Dashboard</a>
    </div>

    <div class="adm-grid" style="margin-bottom:16px">
      <div class="adm-card">
        <div class="adm-card-title">Cron Jobs <span style="font-weight:400;color:var(--ink3);font-size:12px">— configured in wrangler.toml</span></div>
        <div class="adm-row"><span class="adm-row-label">Job Sync</span><span class="adm-row-val">00 · 06 · 12 · 18 UTC</span></div>
        <div class="adm-row"><span class="adm-row-label">Cleanup (stale jobs)</span><span class="adm-row-val">Daily · 03:00 UTC (blocked if sync unhealthy)</span></div>
        <div class="adm-row"><span class="adm-row-label">Job Alerts Dispatch</span><span class="adm-row-val">Daily · 08:00 UTC</span></div>
        <div class="adm-row"><span class="adm-row-label">Analytics aggregation</span><span class="adm-row-val">Every hour · :30</span></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <form method="POST" action="/api/sync" onsubmit="return confirm('Run job sync now?')"><button class="adm-btn adm-btn-primary" type="submit">↻ Sync Now</button></form>
          <form method="POST" action="/admin/cleanup" onsubmit="return confirm('Run cleanup now? It advances expired jobs through the retention lifecycle; only archived jobs past retention are permanently deleted.')"><button class="adm-btn" type="submit" style="color:var(--coral);border-color:var(--coral)">${iconTrash2({ size: 15 })} Cleanup Now</button></form>
          <form method="POST" action="/admin/system/refresh-stats"><button class="adm-btn" type="submit">${iconRefreshCw({ size: 15 })} Refresh stats</button></form>
          <form method="POST" action="/admin/system/repair-schema"><button class="adm-btn" type="submit">${iconDatabase({ size: 15 })} Repair schema</button></form>
          <form method="POST" action="/admin/system/run-job-alerts" onsubmit="return confirm('Send job alert digests now to every due alert?')"><button class="adm-btn" type="submit">${iconMail({ size: 15 })} Send Job Alerts Now</button></form>
          <form method="POST" action="/admin/system/ai-smoke-test" onsubmit="return confirm('Run the protected AI foundation smoke test?')"><button class="adm-btn" type="submit" ${!aiEnabled ? 'disabled' : ''}>AI Smoke Test</button></form>
        </div>
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Jobs by status <span style="font-weight:400;color:var(--ink3);font-size:12px">— only "active" jobs are public</span></div>
        ${statusBreakdown.length ? statusBreakdown.map(r => `<div class="adm-row"><span class="adm-row-label">${escapeHtml(r.s)}</span><span class="adm-row-val">${Number(r.c).toLocaleString()}</span></div>`).join('') : '<div class="adm-empty">No jobs table data yet</div>'}
        ${hiddenJobs > 0 ? `<form method="POST" action="/admin/system/reactivate-jobs" style="margin-top:12px" onsubmit="return confirm('Make ${hiddenJobs.toLocaleString()} expired/archived jobs public again and give them a fresh 45-day lease?')"><button class="adm-btn adm-btn-primary" type="submit">Reactivate ${hiddenJobs.toLocaleString()} hidden jobs</button></form><div style="font-size:10.5px;color:var(--ink3);margin-top:8px">Jobs that are really gone from their source will expire again 30 days after the next sync stops returning them.</div>` : ''}
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Cache</div>
        <div style="font-size:12px;color:var(--ink2);margin-bottom:12px;line-height:1.7">Directory pages (Companies, Categories, Skills, Countries) and the sitemap are cached at Cloudflare's edge. Purge if a change isn't showing up yet.</div>
        <form method="POST" action="/admin/cache/purge" onsubmit="return confirm('Purge cached directory pages and sitemap?')">
          <button class="adm-btn" type="submit">${iconTrash2({ size: 15 })} Purge Cache</button>
        </form>
        <div style="font-size:10.5px;color:var(--ink3);margin-top:8px">Best-effort: clears the known set of cached URLs. Query-string variants (e.g. filtered/paginated views) expire naturally within their normal TTL.</div>
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Service Status</div>
        <div class="health-row"><span class="adm-row-label"><span class="health-dot ${emailConfigured ? 'health-ok' : 'health-warn'}"></span>Transactional email</span><span class="adm-row-val">${emailConfigured ? 'Brevo ready' : 'Not configured'}</span></div>
        <div class="health-row"><span class="adm-row-label"><span class="health-dot ${storageConfigured ? 'health-ok' : 'health-warn'}"></span>Company asset storage</span><span class="adm-row-val">${storageConfigured ? 'R2 connected' : 'URL fallback'}</span></div>
        <div class="health-row"><span class="adm-row-label"><span class="health-dot ${aiEnabled && aiConfigured ? 'health-ok' : 'health-warn'}"></span>AI foundation</span><span class="adm-row-val">${!aiEnabled ? 'Disabled' : aiConfigured ? 'Binding ready' : 'Not configured'}</span></div>
        <div class="health-row"><span class="adm-row-label"><span class="health-dot ${analyticsState === 'healthy' ? 'health-ok' : analyticsState === 'warning' ? 'health-warn' : 'health-err'}"></span>Analytics</span><span class="adm-row-val">${analyticsLabel}</span></div>
        <div class="health-row"><span class="adm-row-label"><span class="health-dot health-warn"></span>Payments</span><span class="adm-row-val">${paymentLabel}</span></div>
        <div class="health-row"><span class="adm-row-label"><span class="health-dot health-ok"></span>SEO routes</span><span class="adm-row-val">Sitemap and robots configured</span></div>
        <div class="health-row"><span class="adm-row-label"><span class="health-dot health-ok"></span>Cron schedule</span><span class="adm-row-val">Configured with overlap leases</span></div>
        <div class="health-row"><span class="adm-row-label"><span class="health-dot ${csrfReady ? 'health-ok' : 'health-err'}"></span>CSRF secret</span><span class="adm-row-val">${csrfReady ? (env.CSRF_SECRET ? 'Configured' : 'Development fallback') : 'Missing — fail closed'}</span></div>
        <div style="font-size:10.5px;color:var(--ink3);margin-top:8px">Credentials and provider keys are intentionally never displayed here. Payment status reflects the configured boundary, not simulated checkout success.</div>
      </div>
      <div class="adm-card" style="grid-column:span 2">
        <div class="adm-card-title">Database — Row Counts</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
          ${COUNTED_TABLES.map(t => `<div style="background:var(--surface2);border-radius:10px;padding:10px 12px">
            <div style="font-size:10px;color:var(--ink3);text-transform:uppercase;font-weight:700;margin-bottom:4px">${t.replace(/_/g, ' ')}</div>
            <div style="font-size:16px;font-weight:800;color:var(--ink)">${tableCounts[t] === null ? '—' : tableCounts[t].toLocaleString()}</div>
          </div>`).join('')}
        </div>
      </div>
      <div class="adm-card" style="grid-column:span 2">
        <div class="adm-card-title">Jobs by Status <span style="font-weight:400;color:var(--ink3);font-size:12px">— see Job Management's lifecycle</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px">
          ${JOB_STATUS_ORDER.map(s => `<div style="background:var(--surface2);border-radius:10px;padding:10px 12px">
            <div style="font-size:10px;color:${JOB_STATUS_META[s].color};text-transform:uppercase;font-weight:700;margin-bottom:4px">${JOB_STATUS_META[s].label}</div>
            <div style="font-size:16px;font-weight:800;color:var(--ink)">${(jobStatusMap[s] || 0).toLocaleString()}</div>
          </div>`).join('')}
        </div>
      </div>
      <div class="adm-card" style="grid-column:span 2">
        <div class="adm-card-title">Data Integrity <span style="font-weight:400;color:var(--ink3);font-size:12px">— read-only diagnostic, nothing is auto-fixed</span></div>
        <div class="adm-row"><span class="adm-row-label">Saved Jobs pointing to a deleted job</span><span class="adm-row-val" style="color:${orphanSaved ? 'var(--coral)' : 'var(--green)'}">${orphanSaved.toLocaleString()}</span></div>
        <div class="adm-row"><span class="adm-row-label">Applications pointing to a deleted job</span><span class="adm-row-val" style="color:${orphanApps ? 'var(--coral)' : 'var(--green)'}">${orphanApps.toLocaleString()}</span></div>
        <div style="font-size:10.5px;color:var(--ink3);margin-top:8px">${(orphanSaved + orphanApps) ? 'A nonzero count here is expected over time — jobs are only ever hard-deleted after passing through Expired to Archived (see Job Management), roughly 89 days of inactivity. It means a user saved/applied to a job that has since been permanently removed.' : 'No orphaned references found.'}</div>
      </div>
      <div class="adm-card" style="grid-column:span 2">
        <div class="adm-card-title">Salary Tier Backfill <span style="font-weight:400;color:var(--ink3);font-size:12px">— classifies normalized annual USD into HIGH, GOOD, STANDARD, or UNKNOWN</span></div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="font-size:12.5px;color:var(--ink2)">
            ${salaryRemaining > 0
              ? `<b style="color:var(--ink)">${salaryRemaining.toLocaleString()}</b> row${salaryRemaining === 1 ? '' : 's'} still need classification`
              : `<span style="color:var(--green);font-weight:700">✓ All job rows have a persisted salary tier</span>`}
          </div>
          <form method="POST" action="/admin/system/backfill-salary">
            <button class="adm-btn adm-btn-primary" type="submit" ${salaryRemaining === 0 ? 'disabled' : ''}>Run Batch (300 rows)</button>
          </form>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;font-size:10.5px;font-weight:700">
          <span class="salary-tier-badge salary-tier-high">HIGH ${Number(salaryTierStats.high || 0).toLocaleString()}</span>
          <span class="salary-tier-badge salary-tier-good">GOOD ${Number(salaryTierStats.good || 0).toLocaleString()}</span>
          <span class="salary-tier-badge salary-tier-standard">STANDARD ${Number(salaryTierStats.standard || 0).toLocaleString()}</span>
          <span class="salary-tier-badge salary-tier-standard">UNKNOWN ${Number(salaryTierStats.unknown || 0).toLocaleString()}</span>
        </div>
        ${salaryRemaining > 300 ? `<div style="font-size:10.5px;color:var(--ink3);margin-top:8px">Processes up to 300 rows per request; return to this page and run again to continue. Rows are not deleted or rewritten outside the salary fields.</div>` : ''}
      </div>
    </div>

    <div class="adm-grid">
      <div class="adm-card">
        <div class="adm-card-title">Sync History <span style="font-weight:400;color:var(--ink3);font-size:12px">— last 15 runs</span></div>
        ${(syncLogs || []).length ? syncLogs.map(s => {
          let errs = []; try { errs = JSON.parse(s.errors || '[]'); } catch (e) {}
          return `<div class="adm-row" style="align-items:flex-start;flex-direction:column;gap:4px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <span class="adm-row-label" style="font-size:11px">${s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</span>
              <span class="adm-row-val" style="color:var(--green)">+${s.inserted} <span style="color:var(--ink3);font-weight:500">/ ${s.skipped} skip</span></span>
            </div>
            ${errs.length ? `<div style="font-size:10px;color:var(--coral)">${iconAlertTriangle({ size: 15 })} ${errs.length} error${errs.length === 1 ? '' : 's'}</div>` : ''}
          </div>`;
        }).join('') : '<div class="adm-empty">No sync runs yet</div>'}
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Cleanup History <span style="font-weight:400;color:var(--ink3);font-size:12px">— last 10 runs</span></div>
        ${(cleanupLogs || []).length ? cleanupLogs.map(c => `<div class="adm-row">
          <span class="adm-row-label" style="font-size:11px">${c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</span>
          <span class="adm-row-val" style="color:var(--coral)">−${c.deleted || 0}</span>
        </div>`).join('') : '<div class="adm-empty">No cleanup runs yet</div>'}
      </div>
    </div>
    <div class="adm-card" style="margin-top:16px">
      <div class="adm-card-title">${iconAlertTriangle({ size: 16 })} Recent Errors <span style="font-weight:400;color:var(--ink3);font-size:12px">— last 20 uncaught exceptions, any page on the site</span></div>
      ${(errorLogs || []).length ? errorLogs.map(err => `<div class="adm-row" style="align-items:flex-start;flex-direction:column;gap:4px">
        <div style="display:flex;justify-content:space-between;width:100%;gap:10px">
          <span class="adm-row-label" style="font-size:11px;font-family:monospace">${escapeHtml(err.path || '—')}</span>
          <span class="adm-row-val" style="font-size:11px;color:var(--ink3);font-weight:500">${err.created_at ? new Date(err.created_at).toLocaleString() : '—'}</span>
        </div>
        <div style="font-size:12px;color:var(--coral);font-weight:700">${escapeHtml(err.message || '—')}</div>
        ${err.stack ? `<details style="width:100%"><summary style="font-size:10.5px;color:var(--ink3);cursor:pointer">Stack trace</summary><pre style="font-size:10px;color:var(--ink3);background:var(--surface2);padding:8px;border-radius:8px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin-top:6px">${escapeHtml(err.stack)}</pre></details>` : ''}
      </div>`).join('') : '<div class="adm-empty">No errors logged — the site has been running clean.</div>'}
    </div>
  </div>`;
}
