// src/pages/company-dashboard.js
// Company (Employer) Dashboard — /company/dashboard, /company/profile,
// /company/jobs, /company/post-job, /company/members, /company/create.
// A user can belong to more than one company (plan §1/§13); every page
// here operates on ONE "active" company at a time, resolved by
// routes/company.router.js's resolveActiveCompany() and shown via a
// small switcher when the user has more than one.

import { baseLayout } from '../layout/base-layout.js';
import { dashboardShell, accountSwitchPill } from '../components/dashboard-shell.js';
import { csrfField } from '../lib/accounts/csrf.js';
import { escapeHtml } from '../lib/entities.js';
import { listCompanyMembers } from '../lib/companies.js';
import { BASE_URL } from '../config/constants.js';
import { CATEGORY_ORDER, CATEGORY_META, JOB_STATUS_META, POSTING_STATUS_META } from '../config/constants.js';
import {
  iconLayoutDashboard, iconBuilding, iconBriefcase, iconPlus, iconUsers,
} from '../assets/icons.js';

const NAV = [
  { id: 'overview', label: 'Overview', icon: iconLayoutDashboard, href: '/company/dashboard' },
  { id: 'profile', label: 'Company Profile', icon: iconBuilding, href: '/company/profile' },
  { id: 'jobs', label: 'Jobs', icon: iconBriefcase, href: '/company/jobs' },
  { id: 'post-job', label: 'Post a Job', icon: iconPlus, href: '/company/post-job' },
  { id: 'members', label: 'Team Members', icon: iconUsers, href: '/company/members' },
];

const STATUS_LABEL = { pending: 'Pending Review', active: 'Verified', rejected: 'Rejected', suspended: 'Suspended' };
const STATUS_CLASS = { pending: 'status-pending', active: 'status-active', rejected: 'status-rejected', suspended: 'status-suspended' };

function companySwitcher(companies, activeId) {
  if (companies.length <= 1) return '';
  return `<form method="GET" style="margin-bottom:14px">
    <select class="pj-select" name="company_id" onchange="this.form.submit()" style="max-width:280px">
      ${companies.map(c => `<option value="${c.id}" ${c.id === activeId ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.role)})</option>`).join('')}
    </select>
  </form>`;
}

function wrap(activeId, title, subtitle, content, user, ctx, headerActions = '') {
  const html = dashboardShell({ activeId, navItems: NAV, title, subtitle, content, headerActions, switchPill: accountSwitchPill('company', ctx.companies || []) });
  return baseLayout(`${title} — JobForion for Employers`, subtitle || 'Manage your company on JobForion.', `${BASE_URL}${NAV.find(n => n.id === activeId)?.href || '/company/dashboard'}`, '', html, '', 'noindex, follow', ctx?.settings, ctx?.categories, null, null, null, user);
}

// ── No company yet — prompt to create one ──────────────────────
export async function renderNoCompanyPage(user, ctx) {
  const content = `<div class="dash-card" style="text-align:center;padding:40px 24px">
    <div style="font-size:40px;margin-bottom:10px">🏢</div>
    <div style="font-size:16px;font-weight:800;color:var(--ink);margin-bottom:8px">You're not part of a company yet</div>
    <div style="font-size:13px;color:var(--ink2);margin-bottom:18px">Create a company profile to post jobs and manage applicants on JobForion.</div>
    <a href="/company/create" class="dash-btn dash-btn-primary">Create Company Profile →</a>
  </div>`;
  const html = dashboardShell({ activeId: '', navItems: [], title: 'Hire Talent', content });
  return baseLayout('Hire Talent — JobForion', 'Create a company profile on JobForion.', `${BASE_URL}/company/dashboard`, '', html, '', 'noindex, follow', ctx?.settings, ctx?.categories, null, null, null, user);
}

export async function renderCreateCompanyPage(user, ctx, { csrfToken, error } = {}) {
  const content = `
    ${error ? `<div class="auth-err">${escapeHtml(error)}</div>` : ''}
    <div class="dash-card" style="max-width:560px">
      <div class="dash-card-title">Create Company Profile</div>
      <form method="POST" action="/company/create">
        ${csrfField(csrfToken)}
        <div class="pj-group"><label class="pj-label">Company Name</label><input class="pj-input" name="name" required placeholder="Acme Inc."></div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">Website</label><input class="pj-input" type="url" name="website" placeholder="https://acme.com"></div>
          <div class="pj-group"><label class="pj-label">Industry</label><input class="pj-input" name="industry" placeholder="Software"></div>
        </div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">Country</label><input class="pj-input" name="country"></div>
          <div class="pj-group"><label class="pj-label">Company Size</label>
            <select class="pj-select" name="company_size"><option value="">Select…</option><option>1-10</option><option>11-50</option><option>51-200</option><option>201-1000</option><option>1000+</option></select></div>
        </div>
        <div class="pj-group"><label class="pj-label">Description</label><textarea class="pj-textarea" name="description" placeholder="What does your company do?"></textarea></div>
        <button class="pj-submit" type="submit">Create Company →</button>
      </form>
      <p style="font-size:11px;color:var(--ink3);margin-top:10px">Your company will be reviewed before job postings go live. You'll be the Company Admin.</p>
    </div>`;
  const html = dashboardShell({ activeId: '', navItems: [], title: 'Create Company Profile', content });
  return baseLayout('Create Company — JobForion', 'Create a company profile on JobForion.', `${BASE_URL}/company/create`, '', html, '', 'noindex, follow', ctx?.settings, ctx?.categories, null, null, null, user);
}

// ── Overview ────────────────────────────────────────────────────
export async function renderCompanyOverview(env, user, company, ctx) {
  const { results: jobStats } = await env.DB.prepare(
    `SELECT status, COUNT(*) c FROM jobs WHERE company_id = ? GROUP BY status`
  ).bind(company.id).all().catch(() => ({ results: [] }));
  const { results: pendingR } = await env.DB.prepare(
    `SELECT COUNT(*) c FROM job_postings WHERE company_id = ? AND status = 'pending'`
  ).bind(company.id).all().catch(() => ({ results: [{ c: 0 }] }));
  const active = (jobStats || []).find(s => s.status === 'active')?.c || 0;
  const members = await listCompanyMembers(env, company.id);

  const content = `
    ${companySwitcher(ctx.companies, company.id)}
    ${company.status !== 'active' ? `<div class="dash-card" style="border-color:rgba(245,166,35,.35);background:rgba(245,166,35,.06)">
      <div style="font-size:13px;font-weight:700;color:var(--ink)">⏳ Verification pending</div>
      <div style="font-size:12px;color:var(--ink2);margin-top:4px">An admin will review ${escapeHtml(company.name)} shortly. Job postings stay pending until your company is verified.</div>
    </div>` : ''}
    <div class="dash-kpi-grid">
      <div class="dash-kpi"><div class="dash-kpi-label">Published Jobs</div><div class="dash-kpi-val">${active}</div></div>
      <div class="dash-kpi"><div class="dash-kpi-label">Pending Review</div><div class="dash-kpi-val">${pendingR?.[0]?.c || 0}</div></div>
      <div class="dash-kpi"><div class="dash-kpi-label">Team Members</div><div class="dash-kpi-val">${members.length}</div></div>
      <div class="dash-kpi"><div class="dash-kpi-label">Status</div><div class="dash-kpi-val" style="font-size:14px"><span class="status-badge ${STATUS_CLASS[company.status] || 'status-pending'}">${STATUS_LABEL[company.status] || company.status}</span></div></div>
    </div>
    <div class="dash-card">
      <div class="dash-card-title">Quick Actions</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a href="/company/post-job" class="dash-btn dash-btn-primary">+ Post a Job</a>
        <a href="/company/profile" class="dash-btn">Edit Company Profile</a>
        <a href="/company/members" class="dash-btn">Manage Team</a>
      </div>
    </div>`;
  return wrap('overview', company.name, 'Company overview', content, user, ctx);
}

// ── Profile ─────────────────────────────────────────────────────
export async function renderCompanyProfilePage(user, company, ctx, { csrfToken, saved, canEdit, uploadError } = {}) {
  const content = `
    ${companySwitcher(ctx.companies, company.id)}
    ${saved ? `<div class="auth-ok">Company profile updated.</div>` : ''}
    ${uploadError ? `<div class="auth-err">${escapeHtml(uploadError)}</div>` : ''}
    ${canEdit ? `
    <div class="dash-card">
      <div class="dash-card-title">Logo &amp; Cover Image</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;margin-bottom:6px">Logo</div>
          ${company.logo_url ? `<img src="${escapeHtml(company.logo_url)}" alt="Logo" style="width:64px;height:64px;border-radius:12px;object-fit:contain;border:1px solid var(--border);margin-bottom:8px;display:block">` : ''}
          <form method="POST" action="/company/logo" enctype="multipart/form-data" style="display:flex;gap:6px;align-items:center">
            ${csrfField(csrfToken)}
            <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required style="font-size:11px;max-width:180px">
            <button class="dash-btn dash-btn-sm" type="submit">Upload</button>
          </form>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;margin-bottom:6px">Cover Image</div>
          ${company.cover_image_url ? `<img src="${escapeHtml(company.cover_image_url)}" alt="Cover" style="width:140px;height:56px;border-radius:8px;object-fit:cover;border:1px solid var(--border);margin-bottom:8px;display:block">` : ''}
          <form method="POST" action="/company/cover" enctype="multipart/form-data" style="display:flex;gap:6px;align-items:center">
            ${csrfField(csrfToken)}
            <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required style="font-size:11px;max-width:180px">
            <button class="dash-btn dash-btn-sm" type="submit">Upload</button>
          </form>
        </div>
      </div>
      <p style="font-size:11px;color:var(--ink3);margin-top:10px">PNG, JPEG or WebP, up to 2MB. Alternatively, paste a hosted image URL directly into the Logo URL field in your profile form below.</p>
    </div>` : ''}
    <form method="POST" action="/company/profile" class="dash-card">
      ${csrfField(csrfToken)}
      <div class="pj-group"><label class="pj-label">Company Name</label><input class="pj-input" name="name" value="${escapeHtml(company.name)}" ${canEdit ? '' : 'disabled'} required></div>
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">Website</label><input class="pj-input" type="url" name="website" value="${escapeHtml(company.website || '')}" ${canEdit ? '' : 'disabled'}></div>
        <div class="pj-group"><label class="pj-label">Industry</label><input class="pj-input" name="industry" value="${escapeHtml(company.industry || '')}" ${canEdit ? '' : 'disabled'}></div>
      </div>
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">Country</label><input class="pj-input" name="country" value="${escapeHtml(company.country || '')}" ${canEdit ? '' : 'disabled'}></div>
        <div class="pj-group"><label class="pj-label">City</label><input class="pj-input" name="city" value="${escapeHtml(company.city || '')}" ${canEdit ? '' : 'disabled'}></div>
      </div>
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">Company Size</label>
          <select class="pj-select" name="company_size" ${canEdit ? '' : 'disabled'}>
            <option value="">Select…</option>
            ${['1-10', '11-50', '51-200', '201-1000', '1000+'].map(s => `<option value="${s}" ${company.company_size === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="pj-group"><label class="pj-label">Founded Year</label><input class="pj-input" type="number" name="founded_year" min="1800" max="2100" value="${escapeHtml(company.founded_year || '')}" ${canEdit ? '' : 'disabled'}></div>
      </div>
      <div class="pj-group"><label class="pj-label">Headquarters</label><input class="pj-input" name="headquarters" value="${escapeHtml(company.headquarters || '')}" placeholder="e.g. San Francisco, CA, USA" ${canEdit ? '' : 'disabled'}></div>
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">Contact Email</label><input class="pj-input" type="email" name="contact_email" value="${escapeHtml(company.contact_email || '')}" ${canEdit ? '' : 'disabled'}></div>
        <div class="pj-group"><label class="pj-label">Phone</label><input class="pj-input" type="tel" name="phone" value="${escapeHtml(company.phone || '')}" ${canEdit ? '' : 'disabled'}></div>
      </div>
      <div class="pj-group"><label class="pj-label">Logo URL <span style="font-weight:400;color:var(--ink3)">(or upload above)</span></label><input class="pj-input" type="url" name="logo_url" value="${escapeHtml(company.logo_url || '')}" ${canEdit ? '' : 'disabled'}></div>
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">LinkedIn URL</label><input class="pj-input" type="url" name="linkedin_url" value="${escapeHtml(company.linkedin_url || '')}" ${canEdit ? '' : 'disabled'}></div>
        <div class="pj-group"><label class="pj-label">Twitter / X URL</label><input class="pj-input" type="url" name="twitter_url" value="${escapeHtml(company.twitter_url || '')}" ${canEdit ? '' : 'disabled'}></div>
      </div>
      <div class="pj-group"><label class="pj-label">Facebook URL</label><input class="pj-input" type="url" name="facebook_url" value="${escapeHtml(company.facebook_url || '')}" ${canEdit ? '' : 'disabled'}></div>
      <div class="pj-group"><label class="pj-label">Description</label><textarea class="pj-textarea" name="description" ${canEdit ? '' : 'disabled'}>${escapeHtml(company.description || '')}</textarea></div>
      ${canEdit ? `<button class="pj-submit" type="submit" style="max-width:200px">Save Changes</button>` : `<div style="font-size:12px;color:var(--ink3)">Only Company Admins can edit the profile.</div>`}
    </form>
    <div class="dash-card">
      <div class="dash-row"><span class="dash-row-main">Public page</span><a href="/companies/${escapeHtml(company.slug)}" class="dash-btn dash-btn-sm">View Public Profile →</a></div>
    </div>`;
  return wrap('profile', 'Company Profile', company.name, content, user, ctx);
}

// ── Jobs ────────────────────────────────────────────────────────
const JOB_TAB_STATUSES = ['', 'pending', 'draft', 'active', 'rejected', 'paused', 'closed', 'expired', 'archived'];
const JOB_TAB_LABELS = { '': 'All', pending: 'Pending', draft: 'Draft', active: 'Published', rejected: 'Rejected', paused: 'Paused', closed: 'Closed', expired: 'Expired', archived: 'Archived' };

export async function renderCompanyJobsPage(env, user, company, ctx, statusFilter = '', csrfToken = '') {
  // job_postings (pre-approval: draft/pending/rejected) and jobs
  // (post-approval: active/paused/closed/expired/archived) are two
  // different tables with disjoint status vocabularies (see
  // JOB_STATUS_META vs POSTING_STATUS_META in config/constants.js) — the
  // tab filter has to route to the right table rather than one combined
  // query. 'active' here means "Published" in the tab label (see
  // constants.js's comment on why the stored value stays 'active').
  const wantsPostings = statusFilter === '' || ['pending', 'draft', 'rejected'].includes(statusFilter);
  const wantsJobs = statusFilter === '' || ['active', 'paused', 'closed', 'expired', 'archived'].includes(statusFilter);
  const postingsWhere = statusFilter && wantsPostings && statusFilter !== '' ? `AND status = ?` : `AND status != 'approved'`;
  const jobsWhere = statusFilter && wantsJobs ? `AND status = ?` : '';

  const [{ results: liveJobs }, { results: pendingJobs }] = await Promise.all([
    wantsJobs
      ? env.DB.prepare(`SELECT * FROM jobs WHERE company_id = ? ${jobsWhere} ORDER BY id DESC LIMIT 100`).bind(...(jobsWhere ? [company.id, statusFilter] : [company.id])).all()
      : Promise.resolve({ results: [] }),
    wantsPostings
      ? env.DB.prepare(`SELECT * FROM job_postings WHERE company_id = ? ${postingsWhere} ORDER BY id DESC LIMIT 50`).bind(...(postingsWhere.includes('?') ? [company.id, statusFilter] : [company.id])).all()
      : Promise.resolve({ results: [] }),
  ]);

  // Views + applications in two flat bulk queries instead of one query
  // per job (plan §30's explicit N+1 warning) — this stays exactly two
  // queries whether the company has 3 jobs or 300.
  const jobIds = (liveJobs || []).map(j => j.id);
  let viewsByPath = {}, appsByJobId = {};
  if (jobIds.length) {
    const placeholders = jobIds.map(() => '?').join(',');
    const jobPaths = jobIds.map(id => `/job/${id}`);
    const [{ results: viewRows }, { results: appRows }] = await Promise.all([
      env.DB.prepare(`SELECT path, COUNT(*) c FROM visits WHERE path IN (${placeholders}) GROUP BY path`).bind(...jobPaths).all(),
      env.DB.prepare(`SELECT job_id, COUNT(*) c FROM applications WHERE job_id IN (${placeholders}) GROUP BY job_id`).bind(...jobIds).all(),
    ]);
    viewsByPath = Object.fromEntries((viewRows || []).map(r => [r.path, r.c]));
    appsByJobId = Object.fromEntries((appRows || []).map(r => [r.job_id, r.c]));
  }

  const tabsHtml = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
    ${JOB_TAB_STATUSES.map(s => `<a href="/company/jobs${s ? '?status=' + s : ''}" class="dash-btn ${statusFilter === s ? 'dash-btn-primary' : ''}" style="padding:7px 14px;font-size:12.5px">${JOB_TAB_LABELS[s]}</a>`).join('')}
  </div>`;

  const jobActionsHtml = (j) => {
    const btn = (action, label) => `<form method="POST" action="/company/jobs/${j.id}/${action}" style="display:inline">${csrfField(csrfToken)}<button class="dash-btn-sm" type="submit">${label}</button></form>`;
    const parts = [`<a href="/job/${j.id}" target="_blank" class="dash-btn-sm">View</a>`];
    if (j.status === 'active') parts.push(btn('pause', 'Pause'), btn('close', 'Close'));
    else if (j.status === 'paused') parts.push(btn('resume', 'Resume'), btn('close', 'Close'));
    else if (j.status === 'closed') parts.push(btn('resume', 'Resume'));
    if (['active', 'paused', 'closed', 'expired'].includes(j.status)) parts.push(btn('archive', 'Archive'));
    return parts.join('');
  };

  const liveRows = (liveJobs || []).length ? (liveJobs || []).map(j => {
    const meta = JOB_STATUS_META[j.status] || { label: j.status, color: 'var(--ink3)' };
    return `<div class="dash-row" style="flex-wrap:wrap;gap:8px">
      <div style="flex:1;min-width:200px"><div class="dash-row-main">${escapeHtml(j.title)}</div><div class="dash-row-sub">${escapeHtml(j.location || 'Remote')}${j.salary ? ' · ' + escapeHtml(j.salary) : ''} · Updated ${new Date(j.updated_at || j.created_at).toLocaleDateString()}</div></div>
      <div style="display:flex;align-items:center;gap:14px;font-size:11.5px;color:var(--ink3)">
        <span>👁 ${viewsByPath['/job/' + j.id] || 0} views</span>
        <span>📋 ${appsByJobId[j.id] || 0} applications</span>
        <span class="status-badge" style="background:${meta.color}22;color:${meta.color}">${meta.label}</span>
      </div>
      <div style="display:flex;gap:6px">${jobActionsHtml(j)}</div>
    </div>`;
  }).join('') : `<div class="dash-empty">No jobs in this view. <a href="/company/post-job" style="color:var(--brand)">Post your first job</a>.</div>`;

  const pendingRows = (pendingJobs || []).length ? (pendingJobs || []).map(p => {
    const meta = POSTING_STATUS_META[p.status] || { label: p.status, color: 'var(--ink3)' };
    return `<div class="dash-row">
      <div><div class="dash-row-main">${escapeHtml(p.title)}</div><div class="dash-row-sub">Submitted ${new Date(p.created_at).toLocaleDateString()}${p.status === 'rejected' && p.rejection_reason ? ' · ' + escapeHtml(p.rejection_reason) : ''}</div></div>
      <span class="status-badge" style="background:${meta.color}22;color:${meta.color}">${meta.label}</span>
    </div>`;
  }).join('') : `<div class="dash-empty">Nothing here.</div>`;

  const showPendingCard = wantsPostings;
  const showLiveCard = wantsJobs;

  const content = `
    ${companySwitcher(ctx.companies, company.id)}
    ${tabsHtml}
    ${showPendingCard ? `<div class="dash-card">
      <div class="dash-card-title">${statusFilter ? JOB_TAB_LABELS[statusFilter] : 'Pending Review'} ${pendingJobs?.length ? `(${pendingJobs.length})` : ''}</div>
      ${pendingRows}
    </div>` : ''}
    ${showLiveCard ? `<div class="dash-card">
      <div class="dash-card-title">${statusFilter ? JOB_TAB_LABELS[statusFilter] : 'Published Jobs'} (${(liveJobs || []).length})</div>
      ${liveRows}
    </div>` : ''}`;
  return wrap('jobs', 'Jobs', `${(liveJobs || []).length} published · ${(pendingJobs || []).length} pending`, content, user, ctx, `<a href="/company/post-job" class="dash-btn dash-btn-primary">+ Post a Job</a>`);
}

// ── Post a Job ──────────────────────────────────────────────────
const SENIORITY_LEVELS = ['Junior', 'Mid', 'Senior', 'Lead']; // matches the exact options in pages/home.js's #fSeniority filter, so a posted job is actually findable via that filter
const SALARY_CURRENCIES = ['$', '€', '£', 'C$', 'A$']; // matches lib/salary.js's CURRENCY_TO_USD keys exactly (lowercased there) — must stay in sync if that map ever changes
const SALARY_PERIODS = [['year', 'per year'], ['month', 'per month'], ['hour', 'per hour']];

export async function renderCompanyPostJobPage(user, company, ctx, { csrfToken, error, submitted, canPost, formValues = {} } = {}) {
  const v = (name, fallback = '') => escapeHtml(formValues[name] ?? fallback);
  const skillsInitial = Array.isArray(formValues.skills) ? formValues.skills : [];
  const content = `
    ${companySwitcher(ctx.companies, company.id)}
    ${submitted ? `<div class="auth-ok">Job submitted for review. It will go live once approved — usually within 24 hours.</div>` : ''}
    ${error ? `<div class="auth-err">${escapeHtml(error)}</div>` : ''}
    ${!canPost ? `<div class="dash-card" style="border-color:rgba(255,92,122,.3)"><div style="font-size:13px;color:var(--coral);font-weight:700">You don't have permission to post jobs for this company.</div><div style="font-size:12px;color:var(--ink3);margin-top:4px">Ask a Company Admin to add you as a Recruiter or Admin.</div></div>` : `
    <form method="POST" action="/company/post-job" class="pj-pro-form" id="postJobForm">
      ${csrfField(csrfToken)}
      <div class="dash-card">
        <div class="dash-card-title">Job Details</div>
        <div class="pj-group"><label class="pj-label">Job Title</label><input class="pj-input" name="title" required maxlength="150" placeholder="Senior Backend Engineer" value="${v('title')}"></div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">Category</label>
            <select class="pj-select" name="category">${CATEGORY_ORDER.map(k => `<option value="${k}" ${formValues.category === k ? 'selected' : ''}>${CATEGORY_META[k].label}</option>`).join('')}</select></div>
          <div class="pj-group"><label class="pj-label">Seniority Level</label>
            <select class="pj-select" name="seniority"><option value="">Not specified</option>${SENIORITY_LEVELS.map(s => `<option value="${s}" ${formValues.seniority === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        </div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">Employment Type</label>
            <select class="pj-select" name="employment_type">
              <option value="full_time" ${!formValues.employment_type || formValues.employment_type === 'full_time' ? 'selected' : ''}>Full-time</option>
              <option value="part_time" ${formValues.employment_type === 'part_time' ? 'selected' : ''}>Part-time</option>
              <option value="contract" ${formValues.employment_type === 'contract' ? 'selected' : ''}>Contract</option>
              <option value="internship" ${formValues.employment_type === 'internship' ? 'selected' : ''}>Internship</option>
            </select></div>
          <div class="pj-group"><label class="pj-label">Remote Type</label>
            <select class="pj-select" name="remote_type">
              <option value="fully_remote" ${!formValues.remote_type || formValues.remote_type === 'fully_remote' ? 'selected' : ''}>Fully Remote</option>
              <option value="hybrid" ${formValues.remote_type === 'hybrid' ? 'selected' : ''}>Hybrid</option>
              <option value="on_site" ${formValues.remote_type === 'on_site' ? 'selected' : ''}>On-site</option>
            </select></div>
        </div>
        <div class="pj-group"><label class="pj-label">Location</label><input class="pj-input" name="location" maxlength="100" placeholder="Remote / Anywhere, or a city for hybrid/on-site" value="${v('location')}"></div>
        <div class="pj-group"><label class="pj-label">Apply URL</label><input class="pj-input" type="url" name="url" required maxlength="400" placeholder="https://acme.com/careers/123" value="${v('url')}"></div>
      </div>

      <div class="dash-card">
        <div class="dash-card-title">Compensation <span style="font-weight:400;color:var(--ink3);font-size:12px">(optional, but listings with salary get 2-3× more applicants)</span></div>
        <div class="pj-row" style="grid-template-columns:80px 1fr 1fr 1fr">
          <div class="pj-group"><label class="pj-label">Currency</label>
            <select class="pj-select" name="salary_currency">${SALARY_CURRENCIES.map(c => `<option value="${c}" ${formValues.salary_currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="pj-group"><label class="pj-label">Min</label><input class="pj-input" type="number" name="salary_min" min="0" step="1" placeholder="90000" value="${v('salary_min')}"></div>
          <div class="pj-group"><label class="pj-label">Max</label><input class="pj-input" type="number" name="salary_max" min="0" step="1" placeholder="130000" value="${v('salary_max')}"></div>
          <div class="pj-group"><label class="pj-label">Period</label>
            <select class="pj-select" name="salary_period">${SALARY_PERIODS.map(([val, lbl]) => `<option value="${val}" ${formValues.salary_period === val ? 'selected' : ''}>${lbl}</option>`).join('')}</select></div>
        </div>
        <p style="font-size:11px;color:var(--ink3);margin-top:-6px">Leave Min/Max blank to post without a salary range.</p>
      </div>

      <div class="dash-card">
        <div class="dash-card-title">Requirements</div>
        <div class="pj-group">
          <label class="pj-label">Skills <span style="font-weight:400;color:var(--ink3);text-transform:none;letter-spacing:0;font-size:11px">(press Enter to add, up to 15)</span></label>
          <input class="pj-input" type="text" id="skillInput" placeholder="e.g. React, PostgreSQL, AWS...">
          <div id="skillsWrap" style="margin-top:8px"></div>
          <input type="hidden" name="skills" id="skillsHidden" value="${escapeHtml(JSON.stringify(skillsInitial))}">
        </div>
        <div class="pj-group"><label class="pj-label">Description</label><textarea class="pj-textarea" name="description" id="descInput" maxlength="4000" style="min-height:200px" placeholder="Responsibilities, requirements, benefits... Use blank lines between paragraphs — formatting is preserved.">${v('description')}</textarea>
          <div id="descCounter" style="font-size:11px;color:var(--ink3);text-align:right;margin-top:4px">0 / 4000</div>
        </div>
      </div>

      <button class="pj-submit" type="submit">Submit for Review →</button>
    </form>
    <style>
      .pj-pro-form .dash-card{margin-bottom:14px}
      .skill-chip{display:inline-flex;align-items:center;gap:6px;background:var(--brand-soft);border:1px solid rgba(53,86,255,.2);color:var(--brand);padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;margin:0 6px 6px 0}
      .skill-chip button{background:none;border:none;color:var(--brand);cursor:pointer;font-size:14px;line-height:1;padding:0;opacity:.7}
      .skill-chip button:hover{opacity:1}
    </style>
    <script>
    (function(){
      var skills = ${JSON.stringify(skillsInitial).replace(/</g, '\\u003c')};
      var wrap = document.getElementById('skillsWrap');
      var hidden = document.getElementById('skillsHidden');
      var input = document.getElementById('skillInput');
      function render(){
        wrap.innerHTML = skills.map(function(s, i){
          return '<span class="skill-chip">' + s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '<button type="button" data-i="'+i+'">×</button></span>';
        }).join('');
        hidden.value = JSON.stringify(skills);
        wrap.querySelectorAll('button[data-i]').forEach(function(btn){
          btn.addEventListener('click', function(){ skills.splice(parseInt(btn.dataset.i, 10), 1); render(); });
        });
      }
      input.addEventListener('keydown', function(e){
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var val = input.value.trim().slice(0, 40);
        if (val && skills.length < 15 && skills.indexOf(val) === -1) { skills.push(val); render(); }
        input.value = '';
      });
      render();
      var desc = document.getElementById('descInput');
      var counter = document.getElementById('descCounter');
      function updateCounter(){ counter.textContent = desc.value.length + ' / 4000'; }
      desc.addEventListener('input', updateCounter);
      updateCounter();
      document.getElementById('postJobForm').addEventListener('submit', function(){ hidden.value = JSON.stringify(skills); });
    })();
    </script>`}`;
  return wrap('post-job', 'Post a Job', `Posting as ${company.name}`, content, user, ctx);
}

// ── Members ─────────────────────────────────────────────────────
const ROLE_LABEL = { admin: 'Company Admin', recruiter: 'Recruiter', member: 'Member' };
export async function renderCompanyMembersPage(env, user, company, ctx, { csrfToken, error, canManage } = {}) {
  const members = await listCompanyMembers(env, company.id);
  const content = `
    ${companySwitcher(ctx.companies, company.id)}
    ${error ? `<div class="auth-err">${escapeHtml(error)}</div>` : ''}
    ${canManage ? `<div class="dash-card">
      <div class="dash-card-title">Add Team Member</div>
      <form method="POST" action="/company/members/add" style="display:flex;gap:8px;flex-wrap:wrap">
        ${csrfField(csrfToken)}
        <input class="pj-input" type="email" name="email" required placeholder="teammate@company.com" style="flex:1;min-width:200px">
        <select class="pj-select" name="role"><option value="member">Member</option><option value="recruiter">Recruiter</option><option value="admin">Company Admin</option></select>
        <button class="pj-submit" type="submit" style="max-width:160px">+ Add</button>
      </form>
      <p style="font-size:11px;color:var(--ink3);margin-top:8px">The teammate must already have a JobForion account with this email.</p>
    </div>` : ''}
    <div class="dash-card">
      <div class="dash-card-title">Team (${members.length})</div>
      ${members.map(m => `<div class="dash-row">
        <div><div class="dash-row-main">${escapeHtml(m.email)}</div><div class="dash-row-sub">Joined ${new Date(m.created_at).toLocaleDateString()}</div></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="role-badge role-badge-${m.role}">${ROLE_LABEL[m.role] || m.role}</span>
          ${canManage && m.user_id !== user.id ? `<form method="POST" action="/company/members/remove" onsubmit="return confirm('Remove this member?')">${csrfField(csrfToken)}<input type="hidden" name="user_id" value="${m.user_id}"><button class="dash-btn dash-btn-sm dash-btn-danger" type="submit">Remove</button></form>` : ''}
        </div>
      </div>`).join('')}
    </div>`;
  return wrap('members', 'Team Members', company.name, content, user, ctx);
}
