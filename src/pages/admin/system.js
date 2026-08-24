// src/pages/admin/system.js
// System — cron status/manual triggers, cache purge, database row counts,
// and the full sync + cleanup history (the dashboard only teases the last
// few of each). Read-only except the two explicit action buttons, which
// reuse the exact same handlers as before (/api/sync, /admin/cleanup) —
// no new mutation logic, just a fuller view of what's already there.

import { ensureTable } from '../../db/schema.js';
import { JOB_STATUS_ORDER, JOB_STATUS_META } from '../../config/constants.js';

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
];

export async function renderSystemContent(env) {
  await ensureTable(env);
  const q = (sql, ...params) => env.DB.prepare(sql).bind(...params).all();

  const [{ results: syncLogs }, { results: cleanupLogs }] = await Promise.all([
    q("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 15"),
    q("SELECT * FROM cleanup_logs ORDER BY id DESC LIMIT 10"),
  ]);

  const tableCounts = {};
  await Promise.all(COUNTED_TABLES.map(async (t) => {
    try {
      const { results } = await q(`SELECT COUNT(*) c FROM ${t}`);
      tableCounts[t] = results?.[0]?.c ?? null;
    } catch (e) {
      tableCounts[t] = null; // table not created yet on a fresh install — show em-dash, not an error
    }
  }));

  const { results: salaryRemainingRows } = await q(
    "SELECT COUNT(*) c FROM jobs WHERE salary IS NOT NULL AND salary != '' AND salary_min_usd IS NULL"
  );
  const salaryRemaining = salaryRemainingRows?.[0]?.c || 0;
  const emailConfigured = Boolean(env.BREVO_API_KEY && env.EMAIL_FROM_ADDRESS);
  const storageConfigured = Boolean(env.COMPANY_ASSETS);

  // ── Data Integrity report (plan §29) — read-only diagnostics only.
  // Nothing here is auto-fixed or deleted; an admin decides what (if
  // anything) to do about a nonzero count. All four are cheap: the first
  // two use idx_saved_jobs_job/idx_applications_job (already existed),
  // the status breakdown uses idx_jobs_status, and NOT EXISTS avoids
  // pulling any actual row data into memory just to count it.
  const [{ results: orphanSavedRows }, { results: orphanAppRows }, { results: jobStatusRows }] = await Promise.all([
    // Possible since Job Management's (Stage 5) 3-phase lifecycle can
    // eventually hard-delete a job ~89 days after it goes stale — a
    // saved_jobs row surviving that isn't a bug, it's expected, but an
    // admin should be able to SEE the count exists.
    q("SELECT COUNT(*) c FROM saved_jobs sj WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = sj.job_id)"),
    q("SELECT COUNT(*) c FROM applications a WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = a.job_id)"),
    q("SELECT status, COUNT(*) c FROM jobs GROUP BY status"),
  ]);
  const orphanSaved = orphanSavedRows?.[0]?.c || 0;
  const orphanApps = orphanAppRows?.[0]?.c || 0;
  const jobStatusMap = Object.fromEntries((jobStatusRows || []).map(r => [r.status || 'active', r.c]));

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">🖥️ System</div>
        <div class="adm-sub">Cron jobs, cache, database size, and full sync/cleanup history</div>
      </div>
      <a href="/admin" class="adm-btn">← Dashboard</a>
    </div>

    <div class="adm-grid" style="margin-bottom:16px">
      <div class="adm-card">
        <div class="adm-card-title">Cron Jobs <span style="font-weight:400;color:var(--ink3);font-size:12px">— configured in wrangler.toml</span></div>
        <div class="adm-row"><span class="adm-row-label">Job Sync</span><span class="adm-row-val">Every 6 hours</span></div>
        <div class="adm-row"><span class="adm-row-label">Cleanup (stale jobs)</span><span class="adm-row-val">Daily · 03:00 UTC</span></div>
        <div class="adm-row"><span class="adm-row-label">Job Alerts Dispatch</span><span class="adm-row-val">Daily · 08:00 UTC</span></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <form method="POST" action="/api/sync" onsubmit="return confirm('Run job sync now?')"><button class="adm-btn adm-btn-primary" type="submit">↻ Sync Now</button></form>
          <form method="POST" action="/admin/cleanup" onsubmit="return confirm('Run cleanup now? This permanently deletes expired/stale jobs.')"><button class="adm-btn" type="submit" style="color:var(--coral);border-color:var(--coral)">🧹 Cleanup Now</button></form>
          <form method="POST" action="/admin/system/run-job-alerts" onsubmit="return confirm('Send job alert digests now to every due alert?')"><button class="adm-btn" type="submit">📧 Send Job Alerts Now</button></form>
        </div>
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Cache</div>
        <div style="font-size:12px;color:var(--ink2);margin-bottom:12px;line-height:1.7">Directory pages (Companies, Categories, Skills, Countries) and the sitemap are cached at Cloudflare's edge. Purge if a change isn't showing up yet.</div>
        <form method="POST" action="/admin/cache/purge" onsubmit="return confirm('Purge cached directory pages and sitemap?')">
          <button class="adm-btn" type="submit">🗑 Purge Cache</button>
        </form>
        <div style="font-size:10.5px;color:var(--ink3);margin-top:8px">Best-effort: clears the known set of cached URLs. Query-string variants (e.g. filtered/paginated views) expire naturally within their normal TTL.</div>
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Service Status</div>
        <div class="health-row"><span class="adm-row-label"><span class="health-dot ${emailConfigured ? 'health-ok' : 'health-warn'}"></span>Transactional email</span><span class="adm-row-val">${emailConfigured ? 'Brevo ready' : 'Not configured'}</span></div>
        <div class="health-row"><span class="adm-row-label"><span class="health-dot ${storageConfigured ? 'health-ok' : 'health-warn'}"></span>Company asset storage</span><span class="adm-row-val">${storageConfigured ? 'R2 connected' : 'URL fallback'}</span></div>
        <div style="font-size:10.5px;color:var(--ink3);margin-top:8px">Credentials and provider keys are intentionally never displayed here.</div>
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
        <div style="font-size:10.5px;color:var(--ink3);margin-top:8px">${(orphanSaved + orphanApps) ? 'A nonzero count here is expected over time — jobs are only ever hard-deleted after passing through Expired → Archived (see Job Management), roughly 89 days of inactivity. It means a user saved/applied to a job that has since been permanently removed.' : 'No orphaned references found.'}</div>
      </div>
      <div class="adm-card" style="grid-column:span 2">
        <div class="adm-card-title">Salary Data Backfill <span style="font-weight:400;color:var(--ink3);font-size:12px">— normalizes free-text salaries (e.g. "$90k - $130k") into sortable/filterable USD numbers</span></div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="font-size:12.5px;color:var(--ink2)">
            ${salaryRemaining > 0
              ? `<b style="color:var(--ink)">${salaryRemaining.toLocaleString()}</b> job${salaryRemaining === 1 ? '' : 's'} with a salary still need processing`
              : `<span style="color:var(--green);font-weight:700">✓ All parseable salaries are up to date</span>`}
          </div>
          <form method="POST" action="/admin/system/backfill-salary">
            <button class="adm-btn adm-btn-primary" type="submit" ${salaryRemaining === 0 ? 'disabled' : ''}>Run Batch (300 jobs)</button>
          </form>
        </div>
        ${salaryRemaining > 300 ? `<div style="font-size:10.5px;color:var(--ink3);margin-top:8px">Processes 300 at a time to stay well inside Cloudflare's subrequest budget — click again to continue the remaining ${(salaryRemaining - 300).toLocaleString()}.</div>` : ''}
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
            ${errs.length ? `<div style="font-size:10px;color:var(--coral)">⚠ ${errs.length} error${errs.length === 1 ? '' : 's'}</div>` : ''}
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
  </div>`;
}
