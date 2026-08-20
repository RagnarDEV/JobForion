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
import { CATEGORY_ORDER, CATEGORY_META } from '../config/constants.js';
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
export async function renderCompanyJobsPage(env, user, company, ctx) {
  const [{ results: liveJobs }, { results: pendingJobs }] = await Promise.all([
    env.DB.prepare(`SELECT * FROM jobs WHERE company_id = ? ORDER BY id DESC LIMIT 100`).bind(company.id).all(),
    env.DB.prepare(`SELECT * FROM job_postings WHERE company_id = ? AND status != 'approved' ORDER BY id DESC LIMIT 50`).bind(company.id).all(),
  ]);

  const content = `
    ${companySwitcher(ctx.companies, company.id)}
    <div class="dash-card">
      <div class="dash-card-title">Pending Review ${pendingJobs?.length ? `(${pendingJobs.length})` : ''}</div>
      ${(pendingJobs || []).length ? pendingJobs.map(p => `<div class="dash-row">
        <div><div class="dash-row-main">${escapeHtml(p.title)}</div><div class="dash-row-sub">Submitted ${new Date(p.created_at).toLocaleDateString()}</div></div>
        <span class="status-badge ${p.status === 'rejected' ? 'status-rejected' : 'status-pending'}">${p.status === 'rejected' ? 'Rejected' : 'Pending Review'}</span>
      </div>`).join('') : `<div class="dash-empty">Nothing pending review.</div>`}
    </div>
    <div class="dash-card">
      <div class="dash-card-title">Published Jobs (${(liveJobs || []).length})</div>
      ${(liveJobs || []).length ? liveJobs.map(j => `<div class="dash-row">
        <div><div class="dash-row-main"><a href="/job/${j.id}" style="color:inherit">${escapeHtml(j.title)}</a></div><div class="dash-row-sub">${escapeHtml(j.location || 'Remote')}${j.salary ? ' · ' + escapeHtml(j.salary) : ''}</div></div>
        <span class="status-badge status-active">${escapeHtml(j.status)}</span>
      </div>`).join('') : `<div class="dash-empty">No published jobs yet. <a href="/company/post-job" style="color:var(--brand)">Post your first job</a>.</div>`}
    </div>`;
  return wrap('jobs', 'Jobs', `${(liveJobs || []).length} published · ${(pendingJobs || []).length} pending`, content, user, ctx, `<a href="/company/post-job" class="dash-btn dash-btn-primary">+ Post a Job</a>`);
}

// ── Post a Job ──────────────────────────────────────────────────
export async function renderCompanyPostJobPage(user, company, ctx, { csrfToken, error, submitted, canPost } = {}) {
  const content = `
    ${companySwitcher(ctx.companies, company.id)}
    ${submitted ? `<div class="auth-ok">Job submitted for review. It will go live once approved.</div>` : ''}
    ${error ? `<div class="auth-err">${escapeHtml(error)}</div>` : ''}
    ${!canPost ? `<div class="dash-card" style="border-color:rgba(255,92,122,.3)"><div style="font-size:13px;color:var(--coral);font-weight:700">You don't have permission to post jobs for this company.</div><div style="font-size:12px;color:var(--ink3);margin-top:4px">Ask a Company Admin to add you as a Recruiter or Admin.</div></div>` : `
    <form method="POST" action="/company/post-job" class="dash-card">
      ${csrfField(csrfToken)}
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">Job Title</label><input class="pj-input" name="title" required placeholder="Senior Backend Engineer"></div>
        <div class="pj-group"><label class="pj-label">Apply URL</label><input class="pj-input" type="url" name="url" required placeholder="https://acme.com/careers/123"></div>
      </div>
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">Location</label><input class="pj-input" name="location" placeholder="Remote / Anywhere"></div>
        <div class="pj-group"><label class="pj-label">Salary Range</label><input class="pj-input" name="salary" placeholder="$90k - $130k"></div>
      </div>
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">Category</label>
          <select class="pj-select" name="category">${CATEGORY_ORDER.map(k => `<option value="${k}">${CATEGORY_META[k].label}</option>`).join('')}</select></div>
        <div class="pj-group"><label class="pj-label">Remote Type</label>
          <select class="pj-select" name="remote_type"><option value="fully_remote">Fully Remote</option><option value="hybrid">Hybrid</option><option value="on_site">On-site</option></select></div>
      </div>
      <div class="pj-group"><label class="pj-label">Description</label><textarea class="pj-textarea" name="description" placeholder="Role responsibilities, requirements, benefits..."></textarea></div>
      <button class="pj-submit" type="submit">Submit for Review →</button>
    </form>`}`;
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
