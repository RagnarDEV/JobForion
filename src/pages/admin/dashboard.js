// src/pages/admin/dashboard.js
// The admin dashboard is deliberately split into TWO independent Worker
// invocations, not one giant page:
//
//   renderDashboardContent()  → the main /admin page. KPIs, System Health,
//                               provider companies (paginated), sync
//                               settings, pending postings. Kept light on
//                               purpose so it always renders completely.
//
//   renderDashboardWidgets()  → fetched client-side AFTER the main page has
//                               already loaded, via GET /admin/dashboard-
//                               widgets. Visitor traffic chart, category
//                               breakdown, top pages/countries, detailed
//                               sync/cleanup history — the genuinely heavy,
//                               "nice to have immediately" cards.
//
// WHY: Cloudflare's free plan gives a Worker invocation a very small CPU-time
// budget (I/O wait like D1 round-trips doesn't count against it, but JSON
// parsing + JS loops + building tens of KB of HTML string does). A single
// request that builds the *entire* dashboard — KPIs, health, charts, and a
// provider-companies list that's meant to scale to hundreds of rows — can
// exceed that budget and gets silently cut off mid-response: whatever HTML
// was built so far is sent, and everything after that point just never
// arrives, with no error shown anywhere. Splitting the work across two
// separate invocations means each one gets its own fresh CPU budget, and a
// slow/heavy widgets fetch can never break the main page around it.

import { CATEGORY_META, CATEGORY_ORDER } from '../../config/constants.js';
import { ensureTable } from '../../db/schema.js';
import { escapeHtml } from '../../lib/entities.js';
import { PROVIDERS } from '../../providers/index.js';
import { getSyncConfig } from '../../db/sync.js';
import { BLOG_POSTS } from '../../data/blog-posts.js';

const PC_PAGE_SIZE = 40;

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

// One row in the "Job Providers & Companies" list — a view mode plus a
// hidden inline edit form toggled by pcToggleEdit(). This is the in-place
// "Edit" option for every company, no separate page/modal round trip.
function providerCompanyRow(s) {
  const providerMeta = PROVIDERS[s.provider];
  const providerLabel = providerMeta?.displayName || s.provider;
  const hasError = !!s.last_error;
  const statusColor = hasError ? 'var(--coral)' : (s.active ? 'var(--green)' : 'var(--ink3)');
  const statusText = hasError
    ? `⚠ ${escapeHtml(s.last_error)}`
    : (s.last_synced_at
        ? `آخر مزامنة: ${new Date(s.last_synced_at).toLocaleString()} · ${s.last_job_count || 0} وظيفة`
        : 'بانتظار أول مزامنة');

  return `
  <div class="pc-row" id="pc-view-${s.id}">
    <div class="pc-row-main">
      <span class="pc-provider-badge">${escapeHtml(providerLabel)}</span>
      <span class="pc-company">${escapeHtml(s.label || s.api_key)}</span>
      <span class="pc-slug">${escapeHtml(s.api_key || '')}</span>
      <span class="pc-dot" style="background:${s.active ? 'var(--green)' : 'var(--ink3)'}" title="${s.active ? 'مفعّل' : 'معطّل'}"></span>
    </div>
    <div class="pc-row-status" style="color:${statusColor}">${statusText}</div>
    <div class="pc-row-actions">
      <button class="adm-btn-sm" type="button" style="color:var(--brand)" onclick="pcToggleEdit(${s.id})">تعديل</button>
      <form method="POST" action="/admin/providers/toggle" style="display:inline">
        <input type="hidden" name="id" value="${s.id}">
        <button class="adm-btn-sm" type="submit" style="color:var(--ink2)">${s.active ? 'إيقاف' : 'تفعيل'}</button>
      </form>
      <form method="POST" action="/admin/providers/delete" onsubmit="return confirm('حذف هذه الشركة نهائياً؟')" style="display:inline">
        <input type="hidden" name="id" value="${s.id}">
        <button class="adm-btn-sm" type="submit">حذف</button>
      </form>
    </div>
  </div>
  <form method="POST" action="/admin/providers/update" class="pc-edit-row" id="pc-edit-${s.id}">
    <input type="hidden" name="id" value="${s.id}">
    <input class="adm-input" name="label" value="${escapeHtml(s.label || '')}" placeholder="الاسم المعروض" required>
    <input class="adm-input" name="company" value="${escapeHtml(s.api_key || '')}" placeholder="معرف/سلاج الشركة" required>
    <label class="pc-active-check"><input type="checkbox" name="active" value="1" ${s.active ? 'checked' : ''}> مفعّل</label>
    <div class="pc-edit-actions">
      <button class="adm-btn adm-btn-primary" type="submit">حفظ</button>
      <button class="adm-btn" type="button" onclick="pcToggleEdit(${s.id})">إلغاء</button>
    </div>
  </form>`;
}

function skeletonWidgetCard() {
  return `<div class="adm-card"><div class="skeleton" style="height:14px;width:45%;margin-bottom:16px;border-radius:6px"></div><div class="skeleton" style="height:70px;border-radius:8px"></div></div>`;
}

// ════════════════════════════════════════════════════════════════
// MAIN PAGE — light, always renders fully
// ════════════════════════════════════════════════════════════════
export async function renderDashboardContent(env, { pcPage = 1 } = {}) {
  await ensureTable(env);
  const q = (sql, ...params) => env.DB.prepare(sql).bind(...params).all();

  const [{ results: jobStatsR }, { results: companiesR }] = await Promise.all([
    q(`SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN created_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS week,
         SUM(CASE WHEN created_at >= datetime('now','-30 day') THEN 1 ELSE 0 END) AS month,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN expires_at IS NOT NULL AND expires_at < datetime('now','+3 day') THEN 1 ELSE 0 END) AS expiring,
         SUM(CASE WHEN salary IS NOT NULL AND CAST(REPLACE(REPLACE(salary,'$',''),'k','') AS INTEGER) >= 150 THEN 1 ELSE 0 END) AS hot
       FROM jobs`),
    q("SELECT COUNT(DISTINCT LOWER(company)) c FROM jobs WHERE company IS NOT NULL AND company != ''"),
  ]);
  const jobStats = jobStatsR[0] || {};

  const [{ results: visitStatsR }, { results: uniqCountriesR }, { results: subsR }] = await Promise.all([
    q(`SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN created_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS week
       FROM visits`),
    q("SELECT COUNT(DISTINCT country) c FROM visits WHERE created_at >= datetime('now','-7 day')"),
    q("SELECT COUNT(*) c FROM subscribers"),
  ]);
  const visitStats = visitStatsR[0] || {};

  const { results: pendingR } = await q("SELECT COUNT(*) c FROM job_postings WHERE status='pending'");
  const skillsCount = await estimateDistinctSkills(env);
  const { results: pendingPostings } = await q("SELECT * FROM job_postings WHERE status='pending' ORDER BY id DESC LIMIT 20");

  // Sync log: only the most recent row is needed here (for the health
  // summary line + per-provider status dots). The full recent-history list
  // with per-run breakdowns lives in the lazy-loaded widgets endpoint.
  const { results: latestSyncRows } = await q("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 1");
  const latestSync = (latestSyncRows || [])[0] || null;
  let latestDetails = [], latestErrors = [];
  if (latestSync) {
    try { latestDetails = JSON.parse(latestSync.details || '[]'); } catch (e) {}
    try { latestErrors = JSON.parse(latestSync.errors || '[]'); } catch (e) {}
  }

  // ── Provider companies — paginated, never unbounded ──────────────
  // A company list meant to scale into the hundreds cannot be rendered in
  // full on every page load; PC_PAGE_SIZE keeps this card's cost constant
  // no matter how many companies are registered.
  const page = Math.max(1, parseInt(pcPage, 10) || 1);
  const offset = (page - 1) * PC_PAGE_SIZE;
  const [{ results: pcCountR }, { results: apiSourcesPage }] = await Promise.all([
    q('SELECT COUNT(*) total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) active_count FROM api_sources'),
    q('SELECT * FROM api_sources ORDER BY provider ASC, id DESC LIMIT ? OFFSET ?', PC_PAGE_SIZE, offset),
  ]);
  const pcTotal = pcCountR[0]?.total || 0;
  const totalActiveSources = pcCountR[0]?.active_count || 0;
  const pcTotalPages = Math.max(1, Math.ceil(pcTotal / PC_PAGE_SIZE));

  const syncConfig = await getSyncConfig(env);
  const estimatedRunsForFullCycle = Math.max(1, Math.ceil(totalActiveSources / Math.max(1, syncConfig.sourcesPerRun)));

  // ── System Health ──────────────────────────────────────────────
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

  const { results: activeProviderRows } = await q('SELECT DISTINCT provider FROM api_sources WHERE active = 1');
  const configuredProviderIds = new Set((activeProviderRows || []).map(r => r.provider));

  const providerHealthRows = Object.keys(PROVIDERS).map(id => {
    const label = PROVIDERS[id]?.displayName || id;
    if (!configuredProviderIds.has(id)) return healthRow(label, 'off');
    const stat = latestDetails.find(d => d.provider === id);
    const hadError = latestErrors.some(e => String(e).includes(`[${id}]`));
    if (hadError) return healthRow(label, 'err', 'راجع سجل المزامنة');
    if (stat) return healthRow(label, 'ok', `+${stat.inserted} آخر تشغيل`);
    return healthRow(label, 'warn', 'لم يُشغّل بعد');
  }).join('');

  const lastSyncSummary = latestSync
    ? `${new Date(latestSync.created_at).toLocaleString()} · +${latestSync.inserted} new · ${latestErrors.length} error${latestErrors.length === 1 ? '' : 's'}`
    : 'Never run yet';

  const providerOptionsHtml = Object.values(PROVIDERS)
    .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.displayName || p.id)}</option>`)
    .join('');
  const providerHintsJson = JSON.stringify(
    Object.fromEntries(Object.values(PROVIDERS).map(p => [p.id, p.keyFormatHint || '']))
  );

  const pcPagerHtml = pcTotalPages > 1 ? `
    <div style="display:flex;justify-content:center;gap:8px;margin-top:14px">
      ${page > 1 ? `<a class="adm-btn" href="/admin?pc_page=${page - 1}">← السابق</a>` : ''}
      <span class="adm-btn" style="cursor:default">صفحة ${page} من ${pcTotalPages}</span>
      ${page < pcTotalPages ? `<a class="adm-btn" href="/admin?pc_page=${page + 1}">التالي →</a>` : ''}
    </div>` : '';

  const skeletons = skeletonWidgetCard() + skeletonWidgetCard() + skeletonWidgetCard() + skeletonWidgetCard();

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
      ${kpi('Total Jobs', (jobStats.total || 0).toLocaleString(), `+${jobStats.today || 0} today · +${jobStats.week || 0} this week`)}
      ${kpi('Active Jobs', (jobStats.active || 0).toLocaleString(), 'status = active', 'var(--green)')}
      ${kpi('Expiring Soon', (jobStats.expiring || 0).toLocaleString(), 'Within 3 days', 'var(--amber, #F5A623)')}
      ${kpi('This Month', (jobStats.month || 0).toLocaleString(), 'New jobs, last 30 days', 'var(--brand2)')}
      ${kpi('Featured / Hot', (jobStats.hot || 0).toLocaleString(), 'Salary ≥ $150k', 'var(--pink)')}
      ${kpi('Pending Postings', (pendingR[0]?.c || 0).toLocaleString(), 'Awaiting review', 'var(--coral)')}
      ${kpi('Companies', (companiesR[0]?.c || 0).toLocaleString(), 'Distinct employers', 'var(--cyan)')}
      ${kpi('Skills', skillsCount.toLocaleString(), 'Distinct, sampled', 'var(--green)')}
      ${kpi('Blog Articles', BLOG_POSTS.length.toLocaleString(), 'Published')}
      ${kpi('Subscribers', (subsR[0]?.c || 0).toLocaleString(), 'Job alert emails', 'var(--pink)')}
      ${kpi('Total Visits', (visitStats.total || 0).toLocaleString(), `${visitStats.today || 0} today`, 'var(--cyan)')}
      ${kpi('Visits (7d)', (visitStats.week || 0).toLocaleString(), `${uniqCountriesR[0]?.c || 0} countries reached`, 'var(--green)')}
      ${kpi('Provider Companies', pcTotal.toLocaleString(), `${totalActiveSources} مفعّلة`, 'var(--brand)')}
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

    <div class="adm-card" style="margin-bottom:16px">
      <div class="adm-card-title">System Health</div>
      ${workerHealth}
      ${d1Health}
      ${providerHealthRows}
      <div class="health-row" style="border-bottom:none">
        <span class="adm-row-label">Last sync</span>
        <span class="adm-row-val" style="font-weight:600">${lastSyncSummary}</span>
      </div>
    </div>

    <!-- ── Job Providers & Companies ─────────────────────────────── -->
    <div class="adm-card" style="margin-bottom:16px">
      <div class="adm-card-title">🏢 مزودو الوظائف والشركات <span style="font-weight:400;color:var(--ink3);font-size:12px">— أضف اسم/معرّف الشركة فقط، بدون مفاتيح API أو روابط</span></div>

      <div class="pc-info">
        كل مزود يقرأ وظائف الشركة مباشرة من صفحة التوظيف العامة الخاصة بها، دون الحاجة لأي مفتاح API.
        يمكنك إضافة عدد كبير من الشركات دفعة واحدة — ضع كل شركة في سطر منفصل، أو افصل بينها بفاصلة.
        يمكنك أيضاً كتابة <code>معرّف|اسم يظهر في اللوحة</code> لتحديد اسم عرض مخصص.
      </div>

      <form method="POST" action="/admin/providers/bulk-add" class="pc-bulk-form">
        <div class="pc-bulk-row">
          <select class="adm-input" name="provider" id="pcProviderSelect" required style="min-width:180px">
            ${providerOptionsHtml}
          </select>
          <div style="flex:1;min-width:220px;font-size:11px;color:var(--ink3)" id="pcProviderHint"></div>
        </div>
        <textarea class="adm-input" name="companies" rows="4" placeholder="airbnb&#10;figma&#10;netflix|Netflix (اسم مخصص)" required style="width:100%;margin-top:8px;font-family:inherit;resize:vertical"></textarea>
        <div class="pc-bulk-footer">
          <span style="font-size:11px;color:var(--ink3)">سطر واحد لكل شركة — يمكن إضافة حتى 500 شركة في الدفعة الواحدة</span>
          <button class="adm-btn adm-btn-primary" type="submit">+ إضافة الشركات</button>
        </div>
      </form>

      <div class="pc-list">
        ${(apiSourcesPage || []).length ? apiSourcesPage.map(providerCompanyRow).join('') : (pcTotal === 0 ? '<div class="adm-empty">لا توجد شركات مضافة بعد — أضف أول شركاتك أعلاه.</div>' : '<div class="adm-empty">لا توجد شركات في هذه الصفحة.</div>')}
      </div>
      ${pcPagerHtml}
    </div>

    <!-- ── Sync Settings (Cloudflare free-plan safe) ─────────────── -->
    <div class="adm-card" style="margin-bottom:16px">
      <div class="adm-card-title">⚙️ إعدادات المزامنة <span style="font-weight:400;color:var(--ink3);font-size:12px">— متوافقة مع الخطة المجانية في Cloudflare (حد 50 طلب فرعي لكل تنفيذ)</span></div>
      <form method="POST" action="/admin/sync-config" class="pc-sync-form">
        <label class="pc-sync-field">
          <span>عدد الشركات المعالَجة في كل تشغيل</span>
          <input class="adm-input" type="number" name="sources_per_run" min="1" max="30" value="${syncConfig.sourcesPerRun}">
          <small>القيمة الموصى بها: 8–15. قيم أعلى قد تتجاوز حد Cloudflare المجاني.</small>
        </label>
        <label class="pc-sync-field">
          <span>أقصى عدد وظائف جديدة لكل شركة</span>
          <input class="adm-input" type="number" name="jobs_per_company_cap" min="1" max="100" value="${syncConfig.jobsPerCompanyCap}">
          <small>عدد قليل لكل شركة أفضل من توقف المزامنة بالكامل — 10–20 يكفي غالباً.</small>
        </label>
        <button class="adm-btn adm-btn-primary" type="submit">حفظ الإعدادات</button>
      </form>
      <div class="adm-row" style="border-top:1px solid var(--border);margin-top:12px;padding-top:10px">
        <span class="adm-row-label">إجمالي الشركات المفعّلة</span>
        <span class="adm-row-val">${totalActiveSources}</span>
      </div>
      <div class="adm-row">
        <span class="adm-row-label">عدد التشغيلات اللازمة لتغطية كل الشركات مرة واحدة</span>
        <span class="adm-row-val">${estimatedRunsForFullCycle} تشغيل (كل 6 ساعات حسب الجدولة الحالية)</span>
      </div>
    </div>

    <!-- ── Heavier widgets — loaded separately so they can never block
         or break anything above this line ─────────────────────────── -->
    <div class="adm-grid" id="dashboardWidgetsHost">
      ${skeletons}
    </div>
  </div>
  <script>
    window.__PC_PROVIDER_HINTS__ = ${providerHintsJson};
    (function(){
      var sel = document.getElementById('pcProviderSelect');
      var hint = document.getElementById('pcProviderHint');
      function updateHint(){
        if (!sel || !hint) return;
        hint.textContent = window.__PC_PROVIDER_HINTS__[sel.value] || '';
      }
      if (sel) { sel.addEventListener('change', updateHint); updateHint(); }
    })();
    function pcToggleEdit(id){
      var edit = document.getElementById('pc-edit-' + id);
      if (!edit) return;
      edit.classList.toggle('open');
    }
    function jnLoadDashboardWidgets(){
      var host = document.getElementById('dashboardWidgetsHost');
      if (!host) return;
      fetch('/admin/dashboard-widgets', { credentials: 'same-origin' })
        .then(function(r){ if (!r.ok) throw new Error('status ' + r.status); return r.text(); })
        .then(function(html){ host.innerHTML = html; })
        .catch(function(){
          host.innerHTML = '<div class="adm-card" style="grid-column:span 2">' +
            '<div class="adm-empty">تعذر تحميل الإحصائيات التفصيلية (الرسم البياني، السجلات...). ' +
            '<button class="adm-btn-sm" style="color:var(--brand)" onclick="jnLoadDashboardWidgets()">إعادة المحاولة</button></div></div>';
        });
    }
    jnLoadDashboardWidgets();
  </script>`;

  return content;
}

// ════════════════════════════════════════════════════════════════
// WIDGETS — fetched separately, its own Worker invocation / CPU budget
// ════════════════════════════════════════════════════════════════
export async function renderDashboardWidgets(env) {
  await ensureTable(env);
  const q = (sql, ...params) => env.DB.prepare(sql).bind(...params).all();

  const { results: sourceBreakdownR } = await q(
    "SELECT COALESCE(source,'unknown') s, COUNT(*) c FROM jobs GROUP BY s ORDER BY c DESC LIMIT 12"
  );
  const { results: cleanupLogs } = await q("SELECT * FROM cleanup_logs ORDER BY id DESC LIMIT 6");

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

  // CATEGORY_ORDER keys are fixed app constants, never user input — safe
  // to inline directly into the CASE expressions, no bound params needed.
  const catCaseSql = CATEGORY_ORDER
    .map(k => `SUM(CASE WHEN LOWER(title) LIKE '%${k}%' THEN 1 ELSE 0 END) AS cat_${k}`)
    .join(', ');
  const { results: catCountsR } = await q(`SELECT ${catCaseSql} FROM jobs`);
  const catRow = catCountsR[0] || {};
  const catCounts = CATEGORY_ORDER.map(k => ({ label: CATEGORY_META[k].label, count: catRow[`cat_${k}`] || 0 }));

  const { results: syncLogs } = await q("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 10");

  return `
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
              ${details.map(d => `<span>${escapeHtml(PROVIDERS[d.provider]?.displayName || d.provider)}: <b style="color:${d.inserted > 0 ? 'var(--green)' : 'var(--ink3)'}">+${d.inserted}</b> (${d.duration_ms}ms)</span>`).join('')}
            </div>` : ''}
            ${errs.length ? `<div style="font-size:10px;color:#e05a5a;background:#fdf0f0;padding:6px 8px;border-radius:6px;width:100%;box-sizing:border-box">
              ${errs.map(e => `<div>⚠ ${escapeHtml(String(e))}</div>`).join('')}
            </div>` : ''}
          </div>`;
        }).join('') : '<div class="adm-empty">No sync runs yet</div>'}
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Jobs by Source</div>
        ${(sourceBreakdownR || []).length ? barChart(sourceBreakdownR.map(r => ({ label: PROVIDERS[r.s]?.displayName || r.s, count: r.c }))) : '<div class="adm-empty">No source data yet — runs after the next sync</div>'}
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
      </div>`;
}
