// src/pages/admin/jobs.js
// Job Management: search/filter/paginate, edit, delete, feature/unfeature,
// copy-link, preview, duplicate-detection (manual review, never auto-delete),
// and stale-job cleanup (configurable age threshold, confirmed before running).

import { BASE_URL, JOB_TYPE_META, JOB_TYPE_ORDER, JOB_TYPE_SORT_SQL } from '../../config/constants.js';
import { getCategories } from '../../lib/categories.js';
import { ensureTable } from '../../db/schema.js';
import { escapeHtml } from '../../lib/entities.js';

const PAGE_SIZE = 30;

// `categoryOrder`/`categoryMap` are optional — default to empty (no
// category column shown) only if a caller somehow forgets to pass them;
// every real call site below always supplies the live D1-backed list.
function jobRow(j, categoryOrder = [], categoryMap = {}) {
  const cat = categoryOrder.find(k => (j.title || '').toLowerCase().includes(k));
  const catMeta = cat ? categoryMap[cat] : null;
  const jt = (j.job_type && JOB_TYPE_META[j.job_type]) ? j.job_type : 'Free';
  const jtBadge = jt !== 'Free' ? `<span class="adm-jt-badge">${JOB_TYPE_META[jt].icon} ${jt}</span> ` : '';
  return `<tr>
    <td style="max-width:220px">
      <div style="font-weight:700;font-size:12.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${j.featured ? '📌 ' : ''}${jtBadge}${escapeHtml(j.title)}</div>
      <div style="font-size:11px;color:var(--ink3)">${escapeHtml(j.company)}</div>
    </td>
    <td style="font-size:11px;color:var(--ink2)">${escapeHtml(j.location || '—')}</td>
    <td style="font-size:11px;color:var(--ink2)">${catMeta ? `${catMeta.emoji} ${escapeHtml(catMeta.label)}` : '—'}</td>
    <td style="font-size:11px;color:var(--ink2)">${escapeHtml(j.remote_type || '—')}</td>
    <td style="font-size:11px;color:var(--green);font-weight:700">${escapeHtml(j.salary || '—')}</td>
    <td style="font-size:11px;color:var(--ink3)">${j.created_at ? new Date(j.created_at).toLocaleDateString() : '—'}</td>
    <td>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        <a class="adm-btn-sm" href="/job/${j.id}" target="_blank" style="color:var(--ink2)">Preview</a>
        <a class="adm-btn-sm" href="/admin/jobs/edit?id=${j.id}" style="color:var(--brand)">Edit</a>
        <button class="adm-btn-sm" style="color:var(--ink2)" onclick="jnCopyLink('${BASE_URL}/job/${j.id}')">Copy</button>
        <form method="POST" action="/admin/jobs/feature" style="display:inline">
          <input type="hidden" name="id" value="${j.id}">
          <input type="hidden" name="redirect" value="${escapeHtml(currentQueryString())}">
          <button class="adm-btn-sm" type="submit" style="color:var(--ink2)">${j.featured ? 'Unpin' : 'Pin'}</button>
        </form>
        <form method="POST" action="/admin/jobs/delete" onsubmit="return confirm('Delete this job permanently?')" style="display:inline">
          <input type="hidden" name="id" value="${j.id}">
          <input type="hidden" name="redirect" value="${escapeHtml(currentQueryString())}">
          <button class="adm-btn-sm" type="submit">Delete</button>
        </form>
      </div>
    </td>
  </tr>`;
}

// Placeholder resolved client-side is unnecessary here — redirect target is
// built server-side per request; see renderJobsListContent for real usage.
function currentQueryString() { return '__REDIRECT__'; }

export async function renderJobsListContent(env, params) {
  await ensureTable(env);
  const categories = await getCategories(env);
  const categoryOrder = categories.map(c => c.key);
  const categoryMap = Object.fromEntries(categories.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }]));
  const qText = (params.get('q') || '').trim();
  const category = params.get('category') || '';
  const remote = params.get('remote') || '';
  const employment = params.get('employment') || '';
  const jobType = params.get('job_type') || '';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const qsString = params.toString();
  const redirectTarget = qsString ? `/admin/jobs?${qsString}` : '/admin/jobs';

  const where = [];
  const binds = [];
  if (qText) { where.push('(LOWER(title) LIKE ? OR LOWER(company) LIKE ?)'); binds.push(`%${qText.toLowerCase()}%`, `%${qText.toLowerCase()}%`); }
  if (category) { where.push('LOWER(title) LIKE ?'); binds.push(`%${category}%`); }
  if (remote) { where.push('remote_type = ?'); binds.push(remote); }
  if (employment) { where.push('employment_type = ?'); binds.push(employment); }
  if (jobType) { where.push('job_type = ?'); binds.push(jobType); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results: rows } = await env.DB.prepare(
    `SELECT * FROM jobs ${whereSql} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, featured DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`
  ).bind(...binds).all();
  const { results: countRows } = await env.DB.prepare(`SELECT COUNT(*) c FROM jobs ${whereSql}`).bind(...binds).all();
  const total = countRows[0]?.c || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { results: staleCountRows } = await env.DB.prepare(
    "SELECT COUNT(*) c FROM jobs WHERE created_at < datetime('now','-45 day')"
  ).all();
  const staleCount = staleCountRows[0]?.c || 0;

  const { results: unbackfilledRows } = await env.DB.prepare(
    "SELECT COUNT(*) c FROM jobs WHERE salary IS NOT NULL AND salary != '' AND salary_min_usd IS NULL"
  ).all();
  const unbackfilledCount = unbackfilledRows[0]?.c || 0;

  const rowsHtml = (rows || []).map(j => jobRow(j, categoryOrder, categoryMap)).join('').replaceAll('__REDIRECT__', escapeHtml(redirectTarget));

  const qs = (overrides) => {
    const p = new URLSearchParams(params);
    Object.entries(overrides).forEach(([k, v]) => v ? p.set(k, v) : p.delete(k));
    return p.toString();
  };

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">💼 Job Management</div>
        <div class="adm-sub">${total.toLocaleString()} jobs match current filters</div>
      </div>
      <a href="/admin/jobs/duplicates" class="adm-btn">🔍 Find Duplicates</a>
    </div>

    ${staleCount > 0 ? `
    <div class="adm-card" style="margin-bottom:14px;border-color:rgba(224,168,58,.4)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="font-size:12.5px;color:var(--ink2)"><b>${staleCount.toLocaleString()}</b> jobs are older than 45 days and may be stale.</div>
        <form method="POST" action="/admin/jobs/delete-stale" onsubmit="return confirm('Permanently delete ' + ${staleCount} + ' jobs older than the chosen age? This cannot be undone.')" style="display:flex;gap:6px;align-items:center">
          <input class="adm-input" type="number" name="days" value="45" min="7" style="width:70px" title="Age in days">
          <button class="adm-btn adm-btn-primary" type="submit" style="background:#e0a83a;border-color:#e0a83a">Delete Stale Jobs</button>
        </form>
      </div>
    </div>` : ''}

    ${unbackfilledCount > 0 ? `
    <div class="adm-card" style="margin-bottom:14px;border-color:rgba(53,86,255,.3)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="font-size:12.5px;color:var(--ink2)">
          <b>${unbackfilledCount.toLocaleString()}</b> jobs have a salary but were synced before salary normalization existed — their "Hot" badge and salary filter may be inaccurate until backfilled.
        </div>
        <form method="POST" action="/admin/jobs/backfill-salary" style="display:inline">
          <button class="adm-btn adm-btn-primary" type="submit">💰 Backfill Salary Data (300 at a time)</button>
        </form>
      </div>
    </div>` : ''}

    <div class="adm-card" style="margin-bottom:14px">
      <form method="GET" action="/admin/jobs" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="adm-input" name="q" placeholder="Search title or company…" value="${escapeHtml(qText)}" style="flex:1;min-width:180px">
        <select class="adm-input" name="category" onchange="this.form.submit()">
          <option value="">All categories</option>
          ${categoryOrder.map(k => `<option value="${k}" ${category === k ? 'selected' : ''}>${categoryMap[k].emoji} ${escapeHtml(categoryMap[k].label)}</option>`).join('')}
        </select>
        <select class="adm-input" name="remote" onchange="this.form.submit()">
          <option value="">Any remote type</option>
          <option value="fully_remote" ${remote === 'fully_remote' ? 'selected' : ''}>Fully remote</option>
          <option value="hybrid" ${remote === 'hybrid' ? 'selected' : ''}>Hybrid</option>
          <option value="on_site" ${remote === 'on_site' ? 'selected' : ''}>On-site</option>
        </select>
        <select class="adm-input" name="employment" onchange="this.form.submit()">
          <option value="">Any employment type</option>
          <option value="full_time" ${employment === 'full_time' ? 'selected' : ''}>Full-time</option>
          <option value="part_time" ${employment === 'part_time' ? 'selected' : ''}>Part-time</option>
          <option value="contract" ${employment === 'contract' ? 'selected' : ''}>Contract</option>
        </select>
        <select class="adm-input" name="job_type" onchange="this.form.submit()">
          <option value="">Any job type</option>
          ${JOB_TYPE_ORDER.map(t => `<option value="${t}" ${jobType === t ? 'selected' : ''}>${JOB_TYPE_META[t].icon} ${t}</option>`).join('')}
        </select>
        <button class="adm-btn adm-btn-primary" type="submit">Filter</button>
        ${(qText || category || remote || employment || jobType) ? `<a href="/admin/jobs" class="adm-btn">Clear</a>` : ''}
      </form>
    </div>

    <div class="adm-card" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="text-align:left;border-bottom:1.5px solid var(--border)">
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Job</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Location</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Category</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Remote</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Salary</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Posted</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Actions</th>
        </tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--ink3)">No jobs match these filters</td></tr>`}</tbody>
      </table>
    </div>

    ${totalPages > 1 ? `
    <div style="display:flex;justify-content:center;gap:8px;margin-top:16px">
      ${page > 1 ? `<a class="adm-btn" href="/admin/jobs?${qs({ page: page - 1 })}">← Prev</a>` : ''}
      <span class="adm-btn" style="cursor:default">Page ${page} of ${totalPages}</span>
      ${page < totalPages ? `<a class="adm-btn" href="/admin/jobs?${qs({ page: page + 1 })}">Next →</a>` : ''}
    </div>` : ''}
  </div>
  <script>
    function jnCopyLink(url){
      navigator.clipboard.writeText(url).then(function(){ if(window.jnToast) jnToast('Link copied'); });
    }
  </script>`;
}

export async function renderJobEditContent(env, id) {
  await ensureTable(env);
  const { results } = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).all();
  const j = results[0];
  if (!j) {
    return `<div class="adm-wrap"><div class="adm-card">Job not found. <a href="/admin/jobs">← Back to Job Management</a></div></div>`;
  }
  let skills = [];
  try { skills = JSON.parse(j.skills || '[]'); } catch (e) {}

  return `
  <div class="adm-wrap" style="max-width:680px">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">✏️ Edit Job</div>
        <div class="adm-sub">#${j.id} — ${escapeHtml(j.title)}</div>
      </div>
      <a href="/admin/jobs" class="adm-btn">← Back</a>
    </div>
    <form method="POST" action="/admin/jobs/update" class="adm-card" style="display:flex;flex-direction:column;gap:12px">
      <input type="hidden" name="id" value="${j.id}">
      <label style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Title
        <input class="adm-input" style="width:100%;margin-top:4px" name="title" value="${escapeHtml(j.title)}" required></label>
      <label style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Company
        <input class="adm-input" style="width:100%;margin-top:4px" name="company" value="${escapeHtml(j.company)}" required></label>
      <label style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Location
        <input class="adm-input" style="width:100%;margin-top:4px" name="location" value="${escapeHtml(j.location || '')}"></label>
      <label style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Apply URL
        <input class="adm-input" style="width:100%;margin-top:4px" name="url" value="${escapeHtml(j.url)}" required></label>
      <div style="display:flex;gap:10px">
        <label style="flex:1;font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Salary
          <input class="adm-input" style="width:100%;margin-top:4px" name="salary" value="${escapeHtml(j.salary || '')}" placeholder="e.g. $90k - $130k"></label>
        <label style="flex:1;font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Seniority
          <input class="adm-input" style="width:100%;margin-top:4px" name="seniority" value="${escapeHtml(j.seniority || '')}"></label>
      </div>
      <div style="display:flex;gap:10px">
        <label style="flex:1;font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Remote Type
          <select class="adm-input" style="width:100%;margin-top:4px" name="remote_type">
            <option value="" ${!j.remote_type ? 'selected' : ''}>—</option>
            <option value="fully_remote" ${j.remote_type === 'fully_remote' ? 'selected' : ''}>Fully remote</option>
            <option value="hybrid" ${j.remote_type === 'hybrid' ? 'selected' : ''}>Hybrid</option>
            <option value="on_site" ${j.remote_type === 'on_site' ? 'selected' : ''}>On-site</option>
          </select></label>
        <label style="flex:1;font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Employment Type
          <select class="adm-input" style="width:100%;margin-top:4px" name="employment_type">
            <option value="" ${!j.employment_type ? 'selected' : ''}>—</option>
            <option value="full_time" ${j.employment_type === 'full_time' ? 'selected' : ''}>Full-time</option>
            <option value="part_time" ${j.employment_type === 'part_time' ? 'selected' : ''}>Part-time</option>
            <option value="contract" ${j.employment_type === 'contract' ? 'selected' : ''}>Contract</option>
          </select></label>
      </div>
      <label style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Skills (comma-separated)
        <input class="adm-input" style="width:100%;margin-top:4px" name="skills" value="${escapeHtml(skills.join(', '))}"></label>
      <label style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Description
        <textarea class="adm-input" style="width:100%;margin-top:4px;min-height:160px;font-family:inherit" name="description">${escapeHtml(j.description || '')}</textarea></label>
      <div style="display:flex;gap:10px">
        <label style="flex:1;font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Job Type
          <select class="adm-input" style="width:100%;margin-top:4px" name="job_type">
            ${JOB_TYPE_ORDER.map(t => `<option value="${t}" ${(j.job_type || 'Free') === t ? 'selected' : ''}>${JOB_TYPE_META[t].icon} ${t}</option>`).join('')}
          </select></label>
        <label style="flex:2;font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Note <span style="color:var(--ink3);font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">(optional — shown for Sponsored)</span>
          <input class="adm-input" style="width:100%;margin-top:4px" name="job_type_note" value="${escapeHtml(j.job_type_note || '')}" maxlength="140" placeholder="One-line company blurb"></label>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2)">
        <input type="checkbox" name="featured" value="1" ${j.featured ? 'checked' : ''}> Pin this job to the top within its tier
      </label>
      <div style="display:flex;gap:10px;margin-top:6px">
        <button class="adm-btn adm-btn-primary" type="submit">Save Changes</button>
        <a href="/job/${j.id}" target="_blank" class="adm-btn">Preview Live</a>
      </div>
    </form>
  </div>`;
}

export async function renderDuplicatesContent(env) {
  await ensureTable(env);
  // DATA QUALITY: normalize dash-character variants (- – —) and trim
  // whitespace before grouping — cross-provider duplicates often differ
  // only in which dash character or how much padding a provider happens
  // to use (e.g. "Backend Engineer - Remote" vs "Backend Engineer — Remote"),
  // which the old exact LOWER(title) match missed entirely.
  const { results: groups } = await env.DB.prepare(`
    SELECT
      TRIM(REPLACE(REPLACE(LOWER(title), '–', '-'), '—', '-')) t,
      LOWER(TRIM(company)) c,
      GROUP_CONCAT(id) ids, COUNT(*) n
    FROM jobs GROUP BY t, c HAVING n > 1 ORDER BY n DESC LIMIT 50
  `).all();

  if (!groups || !groups.length) {
    return `<div class="adm-wrap"><div class="adm-hdr"><div class="adm-title">🔍 Possible Duplicates</div></div>
      <div class="adm-card"><div class="adm-empty">No duplicate title+company groups found. <a href="/admin/jobs">← Back to Job Management</a></div></div></div>`;
  }

  const ids = groups.flatMap(g => g.ids.split(',').map(Number));
  const placeholders = ids.map(() => '?').join(',');
  const { results: jobRows } = await env.DB.prepare(`SELECT * FROM jobs WHERE id IN (${placeholders})`).bind(...ids).all();
  const jobsById = Object.fromEntries((jobRows || []).map(j => [j.id, j]));

  const groupsHtml = groups.map(g => {
    const groupIds = g.ids.split(',').map(Number).sort((a, b) => b - a); // newest first
    return `<div class="adm-card" style="margin-bottom:12px">
      <div class="adm-card-title" style="text-transform:capitalize">${escapeHtml(jobsById[groupIds[0]]?.title || g.t)} <span style="color:var(--ink3);font-weight:400">at ${escapeHtml(jobsById[groupIds[0]]?.company || g.c)} — ${g.n} copies</span></div>
      ${groupIds.map((id, idx) => {
        const j = jobsById[id];
        if (!j) return '';
        return `<div class="adm-row">
          <span class="adm-row-label">#${id} ${idx === 0 ? '<span style="color:var(--green);font-weight:700">· newest, kept by default</span>' : ''} · ${j.created_at ? new Date(j.created_at).toLocaleDateString() : '—'} · <a href="/job/${id}" target="_blank" style="color:var(--brand)">preview</a></span>
          <form method="POST" action="/admin/jobs/delete" onsubmit="return confirm('Delete job #${id}?')" style="display:inline">
            <input type="hidden" name="id" value="${id}">
            <input type="hidden" name="redirect" value="/admin/jobs/duplicates">
            <button class="adm-btn-sm" type="submit">Delete</button>
          </form>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  return `<div class="adm-wrap">
    <div class="adm-hdr">
      <div><div class="adm-title">🔍 Possible Duplicates</div><div class="adm-sub">${groups.length} groups found — review before deleting, nothing is removed automatically</div></div>
      <a href="/admin/jobs" class="adm-btn">← Back</a>
    </div>
    ${groupsHtml}
  </div>`;
}
