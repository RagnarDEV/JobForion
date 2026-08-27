// src/pages/admin/dashboard.js
// Dashboard page content: KPI cards, System Health, traffic chart,
// category breakdown, sync history, API sources, pending postings.
// Returns inner HTML only — adminShell() in shell.js wraps it.

import { getCategories } from '../../lib/categories.js';
import { ensureTable } from '../../db/schema.js';
import { escapeHtml } from '../../lib/entities.js';
import { PROVIDERS } from '../../providers/index.js';
import { JOB_STATUS_META, JOB_STATUS_ORDER, REJECTION_REASONS } from '../../config/constants.js';
import { getRecentActivity, ACTION_LABELS } from '../../lib/activity-log.js';
import { getSettings } from '../../lib/settings.js';
import { hotPayThresholdUsd } from '../../lib/hot-pay.js';

function barChart(rows) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return rows.map(r => `
    <div class="dashboard-bar-row">
      <span class="dashboard-bar-label">${escapeHtml(r.label)}</span>
      <div class="dashboard-bar-track"><i style="width:${Math.round((r.count / max) * 100)}%"></i></div>
      <span class="dashboard-bar-value">${r.count}</span>
    </div>`).join('');
}

const kpi = (label, val, sub, color = 'var(--brand)') => `
  <div class="adm-card adm-kpi dashboard-kpi" style="border-top:3px solid ${color}">
    <div class="adm-kpi-label" style="font-size:10px;font-weight:800;color:var(--ink3);letter-spacing:.8px;text-transform:uppercase;margin-bottom:8px">${label}</div>
    <div class="adm-kpi-value" style="font-family:'Plus Jakarta Sans',sans-serif;font-size:27px;font-weight:800;color:${color}">${val}</div>
    ${sub ? `<div class="adm-kpi-sub" style="font-size:11px;color:var(--ink3);margin-top:5px">${sub}</div>` : ''}
  </div>`;

const pulse = (label, value, detail, color = 'var(--brand)') => `<div class="dashboard-pulse"><span class="dashboard-pulse-dot" style="background:${color}"></span><div><strong>${value}</strong><span>${label}</span></div><small>${detail}</small></div>`;

const DASHBOARD_CSS = `<style>
.dashboard-page{--dash-card-radius:16px;padding-bottom:46px}
.dashboard-page .adm-hdr{margin-bottom:18px;align-items:flex-start;flex-wrap:wrap}
.dashboard-page .dashboard-header-meta{display:flex;align-items:center;flex-basis:100%;order:3;gap:8px;margin-top:10px;flex-wrap:wrap;color:var(--ink3);font-size:10.5px}
.dashboard-page .dashboard-header-meta span{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--border);border-radius:999px;background:var(--surface)}
.dashboard-page .dashboard-header-meta .live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(15,174,121,.12)}
.dashboard-page .dashboard-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dashboard-page .dashboard-section-card{border-radius:var(--dash-card-radius)}
.dashboard-page .dashboard-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:13px}
.dashboard-page .dashboard-kpi{min-height:122px;padding:17px;border-radius:var(--dash-card-radius)}
.dashboard-page .dashboard-pulse-strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;margin-bottom:18px;padding:6px;background:var(--border);border:1px solid var(--border);border-radius:14px;overflow:hidden}
.dashboard-page .dashboard-pulse{display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:center;min-width:0;padding:10px 11px;background:var(--surface)}
.dashboard-page .dashboard-pulse-dot{grid-row:1 / span 2;width:7px;height:7px;border-radius:50%;box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 12%,transparent)}
.dashboard-page .dashboard-pulse strong{display:block;color:var(--ink);font:800 14px 'Plus Jakarta Sans',sans-serif;line-height:1.1}
.dashboard-page .dashboard-pulse span{display:block;overflow:hidden;color:var(--ink3);font-size:9.5px;text-overflow:ellipsis;white-space:nowrap}
.dashboard-page .dashboard-pulse small{grid-column:2;display:block;margin-top:3px;overflow:hidden;color:var(--ink3);font-size:9px;text-overflow:ellipsis;white-space:nowrap}
.dashboard-page .dashboard-overview-grid{align-items:stretch}
.dashboard-page .dashboard-overview-grid>.adm-card{min-width:0}
.dashboard-page .dashboard-card-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}
.dashboard-page .dashboard-card-heading .adm-card-title{margin:0}
.dashboard-page .dashboard-card-note{color:var(--ink3);font-size:10px;line-height:1.45;text-align:right}
.dashboard-page .dashboard-bar-row{display:grid;grid-template-columns:minmax(70px,92px) minmax(0,1fr) 40px;align-items:center;gap:9px;margin-bottom:9px;min-width:0}
.dashboard-page .dashboard-bar-label{overflow:hidden;color:var(--ink3);font-size:10.5px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
.dashboard-page .dashboard-bar-track{height:9px;overflow:hidden;border-radius:999px;background:var(--surface2)}
.dashboard-page .dashboard-bar-track i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--brand),var(--brand2))}
.dashboard-page .dashboard-bar-value{text-align:right;color:var(--ink);font-size:11px;font-weight:800}
.dashboard-page .dashboard-traffic-chart{display:flex;align-items:flex-end;gap:5px;height:145px;padding:11px 2px 0;border-bottom:1px solid var(--border)}
.dashboard-page .dashboard-traffic-bar{position:relative;display:flex;flex:1;align-items:flex-end;justify-content:center;height:100%;min-width:0}
.dashboard-page .dashboard-traffic-bar>i{display:block;width:100%;min-height:4px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--brand),var(--brand2));opacity:.88;transition:height .2s ease,opacity .2s ease}
.dashboard-page .dashboard-traffic-bar:hover>i{opacity:1}
.dashboard-page .dashboard-traffic-bar>span{position:absolute;bottom:-20px;overflow:hidden;max-width:100%;color:var(--ink3);font-size:8px;text-overflow:ellipsis;white-space:nowrap}
.dashboard-page .dashboard-compact-card{overflow:hidden}
.dashboard-page .dashboard-compact-list{max-height:292px;overflow-y:auto;padding-right:3px;scrollbar-width:thin}
.dashboard-page .dashboard-compact-list .adm-row{padding:7px 0}
.dashboard-page .dashboard-sync-row{padding:8px 0;border-bottom:1px solid var(--border)}
.dashboard-page .dashboard-sync-row:last-child{border-bottom:0}
.dashboard-page .dashboard-sync-main{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--ink3);font-size:9.5px}
.dashboard-page .dashboard-sync-main strong{color:var(--green);font-size:10.5px}
.dashboard-page .dashboard-sync-details{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;color:var(--ink3);font-size:9px}
.dashboard-page .dashboard-sync-errors{margin-top:5px;padding:5px 7px;border-radius:6px;background:rgba(231,76,60,.07);color:var(--coral);font-size:9px;line-height:1.45}
.dashboard-page .dashboard-lower-grid{align-items:start}
.dashboard-page .dashboard-lower-grid>.adm-card{min-width:0}
.dashboard-page .dashboard-list-link{padding:8px 0}
.dashboard-page .dashboard-list-link b{font-size:11px}
.dashboard-page .dashboard-list-link small{font-size:9px;margin-top:2px}
.dashboard-page .dashboard-list-link em{font-size:9px}
.dashboard-page .dashboard-pending-card{border-color:rgba(255,92,122,.24);background:linear-gradient(180deg,var(--surface),rgba(255,247,249,.72))}
@media(max-width:1100px){.dashboard-page .dashboard-pulse-strip{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:900px){.dashboard-page .dashboard-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-page .dashboard-pulse-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:768px){.dashboard-page{padding-bottom:28px}.dashboard-page .dashboard-kpi-grid{gap:10px}.dashboard-page .dashboard-kpi{min-height:108px;padding:14px}.dashboard-page .dashboard-pulse-strip{grid-template-columns:1fr 1fr;margin-bottom:14px}.dashboard-page .dashboard-card-heading{align-items:flex-start}.dashboard-page .dashboard-card-note{max-width:45%}.dashboard-page .dashboard-traffic-chart{height:130px}}
@media(max-width:640px){.dashboard-page .dashboard-kpi-grid{grid-template-columns:1fr;gap:11px}.dashboard-page .dashboard-kpi{min-height:0;padding:17px 16px}.dashboard-page .dashboard-kpi-label{font-size:11px!important}.dashboard-page .dashboard-kpi-value{font-size:30px!important;line-height:1.1}.dashboard-page .dashboard-kpi-sub{font-size:12px!important}.dashboard-page .dashboard-pulse-strip{grid-template-columns:1fr;margin-bottom:16px}.dashboard-page .dashboard-pulse{padding:12px 13px}.dashboard-page .dashboard-pulse strong{font-size:15px}.dashboard-page .dashboard-pulse span,.dashboard-page .dashboard-pulse small{font-size:10.5px}.dashboard-page .dashboard-compact-list{max-height:360px}.dashboard-page .dashboard-traffic-chart{height:150px;gap:4px}.dashboard-page .dashboard-traffic-bar>span{font-size:9px}.dashboard-page .dashboard-card-note{font-size:10.5px;max-width:52%}.dashboard-page .adm-quick-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dashboard-page .adm-quick-card{min-height:52px;padding:12px}.dashboard-page .dashboard-actions{width:100%}.dashboard-page .dashboard-actions .adm-btn{min-height:42px}}
@media(max-width:480px){.dashboard-page .dashboard-kpi-grid{grid-template-columns:1fr}.dashboard-page .dashboard-kpi-value{font-size:28px!important}.dashboard-page .dashboard-kpi-sub{font-size:11px!important}.dashboard-page .dashboard-pulse{padding:11px 12px}.dashboard-page .dashboard-pulse strong{font-size:14px}.dashboard-page .dashboard-pulse span,.dashboard-page .dashboard-pulse small{font-size:10px}.dashboard-page .dashboard-actions{width:100%}.dashboard-page .dashboard-actions .adm-btn{flex:1;min-width:0;padding-left:8px;padding-right:8px;font-size:11px}.dashboard-page .dashboard-header-meta{font-size:10px}.dashboard-page .dashboard-bar-row{grid-template-columns:minmax(72px,88px) minmax(0,1fr) 36px;gap:7px}.dashboard-page .dashboard-bar-label{font-size:10px}.dashboard-page .dashboard-bar-value{font-size:11px}}
@media(max-width:380px){.dashboard-page .adm-quick-grid{grid-template-columns:1fr}.dashboard-page .dashboard-card-heading{gap:6px}.dashboard-page .dashboard-card-note{max-width:48%;font-size:9.5px}}
@media(max-width:640px){.dashboard-page{width:100%;max-width:none;min-width:0}.dashboard-page .dashboard-kpi-grid,.dashboard-page .dashboard-pulse-strip,.dashboard-page .dashboard-overview-grid,.dashboard-page .dashboard-lower-grid{width:100%;max-width:none;min-width:0}.dashboard-page .dashboard-kpi,.dashboard-page .dashboard-pulse,.dashboard-page .dashboard-overview-grid>.adm-card,.dashboard-page .dashboard-lower-grid>.adm-card{width:100%;min-width:0}}
  </style>`;

function healthRow(label, status, detail) {
  const dot = { ok: 'health-ok', warn: 'health-warn', off: 'health-off', err: 'health-err' }[status] || 'health-off';
  const text = { ok: 'Operational', warn: 'Degraded', off: 'Not configured', err: 'Error' }[status] || status;
  return `<div class="health-row">
    <span class="adm-row-label"><span class="health-dot ${dot}"></span>${escapeHtml(label)}</span>
    <span class="adm-row-val" style="font-weight:600">${text}${detail ? ` <span style="color:var(--ink3);font-weight:500">· ${escapeHtml(detail)}</span>` : ''}</span>
  </div>`;
}

// Skills are stored as a JSON array string per job, not a normalized table
// — count distinct values from a bounded sample instead of scanning the
// whole table on every dashboard load. Good enough for a KPI card, not
// meant to be a billing-grade exact count.
async function estimateDistinctSkills(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT skills FROM jobs WHERE skills IS NOT NULL AND skills != '[]' ORDER BY id DESC LIMIT 5000"
    ).all();
    const set = new Set();
    for (const row of results || []) {
      try {
        const arr = JSON.parse(row.skills || '[]');
        if (Array.isArray(arr)) arr.forEach(s => { if (s) set.add(String(s).trim().toLowerCase()); });
      } catch (e) {}
    }
    return set.size;
  } catch (e) { return 0; }
}

export async function renderDashboardContent(env) {
  await ensureTable(env);
  const q = (sql, ...params) => env.DB.prepare(sql).bind(...params).all();
  const settings = await getSettings(env);
  const hotPayEnabled = settings.hot_pay_enabled !== '0';
  const hotPayThreshold = hotPayThresholdUsd(settings);
  // Mirror lib/hot-pay.js for persisted normalized salary columns: a genuine
  // range uses its midpoint, while min-only/max-only rows use the disclosed
  // side. Negative/sentinel values never qualify.
  const hotPaySql = `(salary_min_usd IS NOT NULL AND salary_max_usd IS NULL AND salary_min_usd >= ?)
    OR (salary_min_usd IS NULL AND salary_max_usd IS NOT NULL AND salary_max_usd >= ?)
    OR (salary_min_usd IS NOT NULL AND salary_max_usd IS NOT NULL AND salary_min_usd >= 0 AND salary_max_usd >= 0 AND ((salary_min_usd + salary_max_usd) / 2.0) >= ?)`;

  const [{ results: totalJobsR }, { results: jobsTodayR }, { results: jobsWeekR }, { results: jobsMonthR }, { results: subsR }, { results: companiesR }, { results: hotR }, { results: usersR }, { results: articlesR }, { results: recentJobsR }, { results: recentUsersR }, { results: recentCompaniesR }, { results: aiActivityR }] = await Promise.all([
    q("SELECT COUNT(*) c FROM jobs"),
    q("SELECT COUNT(*) c FROM jobs WHERE created_at >= datetime('now','-1 day')"),
    q("SELECT COUNT(*) c FROM jobs WHERE created_at >= datetime('now','-7 day')"),
    q("SELECT COUNT(*) c FROM jobs WHERE created_at >= datetime('now','-30 day')"),
    q("SELECT COUNT(*) c FROM subscribers"),
    q("SELECT COUNT(DISTINCT LOWER(company)) c FROM jobs WHERE company IS NOT NULL AND company != ''"),
    hotPayEnabled ? q(`SELECT COUNT(*) c FROM jobs WHERE ${hotPaySql}`, hotPayThreshold, hotPayThreshold, hotPayThreshold) : q("SELECT 0 c"),
    q("SELECT COUNT(*) c FROM users"),
    q("SELECT COUNT(*) c FROM blog_posts WHERE status = 'published'"),
    q("SELECT id, title, company, location, created_at, status FROM jobs ORDER BY id DESC LIMIT 6"),
    q("SELECT id, email, status, email_verified, created_at FROM users ORDER BY id DESC LIMIT 6"),
    q("SELECT company, COUNT(*) c, MAX(created_at) created_at FROM jobs WHERE company IS NOT NULL AND company != '' GROUP BY LOWER(company), company ORDER BY created_at DESC LIMIT 6"),
    q("SELECT action, meta AS metadata FROM admin_activity_log WHERE created_at >= datetime('now','-7 day') AND (action LIKE 'ai_%' OR action LIKE 'admin_%intelligence' OR action = 'admin_career_assistant' OR action = 'user_job_matching' OR action = 'user_career_assistant') ORDER BY id DESC LIMIT 1000"),
  ]);

  const [{ results: totalVisitsR }, { results: visitsTodayR }, { results: visits7dR }, { results: uniqCountriesR }] = await Promise.all([
    q("SELECT COUNT(*) c FROM visits"),
    q("SELECT COUNT(*) c FROM visits WHERE created_at >= datetime('now','-1 day')"),
    q("SELECT COUNT(*) c FROM visits WHERE created_at >= datetime('now','-7 day')"),
    q("SELECT COUNT(DISTINCT country) c FROM visits WHERE created_at >= datetime('now','-7 day')"),
  ]);

  const aiActivityCount = (aiActivityR || []).length;
  const aiFailureCount = (aiActivityR || []).filter(row => /failed|error/i.test(String(row.metadata || ''))).length;
  const aiFeatureCounts = Object.entries((aiActivityR || []).reduce((map, row) => { const key = String(row.action || 'AI').replace(/^admin_|^user_/, ''); map[key] = (map[key] || 0) + 1; return map; }, {})).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  const { results: pendingR } = await q("SELECT COUNT(*) c FROM job_postings WHERE status='pending'");
  const skillsCount = await estimateDistinctSkills(env);

  // ── Job Lifecycle stats (schema.js: updated_at/expires_at/source/status) ──
  const [{ results: activeR }, { results: expiringSoonR }, { results: deletedTodayR }, { results: sourceBreakdownR }, { results: statusBreakdownR }, { results: sourceTypeR }] = await Promise.all([
    q("SELECT COUNT(*) c FROM jobs WHERE status = 'active'"),
    q("SELECT COUNT(*) c FROM jobs WHERE expires_at IS NOT NULL AND expires_at < datetime('now','+3 day')"),
    q("SELECT COALESCE(SUM(deleted),0) c FROM cleanup_logs WHERE created_at >= datetime('now','-1 day')"),
    q("SELECT COALESCE(source,'unknown') s, COUNT(*) c FROM jobs GROUP BY s ORDER BY c DESC LIMIT 12"),
    // Job Management (Stage 5) — status breakdown across the FULL new
    // lifecycle (active/paused/closed/expired/archived), one GROUP BY
    // instead of five separate COUNT(*) queries.
    q("SELECT COALESCE(status,'active') s, COUNT(*) c FROM jobs GROUP BY s"),
    // Provider-synced vs employer-submitted vs admin-created — plan §25's
    // "Provider Jobs" / "Company Jobs" split.
    q("SELECT COALESCE(source_type,'provider') s, COUNT(*) c FROM jobs GROUP BY s"),
  ]);
  const statusCounts = Object.fromEntries((statusBreakdownR || []).map(r => [r.s, r.c]));
  const sourceTypeCounts = Object.fromEntries((sourceTypeR || []).map(r => [r.s, r.c]));
  const { results: cleanupLogs } = await q("SELECT * FROM cleanup_logs ORDER BY id DESC LIMIT 6");
  const { results: lastCleanupR } = await q("SELECT created_at FROM cleanup_logs ORDER BY id DESC LIMIT 1");

  const { results: dailyVisits } = await q(
    "SELECT date(created_at) d, COUNT(*) c FROM visits WHERE created_at >= datetime('now','-14 day') GROUP BY d ORDER BY d ASC"
  );
  const dailyMap = Object.fromEntries((dailyVisits || []).map(r => [r.d, r.c]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    days.push({ label: d.slice(5), count: dailyMap[d] || 0 });
  }
  const maxDaily = Math.max(1, ...days.map(d => d.count));

  const { results: topPages } = await q(
    "SELECT path, COUNT(*) c FROM visits WHERE created_at >= datetime('now','-7 day') GROUP BY path ORDER BY c DESC LIMIT 8"
  );
  const { results: topCountries } = await q(
    "SELECT country, COUNT(*) c FROM visits WHERE created_at >= datetime('now','-7 day') GROUP BY country ORDER BY c DESC LIMIT 8"
  );

  const categories = await getCategories(env);
  const catCounts = await Promise.all(categories.map(async cat => {
    const { results } = await q("SELECT COUNT(*) c FROM jobs WHERE LOWER(title) LIKE ?", `%${cat.key}%`);
    return { label: cat.label, count: results[0]?.c || 0 };
  }));

  const { results: syncLogs } = await q("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 6");
  const { results: apiSources } = await q("SELECT * FROM api_sources ORDER BY id DESC");
  const { results: pendingPostings } = await q("SELECT * FROM job_postings WHERE status='pending' ORDER BY id DESC LIMIT 20");
  const recentActivity = await getRecentActivity(env, 8);
  const activeSourcesCount = (apiSources || []).filter(s => s.active).length;

  // ── System Health ──────────────────────────────────────────────
  // Worker: if this code is executing, the Worker itself is up — that's
  // the honest answer, no need to fake a health-check ping for it.
  const workerHealth = healthRow('Cloudflare Worker', 'ok', 'Responding');

  let d1Status = 'ok', d1Detail = '';
  const d1Start = Date.now();
  try {
    await env.DB.prepare('SELECT 1').first();
    d1Detail = `${Date.now() - d1Start}ms`;
  } catch (e) {
    d1Status = 'err'; d1Detail = String(e.message || e).slice(0, 60);
  }
  const d1Health = healthRow('D1 Database', d1Status, d1Detail);

  const latestSync = (syncLogs || [])[0];
  let latestDetails = [], latestErrors = [];
  if (latestSync) {
    try { latestDetails = JSON.parse(latestSync.details || '[]'); } catch (e) {}
    try { latestErrors = JSON.parse(latestSync.errors || '[]'); } catch (e) {}
  }
  const configuredProviderIds = new Set((apiSources || []).filter(s => s.active).map(s => s.provider));

  const providerHealthRows = Object.keys(PROVIDERS).map(id => {
    if (!configuredProviderIds.has(id)) return healthRow(id, 'off');
    const stat = latestDetails.find(d => d.provider === id);
    const hadError = latestErrors.some(e => String(e).includes(`[${id}]`));
    if (hadError) return healthRow(id, 'err', 'see Sync History');
    if (stat) return healthRow(id, 'ok', `+${stat.inserted} last run`);
    return healthRow(id, 'warn', 'no recent run');
  }).join('');

  const lastSyncSummary = latestSync
    ? `${new Date(latestSync.created_at).toLocaleString()} · +${latestSync.inserted} new · ${latestErrors.length} error${latestErrors.length === 1 ? '' : 's'}`
    : 'Never run yet';
  const lastCleanupSummary = lastCleanupR?.[0]
    ? new Date(lastCleanupR[0].created_at).toLocaleString()
    : 'Never run yet';

  const content = `
  ${DASHBOARD_CSS}
  <div class="adm-wrap dashboard-page">
    <div class="adm-hdr">
      <div>
        <div class="adm-section-kicker">CONTROL CENTER</div>
        <div class="adm-title">Platform overview</div>
        <div class="adm-sub">Live operational view of the JobForion platform</div>
      </div>
      <div class="dashboard-actions">
        <form method="POST" action="/api/sync" onsubmit="return confirm('Run job sync now?')" style="display:inline">
          <button class="adm-btn adm-btn-primary" type="submit">↻ Sync Jobs Now</button>
        </form>
        <form method="POST" action="/admin/cleanup" onsubmit="return confirm('Run cleanup now? It advances expired jobs through the retention lifecycle; only archived jobs past retention are permanently deleted.')" style="display:inline">
          <button class="adm-btn" type="submit" style="border-color:var(--coral);color:var(--coral)">🧹 Run Cleanup Now</button>
        </form>
        <a href="/admin/logout" class="adm-btn">Logout</a>
      </div>
      <div class="dashboard-header-meta">
        <span><i class="live-dot"></i> Live operational data</span>
        <span>Last sync: ${escapeHtml(lastSyncSummary)}</span>
        <span>Last cleanup: ${escapeHtml(lastCleanupSummary)}</span>
      </div>
    </div>

    <div class="adm-card dashboard-section-card" style="margin-bottom:16px">
      <div class="adm-section-kicker">OPERATIONS</div>
      <div class="adm-card-title" style="font-size:17px;margin-bottom:12px">Quick actions</div>
      <div class="adm-quick-grid">
        <a class="adm-quick-card" href="/admin/sources">🔌 <span>Manage sources</span></a>
        <a class="adm-quick-card" href="/admin/jobs">💼 <span>Manage jobs</span></a>
        <a class="adm-quick-card" href="/admin/companies">🏢 <span>Manage companies</span></a>
        <a class="adm-quick-card" href="/admin/homepage">🏠 <span>Homepage sections</span></a>
        <a class="adm-quick-card" href="/admin/ads">📢 <span>Manage ads</span></a>
        <a class="adm-quick-card" href="/admin/settings">⚙️ <span>Website settings</span></a>
        <a class="adm-quick-card" href="/admin/system">🖥️ <span>System health</span></a>
        <a class="adm-quick-card" href="/admin/security">🛡️ <span>Activity log</span></a>
      </div>
    </div>

    <div class="dashboard-kpi-grid">
      ${kpi('Total Jobs', (totalJobsR[0]?.c || 0).toLocaleString(), `+${jobsTodayR[0]?.c || 0} today · +${jobsWeekR[0]?.c || 0} this week`)}
      ${kpi('Active Jobs', (activeR[0]?.c || 0).toLocaleString(), 'Published, live now', 'var(--green)')}
      ${kpi('New This Month', (jobsMonthR[0]?.c || 0).toLocaleString(), 'Added in the last 30 days', 'var(--brand2)')}
      ${kpi('Pending Postings', (pendingR[0]?.c || 0).toLocaleString(), 'Awaiting review', 'var(--coral)')}
      ${kpi('Companies', (companiesR[0]?.c || 0).toLocaleString(), 'Distinct employers', 'var(--cyan)')}
      ${kpi('Users', (usersR[0]?.c || 0).toLocaleString(), 'Registered accounts', 'var(--cyan)')}
      ${kpi('Visits (7d)', (visits7dR[0]?.c || 0).toLocaleString(), `${uniqCountriesR[0]?.c || 0} countries reached`, 'var(--green)')}
      ${kpi('Expiring Soon', (expiringSoonR[0]?.c || 0).toLocaleString(), 'Within 3 days', 'var(--amber, #F59E0B)')}
    </div>
    <div class="dashboard-pulse-strip">
      ${pulse('Provider jobs', (sourceTypeCounts.provider || 0).toLocaleString(), 'ATS synced', 'var(--cyan)')}
      ${pulse('Employer jobs', (sourceTypeCounts.employer || 0).toLocaleString(), 'Direct submissions', 'var(--brand2)')}
      ${pulse('Paused / closed', ((statusCounts.paused || 0) + (statusCounts.closed || 0)).toLocaleString(), `${statusCounts.paused || 0} paused · ${statusCounts.closed || 0} closed`, 'var(--amber)')}
      ${pulse('Published articles', (articlesR[0]?.c || 0).toLocaleString(), 'Blog CMS', 'var(--pink)')}
      ${pulse('Hot Pay jobs', (hotR[0]?.c || 0).toLocaleString(), `≥ $${Math.round(hotPayThreshold / 1000)}k normalized`, 'var(--pink)')}
      ${pulse('AI activity', aiActivityCount.toLocaleString(), `${aiFailureCount} failed or errored`, 'var(--brand)')}
    </div>

    ${(pendingPostings || []).length ? `
    <div class="adm-card dashboard-pending-card" style="margin-bottom:16px">
      <div class="adm-card-title">📮 Pending Job Postings <span style="font-weight:400;color:var(--ink3);font-size:12px">— submitted via "Post a Job"</span></div>
      ${pendingPostings.map(p => {
        let pSkills = [];
        try { pSkills = JSON.parse(p.skills || '[]'); } catch (e) {}
        return `<div class="pp-row">
        <div class="pp-info">
          <div class="pp-title">${escapeHtml(p.title)} <span style="color:var(--ink3);font-weight:500">at ${escapeHtml(p.company)}</span>${p.company_id ? ' <span style="color:var(--green);font-size:10px;font-weight:700;border:1px solid rgba(15,174,121,.3);border-radius:10px;padding:1px 7px">Verified Employer Account</span>' : ''}</div>
          <div class="pp-meta">${escapeHtml(p.email)} · ${escapeHtml(p.location || 'Remote')} · ${escapeHtml(p.salary || 'No salary listed')}${p.seniority ? ' · ' + escapeHtml(p.seniority) : ''} · ${new Date(p.created_at).toLocaleString()}</div>
          ${pSkills.length ? `<div style="font-size:10.5px;color:var(--ink3);margin:3px 0">Skills: ${pSkills.map(escapeHtml).join(', ')}</div>` : ''}
          <a href="${escapeHtml(p.url)}" target="_blank" style="font-size:11px;color:var(--brand)">${escapeHtml(p.url)}</a>
        </div>
        <div class="pp-actions">
          <form method="POST" action="/admin/postings/approve"><input type="hidden" name="id" value="${p.id}"><button class="adm-btn-sm adm-btn-approve" type="submit">✓ Approve</button></form>
          <button type="button" class="adm-btn-sm" onclick="document.getElementById('rejBox${p.id}').classList.toggle('show')">✕ Reject</button>
        </div>
        <form method="POST" action="/admin/postings/reject" id="rejBox${p.id}" class="pp-reject-box">
          <input type="hidden" name="id" value="${p.id}">
          <select class="adm-input" name="reason" style="font-size:11px;padding:5px 8px">
            ${REJECTION_REASONS.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}
          </select>
          <input class="adm-input" name="reason_note" placeholder="Optional note…" style="font-size:11px;padding:5px 8px;flex:1;min-width:120px">
          <button class="adm-btn-sm" type="submit" style="color:var(--coral)" onclick="return confirm('Reject this posting?')">Confirm Reject</button>
        </form>
      </div>`;
      }).join('')}
    </div>` : ''}

    <div class="adm-grid dashboard-overview-grid">
      <div class="adm-card dashboard-section-card" style="grid-column:span 2">
        <div class="dashboard-card-heading"><div class="adm-card-title">System Health</div><span class="dashboard-card-note">Live checks</span></div>
        ${workerHealth}
        ${d1Health}
        ${providerHealthRows}
        <div class="health-row" style="border-bottom:none">
          <span class="adm-row-label">Last sync</span>
          <span class="adm-row-val" style="font-weight:600">${lastSyncSummary}</span>
        </div>
        <div class="health-row" style="border-bottom:none">
          <span class="adm-row-label">Last cleanup</span>
          <span class="adm-row-val" style="font-weight:600">${lastCleanupSummary}</span>
        </div>
      </div>
      <div class="adm-card dashboard-section-card" style="grid-column:span 2">
        <div class="dashboard-card-heading"><div class="adm-card-title">Visitor Traffic — Last 14 Days</div><span class="dashboard-card-note">${(visits7dR[0]?.c || 0).toLocaleString()} visits in 7d</span></div>
        <div class="dashboard-traffic-chart" aria-label="Visitor traffic for the last 14 days">
          ${days.map(d => `<div class="dashboard-traffic-bar" title="${d.label}: ${d.count} visits"><i style="height:${Math.max(4, Math.round((d.count / maxDaily) * 110))}px"></i><span>${d.label}</span></div>`).join('')}
        </div>
      </div>
      <div class="adm-card dashboard-section-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">Jobs by Category</div><span class="dashboard-card-note">Current inventory</span></div>
        ${barChart(catCounts)}
      </div>
      <div class="adm-card dashboard-compact-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">Top Pages (7d)</div><span class="dashboard-card-note">Most visited</span></div>
        <div class="dashboard-compact-list">${(topPages || []).length ? (topPages.map(p => `<div class="adm-row"><span class="adm-row-label">${escapeHtml(p.path)}</span><span class="adm-row-val">${p.c}</span></div>`).join('')) : '<div class="adm-empty">No traffic yet</div>'}</div>
      </div>
      <div class="adm-card dashboard-section-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">AI Activity by Feature (7d)</div><span class="dashboard-card-note">Advisory only</span></div>
        ${aiFeatureCounts.length ? barChart(aiFeatureCounts) : '<div class="adm-empty">No AI activity recorded</div>'}
      </div>
      <div class="adm-card dashboard-compact-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">Top Countries (7d)</div><span class="dashboard-card-note">Reach</span></div>
        <div class="dashboard-compact-list">${(topCountries || []).length ? (topCountries.map(c => `<div class="adm-row"><span class="adm-row-label">${escapeHtml(c.country)}</span><span class="adm-row-val">${c.c}</span></div>`).join('')) : '<div class="adm-empty">No traffic yet</div>'}</div>
      </div>
      <div class="adm-card dashboard-compact-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">Recent Sync History</div><span class="dashboard-card-note">Last 6 runs</span></div>
        <div class="dashboard-compact-list">${(syncLogs || []).length ? syncLogs.map(s => {
          let details = [];
          let errs = [];
          try { details = JSON.parse(s.details || '[]'); } catch (e) {}
          try { errs = JSON.parse(s.errors || '[]'); } catch (e) {}
          const when = s.created_at ? new Date(s.created_at).toLocaleString() : '—';
          return `<div class="dashboard-sync-row">
            <div class="dashboard-sync-main"><span>${when}</span><strong>+${s.inserted}<small> / ${s.skipped} skip</small></strong></div>
            ${details.length ? `<div class="dashboard-sync-details">${details.map(d => `<span>${escapeHtml(d.provider)}: <b style="color:${d.inserted > 0 ? 'var(--green)' : 'var(--ink3)'}">+${d.inserted}</b> · ${d.duration_ms}ms</span>`).join('')}</div>` : ''}
            ${errs.length ? `<div class="dashboard-sync-errors">${errs.map(e => `<div>⚠ ${escapeHtml(String(e))}</div>`).join('')}</div>` : ''}
          </div>`;
        }).join('') : '<div class="adm-empty">No sync runs yet</div>'}</div>
      </div>
      <div class="adm-card dashboard-section-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">Jobs by Source</div><span class="dashboard-card-note">Provider mix</span></div>
        ${(sourceBreakdownR || []).length ? barChart(sourceBreakdownR.map(r => ({ label: r.s, count: r.c }))) : '<div class="adm-empty">No source data yet — runs after the next sync</div>'}
      </div>
      <div class="adm-card dashboard-compact-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">Recent Jobs</div><span class="dashboard-card-note">Latest 6</span></div>
        <div class="dashboard-compact-list">${(recentJobsR || []).length ? recentJobsR.map(j => `<a class="adm-list-link dashboard-list-link" href="/job/${j.id}" target="_blank" rel="noopener"><span><b>${escapeHtml(j.title || 'Untitled job')}</b><small>${escapeHtml(j.company || 'Unknown company')} · ${escapeHtml(j.location || 'Remote')}</small></span><em>${j.created_at ? new Date(j.created_at).toLocaleDateString() : '—'}</em></a>`).join('') : '<div class="adm-empty">No jobs yet</div>'}</div>
      </div>
      <div class="adm-card dashboard-compact-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">Recent Users</div><span class="dashboard-card-note">Latest 6</span></div>
        <div class="dashboard-compact-list">${(recentUsersR || []).length ? recentUsersR.map(u => `<div class="adm-list-link dashboard-list-link"><span><b>${escapeHtml(u.email || 'Unknown user')}</b><small>${u.email_verified ? 'Verified' : 'Pending verification'} · ${escapeHtml(u.status || '—')}</small></span><em>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</em></div>`).join('') : '<div class="adm-empty">No users yet</div>'}</div>
      </div>
      <div class="adm-card dashboard-compact-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">Recent Companies</div><span class="dashboard-card-note">Latest 6</span></div>
        <div class="dashboard-compact-list">${(recentCompaniesR || []).length ? recentCompaniesR.map(c => `<div class="adm-list-link dashboard-list-link"><span><b>${escapeHtml(c.company || 'Unknown company')}</b><small>${c.c} active listing${c.c === 1 ? '' : 's'}</small></span><em>${c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</em></div>`).join('') : '<div class="adm-empty">No companies yet</div>'}</div>
      </div>
      <div class="adm-card dashboard-compact-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">Recent Activity <span style="font-weight:400;color:var(--ink3);font-size:12px">— <a href="/admin/security" style="color:var(--brand)">full log →</a></span></div><span class="dashboard-card-note">Latest 8</span></div>
        <div class="dashboard-compact-list">${recentActivity.length ? recentActivity.map(l => `<div class="adm-row">
          <span class="adm-row-label" style="max-width:65%">${escapeHtml(ACTION_LABELS[l.action] || l.action)}${l.target ? ` — <span style="color:var(--ink3);font-weight:500">${escapeHtml(l.target)}</span>` : ''}</span>
          <span class="adm-row-val" style="font-weight:500;color:var(--ink3);font-size:10.5px">${l.created_at ? new Date(l.created_at).toLocaleString() : ''}</span>
        </div>`).join('') : '<div class="adm-empty">No activity recorded yet</div>'}</div>
      </div>
      <div class="adm-card dashboard-compact-card">
        <div class="dashboard-card-heading"><div class="adm-card-title">Recent Cleanup History</div><span class="dashboard-card-note">Daily · 03:00 UTC</span></div>
        <div class="dashboard-compact-list">
        ${(cleanupLogs || []).length ? cleanupLogs.map(c => {
          let breakdown = {};
          try { breakdown = JSON.parse(c.reason_breakdown || '{}'); } catch (e) {}
          const when = c.created_at ? new Date(c.created_at).toLocaleString() : '—';
          return `<div class="adm-row" style="align-items:flex-start;flex-direction:column;gap:4px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <span class="adm-row-label" style="font-size:11px">${when}</span>
              <span class="adm-row-val" style="color:var(--coral)">−${c.deleted || 0}</span>
            </div>
            ${(breakdown.expired || breakdown.stale_30d) ? `<div style="font-size:10px;color:var(--ink3)">expired: ${breakdown.expired || 0} · stale 30d+: ${breakdown.stale_30d || 0}</div>` : ''}
            ${breakdown.error ? `<div style="font-size:10px;color:var(--coral)">⚠ ${escapeHtml(breakdown.error)}</div>` : ''}
          </div>`;
        }).join('') : '<div class="adm-empty">No cleanup runs yet</div>'}</div>
      </div>
    </div>

    <div class="adm-card dashboard-section-card" style="margin-top:16px">
      <div class="adm-card-title">Job Sources <span style="font-weight:400;color:var(--ink3);font-size:12px">— add company boards without redeploying</span></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="font-size:12.5px;color:var(--ink2)">
          <b style="color:var(--ink)">${(apiSources || []).length}</b> companies configured across ${Object.keys(PROVIDERS).length} providers ·
          <b style="color:var(--green)">${activeSourcesCount}</b> active
        </div>
        <a href="/admin/sources" class="adm-btn adm-btn-primary">🔌 Manage Job Sources →</a>
      </div>
    </div>
  </div>`;

  return content;
}
