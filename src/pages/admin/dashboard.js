// src/pages/admin/dashboard.js
// Dashboard page content: KPI cards, System Health, traffic chart,
// category breakdown, sync history, API sources, pending postings.
// Returns inner HTML only — adminShell() in shell.js wraps it.

import { getCategories } from '../../lib/categories.js';
import { ensureTable } from '../../db/schema.js';
import { escapeHtml } from '../../lib/entities.js';
import { PROVIDERS } from '../../providers/index.js';
import { BLOG_POSTS } from '../../data/blog-posts.js';
import { countApiSources } from '../../db/sync.js';

function barChart(rows) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return rows.map(r => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
      <span style="width:76px;flex-shrink:0;font-size:11px;color:var(--ink3);font-weight:600">${escapeHtml(r.label)}</span>
      <div style="flex:1;background:var(--surface2);border-radius:6px;height:16px;overflow:hidden">
        <div style="width:${Math.round((r.count / max) * 100)}%;height:100%;background:linear-gradient(90deg,var(--brand),var(--brand2));border-radius:6px"></div>
      </div>
      <span style="width:42px;text-align:right;flex-shrink:0;font-size:12px;font-weight:700;color:var(--ink)">${r.count}</span>
    </div>`).join('');
}

const kpi = (label, val, sub, color = 'var(--brand)') => `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:var(--shadow)">
    <div style="font-size:11px;font-weight:700;color:var(--ink3);letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px">${label}</div>
    <div style="font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;color:${color}">${val}</div>
    ${sub ? `<div style="font-size:11px;color:var(--ink3);margin-top:4px">${sub}</div>` : ''}
  </div>`;

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

const PC_PAGE_SIZE = 40;

export async function renderDashboardContent(env, { pcPage = 1 } = {}) {
  await ensureTable(env);
  const q = (sql, ...params) => env.DB.prepare(sql).bind(...params).all();

  const [{ results: totalJobsR }, { results: jobsTodayR }, { results: jobsWeekR }, { results: jobsMonthR }, { results: subsR }, { results: companiesR }, { results: hotR }] = await Promise.all([
    q("SELECT COUNT(*) c FROM jobs"),
    q("SELECT COUNT(*) c FROM jobs WHERE created_at >= datetime('now','-1 day')"),
    q("SELECT COUNT(*) c FROM jobs WHERE created_at >= datetime('now','-7 day')"),
    q("SELECT COUNT(*) c FROM jobs WHERE created_at >= datetime('now','-30 day')"),
    q("SELECT COUNT(*) c FROM subscribers"),
    q("SELECT COUNT(DISTINCT LOWER(company)) c FROM jobs WHERE company IS NOT NULL AND company != ''"),
    q("SELECT COUNT(*) c FROM jobs WHERE salary IS NOT NULL AND CAST(REPLACE(REPLACE(salary,'$',''),'k','') AS INTEGER) >= 150"),
  ]);

  const [{ results: totalVisitsR }, { results: visitsTodayR }, { results: visits7dR }, { results: uniqCountriesR }] = await Promise.all([
    q("SELECT COUNT(*) c FROM visits"),
    q("SELECT COUNT(*) c FROM visits WHERE created_at >= datetime('now','-1 day')"),
    q("SELECT COUNT(*) c FROM visits WHERE created_at >= datetime('now','-7 day')"),
    q("SELECT COUNT(DISTINCT country) c FROM visits WHERE created_at >= datetime('now','-7 day')"),
  ]);

  const { results: pendingR } = await q("SELECT COUNT(*) c FROM job_postings WHERE status='pending'");
  const skillsCount = await estimateDistinctSkills(env);

  // ── Job Lifecycle stats (schema.js: updated_at/expires_at/source/status) ──
  const [{ results: activeR }, { results: expiringSoonR }, { results: deletedTodayR }, { results: sourceBreakdownR }] = await Promise.all([
    q("SELECT COUNT(*) c FROM jobs WHERE status = 'active'"),
    q("SELECT COUNT(*) c FROM jobs WHERE expires_at IS NOT NULL AND expires_at < datetime('now','+3 day')"),
    q("SELECT COALESCE(SUM(deleted),0) c FROM cleanup_logs WHERE created_at >= datetime('now','-1 day')"),
    q("SELECT COALESCE(source,'unknown') s, COUNT(*) c FROM jobs GROUP BY s ORDER BY c DESC LIMIT 12"),
  ]);
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

  const { results: syncLogs } = await q("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 10");
  const { results: pendingPostings } = await q("SELECT * FROM job_postings WHERE status='pending' ORDER BY id DESC LIMIT 20");

  // ── API Sources — paginated, never unbounded ──────────────────────
  // A source list meant to scale into the hundreds cannot be rendered in
  // full on every dashboard load without risking the same CPU-time
  // truncation the rest of this page was already hardened against. This
  // pagination is purely presentational — syncJobs()'s own budgeting
  // (warm-up governor / subrequest ceiling, see db/sync.js) is completely
  // unaffected and continues to see every active source regardless of
  // which page the admin happens to be viewing.
  const pcPageNum = Math.max(1, parseInt(pcPage, 10) || 1);
  const pcOffset = (pcPageNum - 1) * PC_PAGE_SIZE;
  const [pcCounts, { results: apiSourcesPage }] = await Promise.all([
    countApiSources(env),
    q('SELECT * FROM api_sources ORDER BY provider ASC, id DESC LIMIT ? OFFSET ?', PC_PAGE_SIZE, pcOffset),
  ]);
  const pcTotal = pcCounts.total;
  const pcTotalPages = Math.max(1, Math.ceil(pcTotal / PC_PAGE_SIZE));
  // Health rows below need to know which providers are active across ALL
  // sources, not just the current page — apiSourcesPage alone would hide
  // a provider's health status once sources spill onto page 2+.
  const { results: activeProviderRows } = await q('SELECT DISTINCT provider FROM api_sources WHERE active = 1');

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
  const configuredProviderIds = new Set((activeProviderRows || []).map(r => r.provider));

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
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">📊 Dashboard</div>
        <div class="adm-sub">Live overview of JobForion performance</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <form method="POST" action="/api/sync" onsubmit="return confirm('Run job sync now?')" style="display:inline">
          <button class="adm-btn adm-btn-primary" type="submit">↻ Sync Jobs Now</button>
        </form>
        <form method="POST" action="/admin/cleanup" onsubmit="return confirm('Run cleanup now? This permanently deletes expired/stale jobs.')" style="display:inline">
          <button class="adm-btn" type="submit" style="border-color:var(--coral);color:var(--coral)">🧹 Run Cleanup Now</button>
        </form>
        <a href="/admin/logout" class="adm-btn">Logout</a>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpi('Total Jobs', (totalJobsR[0]?.c || 0).toLocaleString(), `+${jobsTodayR[0]?.c || 0} today · +${jobsWeekR[0]?.c || 0} this week`)}
      ${kpi('Active Jobs', (activeR[0]?.c || 0).toLocaleString(), 'status = active', 'var(--green)')}
      ${kpi('Expiring Soon', (expiringSoonR[0]?.c || 0).toLocaleString(), 'Within 3 days', 'var(--amber, #F5A623)')}
      ${kpi('Deleted Today', (deletedTodayR[0]?.c || 0).toLocaleString(), 'By daily cleanup job', 'var(--coral)')}
      ${kpi('This Month', (jobsMonthR[0]?.c || 0).toLocaleString(), 'New jobs, last 30 days', 'var(--brand2)')}
      ${kpi('Featured / Hot', (hotR[0]?.c || 0).toLocaleString(), 'Salary ≥ $150k', 'var(--pink)')}
      ${kpi('Pending Postings', (pendingR[0]?.c || 0).toLocaleString(), 'Awaiting review', 'var(--coral)')}
      ${kpi('Companies', (companiesR[0]?.c || 0).toLocaleString(), 'Distinct employers', 'var(--cyan)')}
      ${kpi('Skills', skillsCount.toLocaleString(), 'Distinct, sampled', 'var(--green)')}
      ${kpi('Blog Articles', BLOG_POSTS.length.toLocaleString(), 'Published')}
      ${kpi('Subscribers', (subsR[0]?.c || 0).toLocaleString(), 'Job alert emails', 'var(--pink)')}
      ${kpi('Total Visits', (totalVisitsR[0]?.c || 0).toLocaleString(), `${visitsTodayR[0]?.c || 0} today`, 'var(--cyan)')}
      ${kpi('Visits (7d)', (visits7dR[0]?.c || 0).toLocaleString(), `${uniqCountriesR[0]?.c || 0} countries reached`, 'var(--green)')}
    </div>

    ${(pendingPostings || []).length ? `
    <div class="adm-card" style="margin-bottom:16px">
      <div class="adm-card-title">📮 Pending Job Postings <span style="font-weight:400;color:var(--ink3);font-size:12px">— submitted via "Post a Job"</span></div>
      ${pendingPostings.map(p => `<div class="pp-row">
        <div class="pp-info">
          <div class="pp-title">${escapeHtml(p.title)} <span style="color:var(--ink3);font-weight:500">at ${escapeHtml(p.company)}</span></div>
          <div class="pp-meta">${escapeHtml(p.email)} · ${escapeHtml(p.location || 'Remote')} · ${escapeHtml(p.salary || 'No salary listed')} · ${new Date(p.created_at).toLocaleString()}</div>
          <a href="${escapeHtml(p.url)}" target="_blank" style="font-size:11px;color:var(--brand)">${escapeHtml(p.url)}</a>
        </div>
        <div class="pp-actions">
          <form method="POST" action="/admin/postings/approve"><input type="hidden" name="id" value="${p.id}"><button class="adm-btn-sm adm-btn-approve" type="submit">✓ Approve</button></form>
          <form method="POST" action="/admin/postings/reject"><input type="hidden" name="id" value="${p.id}"><button class="adm-btn-sm" type="submit" onclick="return confirm('Reject this posting?')">✕ Reject</button></form>
        </div>
      </div>`).join('')}
    </div>` : ''}

    <div class="adm-grid">
      <div class="adm-card" style="grid-column:span 2">
        <div class="adm-card-title">System Health</div>
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
      <div class="adm-card" style="grid-column:span 2">
        <div class="adm-card-title">Visitor Traffic — Last 14 Days</div>
        <div style="display:flex;align-items:flex-end;gap:5px;height:140px;padding-top:10px">
          ${days.map(d => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
            <div style="width:100%;background:linear-gradient(180deg,var(--brand),var(--brand2));border-radius:5px 5px 0 0;height:${Math.max(4, Math.round((d.count / maxDaily) * 110))}px" title="${d.label}: ${d.count}"></div>
            <span style="font-size:9px;color:var(--ink3)">${d.label}</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Jobs by Category</div>
        ${barChart(catCounts)}
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Top Pages (7d)</div>
        ${(topPages || []).length ? (topPages.map(p => `<div class="adm-row"><span class="adm-row-label">${escapeHtml(p.path)}</span><span class="adm-row-val">${p.c}</span></div>`).join('')) : '<div class="adm-empty">No traffic yet</div>'}
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Top Countries (7d)</div>
        ${(topCountries || []).length ? (topCountries.map(c => `<div class="adm-row"><span class="adm-row-label">${escapeHtml(c.country)}</span><span class="adm-row-val">${c.c}</span></div>`).join('')) : '<div class="adm-empty">No traffic yet</div>'}
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Recent Sync History</div>
        ${(syncLogs || []).length ? syncLogs.map(s => {
          let details = [];
          let errs = [];
          try { details = JSON.parse(s.details || '[]'); } catch (e) {}
          try { errs = JSON.parse(s.errors || '[]'); } catch (e) {}
          const when = s.created_at ? new Date(s.created_at).toLocaleString() : '—';
          return `<div class="adm-row" style="align-items:flex-start;flex-direction:column;gap:6px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <span class="adm-row-label" style="font-size:11px">${when}</span>
              <span class="adm-row-val" style="color:var(--green)">+${s.inserted}<span style="color:var(--ink3);font-weight:500"> / ${s.skipped} skip</span></span>
            </div>
            ${details.length ? `<div style="font-size:10px;color:var(--ink3);display:flex;flex-wrap:wrap;gap:8px">
              ${details.map(d => `<span>${escapeHtml(d.provider)}: <b style="color:${d.inserted > 0 ? 'var(--green)' : 'var(--ink3)'}">+${d.inserted}</b> (${d.duration_ms}ms)</span>`).join('')}
            </div>` : ''}
            ${errs.length ? `<div style="font-size:10px;color:#e05a5a;background:#fdf0f0;padding:6px 8px;border-radius:6px;width:100%;box-sizing:border-box">
              ${errs.map(e => `<div>⚠ ${escapeHtml(String(e))}</div>`).join('')}
            </div>` : ''}
          </div>`;
        }).join('') : '<div class="adm-empty">No sync runs yet</div>'}
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Jobs by Source</div>
        ${(sourceBreakdownR || []).length ? barChart(sourceBreakdownR.map(r => ({ label: r.s, count: r.c }))) : '<div class="adm-empty">No source data yet — runs after the next sync</div>'}
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Recent Cleanup History <span style="font-weight:400;color:var(--ink3);font-size:12px">— daily, 03:00 UTC</span></div>
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
        }).join('') : '<div class="adm-empty">No cleanup runs yet</div>'}
      </div>
    </div>

    <div class="adm-card" style="margin-top:16px">
      <div class="adm-card-title">API Sources <span style="font-weight:400;color:var(--ink3);font-size:12px">— add company boards without redeploying · new sources sync gradually, see Settings → Warm-up Governor</span></div>

      <div class="pc-info">
        كل مزود يقرأ وظائف الشركة مباشرة من صفحة التوظيف العامة الخاصة بها، دون أي مفتاح API.
        أضف عدد كبير من الشركات دفعة واحدة — سطر واحد لكل شركة، أو افصل بينها بفاصلة.
        يمكن أيضاً كتابة <code>معرّف|اسم مخصص</code> لتحديد اسم عرض مختلف عن المعرّف نفسه.
      </div>

      <form method="POST" action="/admin/api-sources/bulk-add" class="pc-bulk-form">
        <div class="pc-bulk-row">
          <select class="adm-input" name="provider" id="pcProviderSelect" required style="min-width:180px">
            <option value="greenhouse" data-hint="board token, e.g. airbnb">Greenhouse</option>
            <option value="lever" data-hint="company slug, e.g. netflix">Lever</option>
            <option value="ashby" data-hint="job board name">Ashby</option>
            <option value="smartrecruiters" data-hint="company identifier, e.g. Visa">SmartRecruiters</option>
            <option value="workable" data-hint="account subdomain, e.g. acme">Workable</option>
            <option value="teamtailor" data-hint="Teamtailor API token">Teamtailor</option>
            <option value="recruitee" data-hint="company subdomain, e.g. acme">Recruitee</option>
            <option value="workday" data-hint="full careers URL, e.g. https://acme.wd5.myworkdayjobs.com/External">Workday</option>
            <option value="icims" data-hint="iCIMS subdomain, e.g. acme">iCIMS</option>
          </select>
          <div style="flex:1;min-width:220px;font-size:11px;color:var(--ink3)" id="pcProviderHint">board token, e.g. airbnb</div>
        </div>
        <textarea class="adm-input" name="companies" rows="4" placeholder="airbnb&#10;figma&#10;netflix|Netflix (اسم مخصص)" required style="width:100%;margin-top:8px;font-family:inherit;resize:vertical"></textarea>
        <div class="pc-bulk-footer">
          <span style="font-size:11px;color:var(--ink3)">حتى 500 شركة في الدفعة الواحدة — الشركات المكررة لنفس المزود تُتجاهل تلقائياً</span>
          <button class="adm-btn adm-btn-primary" type="submit">+ إضافة الشركات</button>
        </div>
      </form>
      <script>
        (function () {
          var sel = document.getElementById('pcProviderSelect');
          var hint = document.getElementById('pcProviderHint');
          function updateHint(){
            if (!sel || !hint || sel.selectedIndex < 0) return;
            hint.textContent = sel.options[sel.selectedIndex].dataset.hint || '';
          }
          if (sel) { sel.addEventListener('change', updateHint); updateHint(); }
        })();
        function pcToggleEdit(id){
          var edit = document.getElementById('pc-edit-' + id);
          if (edit) edit.classList.toggle('open');
        }
      </script>

      <div class="pc-list">
        ${(apiSourcesPage || []).length ? apiSourcesPage.map(s => `
        <div class="pc-row" id="pc-view-${s.id}">
          <div class="pc-row-main">
            <span style="color:var(--brand);font-size:10px;font-weight:700;text-transform:uppercase;background:var(--brand-soft);padding:3px 8px;border-radius:6px">${escapeHtml(s.provider || 'greenhouse')}</span>
            <span class="adm-row-label" style="font-weight:700;color:var(--ink);max-width:none">${escapeHtml(s.label)}</span>
            <span style="color:var(--ink3);font-family:monospace;font-size:11px">${escapeHtml(s.api_key || '')}</span>
            ${s.active ? '<span style="color:var(--green);font-size:10px;font-weight:700">● ACTIVE</span>' : '<span style="color:var(--ink3);font-size:10px">○ off</span>'}
          </div>
          <div class="pc-row-actions">
            <button class="adm-btn-sm" type="button" style="color:var(--brand)" onclick="pcToggleEdit(${s.id})">تعديل</button>
            <form method="POST" action="/admin/api-sources/toggle" style="display:inline">
              <input type="hidden" name="id" value="${s.id}">
              <button class="adm-btn-sm" type="submit" style="color:var(--ink2)">${s.active ? 'إيقاف' : 'تفعيل'}</button>
            </form>
            <form method="POST" action="/admin/api-sources/delete" style="display:inline">
              <input type="hidden" name="id" value="${s.id}">
              <button class="adm-btn-sm" type="submit" onclick="return confirm('Remove this key?')">Remove</button>
            </form>
          </div>
        </div>
        <form method="POST" action="/admin/api-sources/update" class="pc-edit-row" id="pc-edit-${s.id}">
          <input type="hidden" name="id" value="${s.id}">
          <input class="adm-input" name="label" value="${escapeHtml(s.label || '')}" placeholder="الاسم المعروض" required>
          <input class="adm-input" name="company" value="${escapeHtml(s.api_key || '')}" placeholder="معرف الشركة" required>
          <label class="pc-active-check"><input type="checkbox" name="active" value="1" ${s.active ? 'checked' : ''}> مفعّل</label>
          <div class="pc-edit-actions">
            <button class="adm-btn adm-btn-primary" type="submit">حفظ</button>
            <button class="adm-btn" type="button" onclick="pcToggleEdit(${s.id})">إلغاء</button>
          </div>
        </form>`).join('') : '<div class="adm-empty">No sources added yet — add a company board above (e.g. a Greenhouse token) to start syncing.</div>'}
      </div>
      ${pcTotalPages > 1 ? `
      <div style="display:flex;justify-content:center;gap:8px;margin-top:14px">
        ${pcPageNum > 1 ? `<a class="adm-btn" href="/admin?pc_page=${pcPageNum - 1}">← السابق</a>` : ''}
        <span class="adm-btn" style="cursor:default">صفحة ${pcPageNum} من ${pcTotalPages} (${pcTotal} شركة)</span>
        ${pcPageNum < pcTotalPages ? `<a class="adm-btn" href="/admin?pc_page=${pcPageNum + 1}">التالي →</a>` : ''}
      </div>` : ''}
    </div>
  </div>`;

  return content;
}
