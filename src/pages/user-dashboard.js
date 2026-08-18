// src/pages/user-dashboard.js
// Job Seeker Dashboard — /user/dashboard, /user/profile, /user/saved-jobs,
// /user/applications, /user/job-alerts, /user/settings. Each render*
// function returns a FULL page (already wrapped in baseLayout); the
// router (routes/user.router.js) just returns `new Response(html)`.

import { baseLayout } from '../layout/base-layout.js';
import { dashboardShell, accountSwitchPill } from '../components/dashboard-shell.js';
import { jobRowMini } from '../components/job-card.js';
import { csrfField } from '../lib/accounts/csrf.js';
import { escapeHtml } from '../lib/entities.js';
import { getUserProfile } from '../lib/users.js';
import { listSavedJobs, countSavedJobs } from '../lib/saved-jobs.js';
import { listApplications, countApplications } from '../lib/applications.js';
import { listJobAlerts } from '../lib/job-alerts.js';
import { listUserCompanies } from '../lib/accounts/permissions.js';
import { listSessions } from '../lib/accounts/session.js';
import { BASE_URL } from '../config/constants.js';
import {
  iconLayoutDashboard, iconUser, iconBookmark, iconBriefcase, iconBell, iconSettingsGear,
} from '../assets/icons.js';

const NAV = [
  { id: 'overview', label: 'Overview', icon: iconLayoutDashboard, href: '/user/dashboard' },
  { id: 'profile', label: 'My Profile', icon: iconUser, href: '/user/profile' },
  { id: 'saved', label: 'Saved Jobs', icon: iconBookmark, href: '/user/saved-jobs' },
  { id: 'applications', label: 'Applications', icon: iconBriefcase, href: '/user/applications' },
  { id: 'alerts', label: 'Job Alerts', icon: iconBell, href: '/user/job-alerts' },
  { id: 'settings', label: 'Account Settings', icon: iconSettingsGear, href: '/user/settings' },
];

async function shellCtx(env, user, activeId) {
  const companies = await listUserCompanies(env, user.id);
  return { switchPill: accountSwitchPill('user', companies), companies };
}

function wrap(activeId, title, subtitle, content, switchPill, user, ctx) {
  const html = dashboardShell({ activeId, navItems: NAV, title, subtitle, content, switchPill });
  return baseLayout(`${title} — JobForion`, subtitle || 'Manage your JobForion account.', `${BASE_URL}${NAV.find(n => n.id === activeId)?.href || '/user/dashboard'}`, '', html, '', 'noindex, follow', ctx?.settings, ctx?.categories, null, null, null, user);
}

// ── Overview ────────────────────────────────────────────────────
export async function renderUserOverview(env, user, ctx) {
  const [profile, savedCount, appCount, alerts, { companies, switchPill }] = await Promise.all([
    getUserProfile(env, user.id), countSavedJobs(env, user.id), countApplications(env, user.id),
    listJobAlerts(env, user.id), shellCtx(env, user, 'overview'),
  ]);
  const profileComplete = profile?.full_name && profile?.job_title;

  const content = `
    <div class="dash-kpi-grid">
      <div class="dash-kpi"><div class="dash-kpi-label">Saved Jobs</div><div class="dash-kpi-val">${savedCount}</div></div>
      <div class="dash-kpi"><div class="dash-kpi-label">Applications</div><div class="dash-kpi-val">${appCount}</div></div>
      <div class="dash-kpi"><div class="dash-kpi-label">Active Alerts</div><div class="dash-kpi-val">${alerts.filter(a => a.active).length}</div></div>
      <div class="dash-kpi"><div class="dash-kpi-label">Companies</div><div class="dash-kpi-val">${companies.length}</div></div>
    </div>
    ${!profileComplete ? `<div class="dash-card" style="border-color:rgba(37,99,235,.3);background:var(--brand-soft)">
      <div style="font-size:13px;font-weight:700;color:var(--ink);margin-bottom:4px">👋 Complete your profile</div>
      <div style="font-size:12.5px;color:var(--ink2);margin-bottom:10px">A complete profile helps you get better job recommendations and makes applying faster.</div>
      <a href="/user/profile" class="dash-btn dash-btn-primary">Complete Profile →</a>
    </div>` : ''}
    <div class="dash-card">
      <div class="dash-card-title">Account</div>
      <div class="dash-row"><span class="dash-row-main">${escapeHtml(user.email)}</span><span class="status-badge ${user.email_verified ? 'status-active' : 'status-pending'}">${user.email_verified ? 'Verified' : 'Unverified'}</span></div>
      ${!user.email_verified ? `<div style="font-size:11.5px;color:var(--ink3);margin-top:6px">Check your inbox for a verification link, or resend it from <a href="/user/settings" style="color:var(--brand)">Account Settings</a>.</div>` : ''}
    </div>
    ${!companies.length ? `<div class="dash-card">
      <div class="dash-card-title">Hiring?</div>
      <div style="font-size:12.5px;color:var(--ink2);margin-bottom:10px">Create a company profile to post jobs and manage applicants.</div>
      <a href="/company/create" class="dash-btn">Create Company Profile →</a>
    </div>` : ''}`;

  return wrap('overview', 'Overview', `Welcome back, ${profile?.full_name || user.email}`, content, switchPill, user, ctx);
}

// ── Profile ─────────────────────────────────────────────────────
export async function renderUserProfile(env, user, ctx, { csrfToken, saved, error } = {}) {
  const [profile, { switchPill }] = await Promise.all([getUserProfile(env, user.id), shellCtx(env, user, 'profile')]);
  const p = profile || {};

  const content = `
    ${saved ? `<div class="auth-ok">Profile updated.</div>` : ''}
    ${error ? `<div class="auth-err">${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/user/profile" class="dash-card">
      ${csrfField(csrfToken)}
      <div class="dash-card-title">Basic Info</div>
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">Full Name</label><input class="pj-input" name="full_name" value="${escapeHtml(p.full_name || '')}"></div>
        <div class="pj-group"><label class="pj-label">Job Title</label><input class="pj-input" name="job_title" value="${escapeHtml(p.job_title || '')}" placeholder="e.g. Senior Frontend Developer"></div>
      </div>
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">Country</label><input class="pj-input" name="country" value="${escapeHtml(p.country || '')}"></div>
        <div class="pj-group"><label class="pj-label">City</label><input class="pj-input" name="city" value="${escapeHtml(p.city || '')}"></div>
      </div>
      <div class="pj-group"><label class="pj-label">Bio</label><textarea class="pj-textarea" name="bio" placeholder="A short summary about you">${escapeHtml(p.bio || '')}</textarea></div>
      <div class="dash-card-title" style="margin-top:6px">Skills &amp; Links</div>
      <div class="pj-group"><label class="pj-label">Skills (comma-separated)</label><input class="pj-input" name="skills" value="${escapeHtml((p.skills || []).join(', '))}" placeholder="React, Python, SQL"></div>
      <div class="pj-row">
        <div class="pj-group"><label class="pj-label">LinkedIn URL</label><input class="pj-input" type="url" name="linkedin_url" value="${escapeHtml(p.linkedin_url || '')}"></div>
        <div class="pj-group"><label class="pj-label">Portfolio URL</label><input class="pj-input" type="url" name="portfolio_url" value="${escapeHtml(p.portfolio_url || '')}"></div>
      </div>
      <div class="pj-group"><label class="pj-label">Resume / CV Link</label><input class="pj-input" type="url" name="resume_url" value="${escapeHtml(p.resume_url || '')}" placeholder="Link to a hosted PDF (Google Drive, Dropbox, etc.)"></div>
      <button class="pj-submit" type="submit" style="max-width:220px">Save Profile</button>
    </form>`;

  return wrap('profile', 'My Profile', 'This information helps tailor job recommendations.', content, switchPill, user, ctx);
}

// ── Saved Jobs ──────────────────────────────────────────────────
export async function renderSavedJobs(env, user, ctx) {
  const [jobs, { switchPill }] = await Promise.all([listSavedJobs(env, user.id, { limit: 50 }), shellCtx(env, user, 'saved')]);
  const content = `<div class="dash-card">
    ${jobs.length ? `<div class="related-grid">${jobs.map(jobRowMini).join('')}</div>` : `<div class="dash-empty">No saved jobs yet. Tap the bookmark icon on any job to save it here.</div>`}
  </div>`;
  return wrap('saved', 'Saved Jobs', `${jobs.length} job${jobs.length === 1 ? '' : 's'} saved`, content, switchPill, user, ctx);
}

// ── Applications ────────────────────────────────────────────────
const APP_STATUS_LABEL = { saved: 'Saved', applied: 'Applied', viewed: 'Viewed', interview: 'Interview', rejected: 'Rejected', hired: 'Hired' };
export async function renderApplications(env, user, ctx) {
  const [apps, { switchPill }] = await Promise.all([listApplications(env, user.id, { limit: 50 }), shellCtx(env, user, 'applications')]);
  const content = `<div class="dash-card">
    ${apps.length ? apps.map(a => `<div class="dash-row">
      <div><div class="dash-row-main"><a href="/job/${a.job_id}" style="color:inherit">${escapeHtml(a.title)}</a></div><div class="dash-row-sub">${escapeHtml(a.company)}${a.location ? ' · ' + escapeHtml(a.location) : ''}</div></div>
      <span class="status-badge status-active">${APP_STATUS_LABEL[a.status] || a.status}</span>
    </div>`).join('') : `<div class="dash-empty">No applications tracked yet. Applications you make through JobForion will appear here.</div>`}
  </div>`;
  return wrap('applications', 'Applications', `${apps.length} tracked`, content, switchPill, user, ctx);
}

// ── Job Alerts ──────────────────────────────────────────────────
export async function renderJobAlerts(env, user, ctx, { csrfToken, error } = {}) {
  const [alerts, { switchPill }] = await Promise.all([listJobAlerts(env, user.id), shellCtx(env, user, 'alerts')]);
  const content = `
    ${error ? `<div class="auth-err">${escapeHtml(error)}</div>` : ''}
    <div class="dash-card">
      <div class="dash-card-title">Create New Alert</div>
      <form method="POST" action="/user/job-alerts">
        ${csrfField(csrfToken)}
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">Keywords</label><input class="pj-input" name="keywords" placeholder="e.g. React, remote"></div>
          <div class="pj-group"><label class="pj-label">Country</label><input class="pj-input" name="country" placeholder="Any"></div>
        </div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">Remote Type</label>
            <select class="pj-select" name="remote_type"><option value="">Any</option><option value="fully_remote">Fully Remote</option><option value="hybrid">Hybrid</option><option value="on_site">On-site</option></select></div>
          <div class="pj-group"><label class="pj-label">Frequency</label>
            <select class="pj-select" name="frequency"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="instant">Instant</option></select></div>
        </div>
        <button class="pj-submit" type="submit" style="max-width:200px">+ Create Alert</button>
      </form>
    </div>
    <div class="dash-card">
      <div class="dash-card-title">Your Alerts</div>
      ${alerts.length ? alerts.map(a => `<div class="dash-row">
        <div><div class="dash-row-main">${escapeHtml(a.keywords || 'Any keyword')}${a.country ? ' · ' + escapeHtml(a.country) : ''}${a.remote_type ? ' · ' + escapeHtml(a.remote_type.replace('_', ' ')) : ''}</div><div class="dash-row-sub">${escapeHtml(a.frequency)}</div></div>
        <div style="display:flex;gap:6px">
          <form method="POST" action="/user/job-alerts/toggle"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="id" value="${a.id}"><button class="dash-btn dash-btn-sm" type="submit">${a.active ? 'Pause' : 'Resume'}</button></form>
          <form method="POST" action="/user/job-alerts/delete" onsubmit="return confirm('Delete this alert?')"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="id" value="${a.id}"><button class="dash-btn dash-btn-sm dash-btn-danger" type="submit">Delete</button></form>
        </div>
      </div>`).join('') : `<div class="dash-empty">No alerts yet.</div>`}
    </div>`;
  return wrap('alerts', 'Job Alerts', `${alerts.length} alert${alerts.length === 1 ? '' : 's'}`, content, switchPill, user, ctx);
}

// ── Account Settings ────────────────────────────────────────────
export async function renderUserSettings(env, user, ctx, { csrfToken, error, ok } = {}) {
  const [sessions, { switchPill }] = await Promise.all([listSessions(env, user.id), shellCtx(env, user, 'settings')]);
  const content = `
    ${error ? `<div class="auth-err">${escapeHtml(error)}</div>` : ''}
    ${ok ? `<div class="auth-ok">${escapeHtml(ok)}</div>` : ''}

    <div class="dash-card">
      <div class="dash-card-title">Change Password</div>
      <form method="POST" action="/user/settings/password">
        ${csrfField(csrfToken)}
        <div class="pj-group"><label class="pj-label">Current Password</label><input class="pj-input" type="password" name="current_password" required></div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">New Password</label><input class="pj-input" type="password" name="new_password" required minlength="8"></div>
          <div class="pj-group"><label class="pj-label">Confirm New Password</label><input class="pj-input" type="password" name="confirm_password" required minlength="8"></div>
        </div>
        <button class="pj-submit" type="submit" style="max-width:200px">Update Password</button>
      </form>
    </div>

    ${!user.email_verified ? `<div class="dash-card">
      <div class="dash-card-title">Email Verification</div>
      <div style="font-size:12.5px;color:var(--ink2);margin-bottom:10px">Your email (${escapeHtml(user.email)}) isn't verified yet.</div>
      <form method="POST" action="/user/settings/resend-verification">${csrfField(csrfToken)}<button class="dash-btn" type="submit">Resend Verification Email</button></form>
    </div>` : ''}

    <div class="dash-card">
      <div class="dash-card-title">Active Sessions</div>
      ${sessions.map(s => `<div class="dash-row">
        <div><div class="dash-row-main">${escapeHtml((s.user_agent || 'Unknown device').slice(0, 60))}</div><div class="dash-row-sub">Last active ${new Date(s.last_seen_at).toLocaleString()}</div></div>
        <form method="POST" action="/user/settings/revoke-session">${csrfField(csrfToken)}<input type="hidden" name="session_id" value="${escapeHtml(s.id)}"><button class="dash-btn dash-btn-sm" type="submit">Revoke</button></form>
      </div>`).join('')}
      <form method="POST" action="/user/settings/logout-all" style="margin-top:10px" onsubmit="return confirm('Log out of every device, including this one?')">
        ${csrfField(csrfToken)}<button class="dash-btn dash-btn-danger" type="submit">Log Out of All Devices</button>
      </form>
    </div>

    <div class="dash-card" style="border-color:rgba(255,92,122,.3)">
      <div class="dash-card-title" style="color:var(--coral)">Delete Account</div>
      <div style="font-size:12.5px;color:var(--ink2);margin-bottom:10px">This deactivates your account and signs you out everywhere. This cannot be undone from the dashboard.</div>
      <form method="POST" action="/user/settings/delete-account" onsubmit="return confirm('Are you sure? This will permanently deactivate your account.')">
        ${csrfField(csrfToken)}
        <div class="pj-group"><label class="pj-label">Confirm your password</label><input class="pj-input" type="password" name="password" required></div>
        <button class="dash-btn dash-btn-danger" type="submit">Delete My Account</button>
      </form>
    </div>`;
  return wrap('settings', 'Account Settings', 'Manage your login, sessions, and account.', content, switchPill, user, ctx);
}
