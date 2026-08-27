// src/pages/admin/sources.js
// Job Sources / Providers — dedicated control center for every ATS
// integration (see src/providers/index.js). Previously this lived as one
// big card inline in dashboard.js; moved out to its own page so it can
// grow (per-provider health, per-source pause/activate) without crowding
// the Overview screen. Nothing about how sync itself works changes —
// this is presentation + one new capability (pause without deleting).

import { escapeHtml } from '../../lib/entities.js';
import { ensureTable } from '../../db/schema.js';
import { PROVIDERS } from '../../providers/index.js';

// Kept local (rather than a new export in each provider module) so the
// provider contract documented in providers/index.js stays unchanged —
// this is presentation-only metadata, not sync behavior.
const PROVIDER_LABELS = {
  greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters', workable: 'Workable',
  teamtailor: 'Teamtailor', recruitee: 'Recruitee',
  workday: 'Workday', icims: 'iCIMS',
};

function healthDot(status) {
  const cls = { ok: 'health-ok', warn: 'health-warn', off: 'health-off', err: 'health-err' }[status] || 'health-off';
  return `<span class="health-dot ${cls}"></span>`;
}

function timeAgo(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso + 'Z').getTime(); // D1 CURRENT_TIMESTAMP is UTC without a 'Z' suffix
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export async function renderSourcesContent(env) {
  await ensureTable(env);
  const q = (sql, ...params) => env.DB.prepare(sql).bind(...params).all();

  const [{ results: apiSources }, { results: syncLogs }, { results: jobCountRows }] = await Promise.all([
    q("SELECT * FROM api_sources ORDER BY id DESC"),
    q("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 5"),
    q("SELECT COALESCE(source,'unknown') s, COUNT(*) c FROM jobs GROUP BY s"),
  ]);
  const jobCountMap = Object.fromEntries((jobCountRows || []).map(r => [r.s, r.c]));

  const latestSync = (syncLogs || [])[0];
  let latestDetails = [];
  if (latestSync) {
    try { latestDetails = JSON.parse(latestSync.details || '[]'); } catch (e) {}
  }

  const sourcesByProvider = {};
  for (const s of apiSources || []) (sourcesByProvider[s.provider] ||= []).push(s);

  const providerCards = Object.keys(PROVIDERS).map(id => {
    const sources = sourcesByProvider[id] || [];
    const activeCount = sources.filter(s => s.active).length;
    const stat = latestDetails.find(d => d.provider === id);

    // Health is now derived from api_sources' PERSISTED per-source fields
    // (last_synced_at / last_success_at / last_error_type /
    // consecutive_failures — written by db/sync.js's recordSourceOutcome
    // after every attempt) instead of only the single most recent
    // sync_logs row. A provider with several sources shows the WORST
    // status among them — one broken company shouldn't hide behind
    // nine healthy ones.
    const activeSources = sources.filter(s => s.active);
    const mostFailures = Math.max(0, ...activeSources.map(s => s.consecutive_failures || 0));
    const worstSource = activeSources.find(s => (s.consecutive_failures || 0) === mostFailures && mostFailures > 0);
    const lastSyncedSource = activeSources.slice().sort((a, b) => new Date(b.last_synced_at || 0) - new Date(a.last_synced_at || 0))[0];

    let status = 'off', statusText = 'No companies added yet';
    if (sources.length && activeCount === 0) { status = 'off'; statusText = 'All companies paused'; }
    else if (sources.length) {
      if (worstSource?.last_error_type === 'RATE_LIMITED') {
        status = 'warn'; statusText = `Rate limited on "${worstSource.label}" — will retry automatically`;
      } else if (mostFailures >= 3) {
        status = 'err'; statusText = `Failing on "${worstSource.label}" — ${mostFailures} syncs in a row (${worstSource.last_error || 'see error'})`;
      } else if (worstSource) {
        status = 'warn'; statusText = `Last attempt failed on "${worstSource.label}" — ${worstSource.last_error || 'see error'}`;
      } else if (lastSyncedSource?.last_success_at) {
        status = 'ok'; statusText = `Last synced ${timeAgo(lastSyncedSource.last_success_at)}${stat ? ` · +${stat.inserted} jobs, ${stat.updated || 0} updated last run` : ''}`;
      } else {
        status = 'warn'; statusText = 'Configured — no sync yet (runs on the next cron, or click Sync Now below)';
      }
    }

    return `
    <div class="adm-card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          ${healthDot(status)}
          <span style="font-weight:700;font-size:14px;color:var(--ink)">${escapeHtml(PROVIDER_LABELS[id] || id)}</span>
          <span style="font-size:10px;font-weight:700;color:var(--ink3);background:var(--surface2);padding:2px 8px;border-radius:20px">${(jobCountMap[id] || 0).toLocaleString()} jobs</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;color:var(--ink3)">${activeCount} of ${sources.length} companies active</span>
          ${activeCount ? `<form method="POST" action="/api/sync?provider=${id}" style="display:inline"><button class="adm-btn-sm" type="submit" style="color:var(--brand);border-color:var(--brand)">↻ Sync Now</button></form>` : ''}
        </div>
      </div>
      <div style="font-size:11.5px;color:var(--ink2);margin-bottom:${sources.length ? '12px' : '0'}">${escapeHtml(statusText)}</div>
      ${sources.length ? `<div class="pc-list">
        ${sources.map(s => `<div class="pc-row">
          <div class="pc-row-main">
            <span style="font-weight:700;font-size:12.5px;color:var(--ink)">${escapeHtml(s.label)}</span>
            <span style="font-size:11px;color:var(--ink3)">${escapeHtml(s.api_key || '')}</span>
            ${s.active ? '<span style="color:var(--green);font-size:10px;font-weight:700">● ACTIVE</span>' : '<span style="color:var(--ink3);font-size:10px">○ paused</span>'}
            ${s.last_synced_at ? `<span style="font-size:10px;color:var(--ink3)">· synced ${timeAgo(s.last_synced_at)}</span>` : ''}
            ${(s.consecutive_failures || 0) > 0 ? `<span style="font-size:10px;color:var(--coral);font-weight:700">· ${s.consecutive_failures} failures</span>` : ''}
          </div>
          <div class="pc-row-actions">
            <form method="POST" action="/admin/api-sources/toggle" style="display:inline">
              <input type="hidden" name="id" value="${s.id}">
              <button class="adm-btn-sm" type="submit" style="color:var(--brand)">${s.active ? 'Pause' : 'Activate'}</button>
            </form>
            <form method="POST" action="/admin/api-sources/delete" onsubmit="return confirm('Remove this company source permanently?')" style="display:inline">
              <input type="hidden" name="id" value="${s.id}">
              <button class="adm-btn-sm" type="submit">Remove</button>
            </form>
          </div>
        </div>`).join('')}
      </div>` : ''}
    </div>`;
  }).join('');

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">🔌 Job Sources</div>
        <div class="adm-sub">Every ATS integration is keyless — add a company's public career-site identifier and it starts syncing on the next cron run</div>
      </div>
      <a href="/admin/system" class="adm-btn">Sync History</a>
    </div>

    <div class="adm-card" style="margin-bottom:16px">
      <div class="adm-card-title">Add a Company</div>
      <div class="pc-info">New sources sync gradually while the site is small — see <b>Settings: Job Sync Warm-up</b> to tune the ramp-up caps.</div>
      <form method="POST" action="/admin/api-sources" style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="adm-input" name="label" placeholder="Label (e.g. Netflix)" required>
        <select class="adm-input" name="provider" id="providerSelect" onchange="document.getElementById('apiKeyInput').placeholder=this.options[this.selectedIndex].dataset.hint">
          ${Object.entries(PROVIDERS).map(([id, mod]) => `<option value="${id}" data-hint="${escapeHtml(mod.keyFormatHint || '')}">${escapeHtml(PROVIDER_LABELS[id] || id)}</option>`).join('')}
        </select>
        <input class="adm-input" id="apiKeyInput" name="api_key" placeholder="identifier" required style="flex:1;min-width:200px">
        <button class="adm-btn adm-btn-primary" type="submit">+ Add Source</button>
      </form>
      <script>
        (function () {
          var sel = document.getElementById('providerSelect');
          var input = document.getElementById('apiKeyInput');
          if (sel && input && sel.selectedIndex >= 0) input.placeholder = sel.options[sel.selectedIndex].dataset.hint || 'identifier';
        })();
      </script>
    </div>

    ${providerCards}
  </div>`;
}
