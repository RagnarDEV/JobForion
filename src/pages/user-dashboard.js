// src/pages/user-dashboard.js
// Job Seeker Dashboard — /user/dashboard, /user/profile, /user/saved-jobs,
// /user/applications, /user/job-alerts, /user/settings. Each render*
// function returns a FULL page (already wrapped in baseLayout); the
// router (routes/user.router.js) just returns `new Response(html)`.

import { baseLayout } from '../layout/base-layout.js';
import { dashboardShell, accountSwitchPill } from '../components/dashboard-shell.js';
import { jobCardSSR } from '../components/job-card.js';
import { csrfField } from '../lib/accounts/csrf.js';
import { escapeHtml } from '../lib/entities.js';
import { getUserProfile } from '../lib/users.js';
import { listSavedJobs, countSavedJobs } from '../lib/saved-jobs.js';
import { listApplications, countApplications } from '../lib/applications.js';
import { listJobAlerts } from '../lib/job-alerts.js';
import { listUserCompanies } from '../lib/accounts/permissions.js';
import { listSessions } from '../lib/accounts/session.js';
import { BASE_URL } from '../config/constants.js';
import { getCardStyles } from '../lib/job-card-styles.js';
import { getLogoOverrides, attachCompanyLogos } from '../lib/company-logos.js';
import { hydrateHotPay } from '../lib/hot-pay.js';
import { getSettings } from '../lib/settings.js';
import { getVerifiedCompanyNameSet } from '../lib/companies.js';
import { getUserMatches } from '../lib/matching.js';
import { getCareerAssistant } from '../lib/career-assistant.js';
import {
  iconLayoutDashboard, iconUser, iconBookmark, iconBriefcase, iconBell, iconSettingsGear, iconSparkle,
} from '../assets/icons.js';

const NAV = [
  { id: 'overview', label: 'Overview', icon: iconLayoutDashboard, href: '/user/dashboard' },
  { id: 'profile', label: 'My Profile', icon: iconUser, href: '/user/profile' },
  { id: 'matches', label: 'Job Matches', icon: iconSparkle, href: '/user/matches' },
  { id: 'assistant', label: 'Career Assistant', icon: iconSparkle, href: '/user/career-assistant' },
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
  const html = dashboardShell({ activeId, navItems: NAV, title, subtitle, content, switchPill, user });
  return baseLayout(`${title} — JobForion`, subtitle || 'Manage your JobForion account.', `${BASE_URL}${NAV.find(n => n.id === activeId)?.href || '/user/dashboard'}`, '', html, '', 'noindex, follow', ctx?.settings, ctx?.categories, null, null, null, user);
}

function listFieldValue(value) {
  if (!Array.isArray(value)) return '';
  return value.map(item => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    return [item.title, item.role, item.company, item.school, item.degree, item.name, item.description].filter(Boolean).join(' — ');
  }).filter(Boolean).join('\n');
}

function profileInitials(profile, user) {
  const name = profile?.full_name || user?.email || 'J';
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'J';
}

function profileUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try { const parsed = new URL(raw); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : ''; } catch (e) { return ''; }
}

async function savedJobCards(env, jobs, ctx) {
  const companies = jobs.map(job => job.company).filter(Boolean);
  const [hydratedJobs, cardStyles, logoOverrides, verifiedCompanySet, settings] = await Promise.all([
    attachCompanyLogos(env, jobs),
    getCardStyles(env), getLogoOverrides(env, companies), getVerifiedCompanyNameSet(env), getSettings(env),
  ]);
  const classifiedJobs = await hydrateHotPay(env, hydratedJobs, settings);
  return classifiedJobs.map((job, index) => jobCardSSR(job, index, ctx.categories?.map, ctx.categories?.order, cardStyles, logoOverrides, true, verifiedCompanySet, settings)).join('');
}

function formatAccountDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function appStatusClass(status) {
  return ['applied', 'viewed', 'interview', 'rejected', 'hired'].includes(status) ? (status === 'rejected' ? 'status-rejected' : 'status-active') : 'status-pending';
}

function categoryOptions(ctx, selected = '') {
  return (ctx.categories?.order || []).map(key => { const item = ctx.categories.map?.[key]; return `<option value="${escapeHtml(key)}"${key === selected ? ' selected' : ''}>${escapeHtml(item?.label || key)}</option>`; }).join('');
}

// ── Overview ────────────────────────────────────────────────────
export async function renderUserOverview(env, user, ctx, { welcome = false } = {}) {
  const [profile, savedCount, appCount, alerts, recentApps, recentSaved, { companies, switchPill }] = await Promise.all([
    getUserProfile(env, user.id), countSavedJobs(env, user.id), countApplications(env, user.id),
    listJobAlerts(env, user.id), listApplications(env, user.id, { limit: 4 }), listSavedJobs(env, user.id, { limit: 4 }), shellCtx(env, user, 'overview'),
  ]);
  const profileFields = [profile?.full_name, profile?.job_title, profile?.bio, profile?.avatar_url, profile?.skills?.length].filter(Boolean).length;
  const completion = Math.round((profileFields / 5) * 100);
  const displayName = profile?.full_name || user.email;
  const firstName = String(displayName).split(/\s+/)[0];
  const recentActivity = recentApps.length ? recentApps.map(app => `<a class="activity-row" href="/job/${app.job_id}"><span class="activity-icon">${iconBriefcase({ size: 15 })}</span><span><strong>${escapeHtml(app.title)}</strong><small>Application tracked${app.company ? ` · ${escapeHtml(app.company)}` : ''}</small></span><span class="activity-arrow"></span></a>`).join('') : recentSaved.length ? recentSaved.map(job => `<a class="activity-row" href="/job/${job.id}"><span class="activity-icon">${iconBookmark({ size: 15 })}</span><span><strong>${escapeHtml(job.title)}</strong><small>Saved job${job.company ? ` · ${escapeHtml(job.company)}` : ''}</small></span><span class="activity-arrow"></span></a>`).join('') : `<div class="dash-empty">No recent activity yet. Start by browsing open roles.</div>`;
  const content = `${welcome ? '<div class="auth-ok" role="status">Your account is ready. Welcome to JobForion.</div>' : ''}
    <section class="account-welcome"><div><span class="dash-kicker">YOUR JOB SEARCH, ORGANIZED</span><h2>Welcome back, ${escapeHtml(firstName)}</h2><p>Keep your search moving with saved roles, alerts, and applications in one place.</p></div><a href="/" class="dash-btn dash-btn-primary">Browse jobs</a></section>
    <div class="account-action-grid"><a class="account-action-card" href="/"><span><strong>Find your next role</strong><span>Browse active opportunities</span></span><b class="account-action-arrow"></b></a><a class="account-action-card" href="/user/saved-jobs"><span><strong>Review saved jobs</strong><span>${savedCount} saved role${savedCount === 1 ? '' : 's'}</span></span><b class="account-action-arrow"></b></a><a class="account-action-card" href="/user/job-alerts"><span><strong>Manage job alerts</strong><span>${alerts.filter(a => a.active).length} active alert${alerts.filter(a => a.active).length === 1 ? '' : 's'}</span></span><b class="account-action-arrow"></b></a></div>
    <div class="dash-kpi-grid"><div class="dash-kpi"><div class="dash-kpi-label">Saved Jobs</div><div class="dash-kpi-val">${savedCount}</div><a class="kpi-link" href="/user/saved-jobs">View saved jobs</a></div><div class="dash-kpi"><div class="dash-kpi-label">Applications</div><div class="dash-kpi-val">${appCount}</div><a class="kpi-link" href="/user/applications">View applications</a></div><div class="dash-kpi"><div class="dash-kpi-label">Active Alerts</div><div class="dash-kpi-val">${alerts.filter(a => a.active).length}</div><a class="kpi-link" href="/user/job-alerts">Manage alerts</a></div><div class="dash-kpi"><div class="dash-kpi-label">Profile completion</div><div class="dash-kpi-val">${completion}%</div><div class="profile-progress"><span style="width:${completion}%"></span></div><a class="kpi-link" href="/user/profile">Improve profile</a></div></div>
    <div class="account-dashboard-grid"><section class="dash-card"><div class="account-section-heading"><div><h2>Recent activity</h2><p>Your latest tracked account activity</p></div><a class="text-link" href="/user/applications">See all</a></div><div class="activity-list">${recentActivity}</div></section><section class="dash-card"><div class="account-section-heading"><div><h2>Account status</h2><p>Keep your account ready to use</p></div></div><div class="dash-row"><span class="dash-row-main">${escapeHtml(user.email)}</span><span class="status-badge ${user.email_verified ? 'status-active' : 'status-pending'}">${user.email_verified ? 'Verified' : 'Unverified'}</span></div>${!user.email_verified ? `<p class="account-note">Verify your email from <a href="/user/settings">Account Settings</a> to keep account communications active.</p>` : ''}${!profileFields || !profile?.job_title ? `<div class="profile-mini-progress"><strong>Complete your profile</strong><span>${completion}% complete</span><div class="profile-progress"><span style="width:${completion}%"></span></div><a href="/user/profile" class="dash-btn dash-btn-primary">Complete profile</a></div>` : ''}</section></div>
    ${!companies.length ? `<div class="dash-card"><div class="account-section-heading"><div><h2>Hiring on JobForion?</h2><p>Create a company profile to post jobs and manage applicants.</p></div><a href="/company/create" class="dash-btn">Create company</a></div></div>` : ''}`;
  return wrap('overview', 'Dashboard', `Welcome back, ${displayName}`, content, switchPill, user, ctx);
}

// ── Profile ─────────────────────────────────────────────────────
export async function renderUserProfile(env, user, ctx, { csrfToken, saved, error } = {}) {
  const [profile, { switchPill }] = await Promise.all([getUserProfile(env, user.id), shellCtx(env, user, 'profile')]);
  const p = profile || {};
  const prefs = p.job_preferences && typeof p.job_preferences === 'object' ? p.job_preferences : {};
  const avatar = profileUrl(p.avatar_url);
  const completionFields = [p.full_name, p.job_title, p.bio, p.avatar_url, p.skills?.length].filter(Boolean).length;
  const completion = Math.round((completionFields / 5) * 100);
  const initials = profileInitials(p, user);
  const content = `${saved ? '<div class="auth-ok" role="status">Profile updated successfully.</div>' : ''}${error ? `<div class="auth-err" role="alert">${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/user/profile" class="dash-card profile-editor-form">
      ${csrfField(csrfToken)}
      <div class="profile-avatar-block"><div class="profile-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="Profile avatar">` : escapeHtml(initials)}</div><div class="profile-avatar-copy"><strong>${escapeHtml(p.full_name || user.email)}</strong><span>${completion}% profile complete · Add an image URL below to personalize your profile.</span></div></div>
      <div class="profile-form-section" style="margin-top:0;padding-top:0;border-top:0"><h2>Identity</h2><div class="pj-row"><div class="pj-group"><label class="pj-label" for="profile-full-name">Full name</label><input id="profile-full-name" class="pj-input" name="full_name" value="${escapeHtml(p.full_name || '')}" autocomplete="name"></div><div class="pj-group"><label class="pj-label" for="profile-job-title">Professional title</label><input id="profile-job-title" class="pj-input" name="job_title" value="${escapeHtml(p.job_title || '')}" placeholder="e.g. Senior Frontend Developer"></div></div><div class="pj-row"><div class="pj-group"><label class="pj-label" for="profile-country">Country</label><input id="profile-country" class="pj-input" name="country" value="${escapeHtml(p.country || '')}" autocomplete="country-name"></div><div class="pj-group"><label class="pj-label" for="profile-city">City</label><input id="profile-city" class="pj-input" name="city" value="${escapeHtml(p.city || '')}" autocomplete="address-level2"></div></div><div class="pj-group"><label class="pj-label" for="profile-avatar-url">Avatar URL</label><input id="profile-avatar-url" class="pj-input" type="url" name="avatar_url" value="${escapeHtml(p.avatar_url || '')}" placeholder="https://..."><p class="profile-form-hint">Use an image URL you control. The existing profile storage keeps this value with your account.</p></div><div class="pj-group"><label class="pj-label" for="profile-bio">Bio</label><textarea id="profile-bio" class="pj-textarea" name="bio" placeholder="A short professional summary">${escapeHtml(p.bio || '')}</textarea></div></div>
      <div class="profile-form-section"><h2>Skills and experience</h2><div class="pj-group"><label class="pj-label" for="profile-skills">Skills</label><input id="profile-skills" class="pj-input" name="skills" value="${escapeHtml((p.skills || []).join(', '))}" placeholder="React, Python, SQL"><p class="profile-form-hint">Separate skills with commas.</p></div><div class="pj-row"><div class="pj-group"><label class="pj-label" for="profile-experience">Experience</label><textarea id="profile-experience" class="pj-textarea profile-list-input" name="experience" placeholder="One role per line">${escapeHtml(listFieldValue(p.experience))}</textarea></div><div class="pj-group"><label class="pj-label" for="profile-education">Education</label><textarea id="profile-education" class="pj-textarea profile-list-input" name="education" placeholder="One qualification per line">${escapeHtml(listFieldValue(p.education))}</textarea></div></div><div class="pj-group"><label class="pj-label" for="profile-languages">Languages</label><input id="profile-languages" class="pj-input" name="languages" value="${escapeHtml((p.languages || []).join(', '))}" placeholder="English, Arabic"></div></div>
      <div class="profile-form-section"><h2>Job preferences</h2><p class="profile-form-hint">These fields use the existing job_preferences profile data to tailor your search.</p><div class="pj-row"><div class="pj-group"><label class="pj-label" for="profile-preferred-remote">Preferred remote type</label><select id="profile-preferred-remote" class="pj-select" name="preferred_remote_type"><option value="">No preference</option><option value="fully_remote"${prefs.remote_type === 'fully_remote' ? ' selected' : ''}>Fully remote</option><option value="hybrid"${prefs.remote_type === 'hybrid' ? ' selected' : ''}>Hybrid</option><option value="on_site"${prefs.remote_type === 'on_site' ? ' selected' : ''}>On-site</option></select></div><div class="pj-group"><label class="pj-label" for="profile-preferred-employment">Preferred employment</label><select id="profile-preferred-employment" class="pj-select" name="preferred_employment_type"><option value="">No preference</option><option value="full_time"${prefs.employment_type === 'full_time' ? ' selected' : ''}>Full-time</option><option value="part_time"${prefs.employment_type === 'part_time' ? ' selected' : ''}>Part-time</option><option value="contract"${prefs.employment_type === 'contract' ? ' selected' : ''}>Contract</option></select></div></div><div class="pj-group"><label class="pj-label" for="profile-preferred-country">Preferred country</label><input id="profile-preferred-country" class="pj-input" name="preferred_country" value="${escapeHtml(prefs.country || '')}" placeholder="Optional"></div></div>
      <div class="profile-form-section"><h2>Professional links</h2><div class="pj-row"><div class="pj-group"><label class="pj-label" for="profile-linkedin">LinkedIn URL</label><input id="profile-linkedin" class="pj-input" type="url" name="linkedin_url" value="${escapeHtml(p.linkedin_url || '')}"></div><div class="pj-group"><label class="pj-label" for="profile-portfolio">Portfolio URL</label><input id="profile-portfolio" class="pj-input" type="url" name="portfolio_url" value="${escapeHtml(p.portfolio_url || '')}"></div></div><div class="pj-group"><label class="pj-label" for="profile-resume">Resume / CV link</label><input id="profile-resume" class="pj-input" type="url" name="resume_url" value="${escapeHtml(p.resume_url || '')}" placeholder="Link to a hosted PDF"></div></div>
      <div class="account-inline-actions" style="margin-top:22px"><button class="pj-submit" type="submit" style="max-width:220px">Save profile</button><a class="dash-btn" href="/user/dashboard">Cancel</a></div>
    </form>`;
  return wrap('profile', 'My Profile', 'Keep your professional profile ready for the next opportunity.', content, switchPill, user, ctx);
}

// ── Job Matches ──────────────────────────────────────────────────
function matchList(items, empty) {
  const values = Array.isArray(items) ? items : [];
  return values.length ? `<ul style="margin:5px 0 0 17px;padding:0;line-height:1.65">${values.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<span style="color:var(--ink3)">${empty}</span>`;
}

export async function renderUserMatches(env, user, ctx, { csrfToken, ok, error } = {}) {
  const profile = await getUserProfile(env, user.id);
  const profileReady = Boolean(profile?.job_title || profile?.bio || (Array.isArray(profile?.skills) && profile.skills.length) || (Array.isArray(profile?.experience) && profile.experience.length));
  const [matches, { switchPill }] = await Promise.all([profileReady ? getUserMatches(env, user.id, profile) : Promise.resolve({ fresh: false, data: null, stored: null, candidateCount: 0 }), shellCtx(env, user, 'matches')]);
  const notice = ok ? '<div class="auth-ok" role="status">Your matches are up to date.</div>' : error ? `<div class="auth-err" role="alert">${escapeHtml(error)}</div>` : '';
  const rows = matches.fresh && matches.data?.matches?.length ? matches.data.matches.map(match => {
    const job = match.job;
    return `<article class="dash-card" style="padding:16px"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><div class="dash-card-title" style="margin-bottom:3px"><a href="/job/${job.id}" style="color:var(--ink);text-decoration:none">${escapeHtml(job.title)}</a></div><div style="font-size:12px;color:var(--ink2)">${escapeHtml(job.company)}${job.location ? ` · ${escapeHtml(job.location)}` : ''}</div></div><span class="status-badge status-active">${match.score}% match</span></div><p style="font-size:12.5px;color:var(--ink2);line-height:1.7;margin:13px 0">${escapeHtml(match.why)}</p><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;font-size:11.5px;color:var(--ink2)"><div><strong style="color:var(--ink)">Strengths</strong>${matchList(match.strengths, 'No specific strengths identified.')}</div><div><strong style="color:var(--ink)">Gaps to review</strong>${matchList(match.gaps, 'No specific gaps identified.')}</div></div><div style="margin-top:14px"><a class="dash-btn dash-btn-primary" href="/job/${job.id}">Review role</a></div></article>`;
  }).join('') : '';
  const content = `${notice}<section class="account-page-intro"><div><span class="dash-kicker">PERSONALIZED JOB SEARCH</span><h2>Job matches</h2><p>Review active roles that align with the professional information you chose to share.</p></div><form id="matching-request" method="POST" action="/user/matches/generate">${csrfField(csrfToken)}<button class="dash-btn dash-btn-primary" type="submit" ${profileReady ? '' : 'disabled'}>${matches.fresh ? 'Refresh matches' : 'Find my matches'}</button></form></section>${!profileReady ? `<div class="dash-card" style="border-color:rgba(245,166,35,.35)"><div class="dash-card-title">Complete your profile first</div><p style="font-size:12.5px;color:var(--ink2);line-height:1.7">Add a professional title, short bio, skills, or experience so matching has useful evidence. Sensitive personal attributes are not used for matching.</p><a class="dash-btn" href="/user/profile">Update my profile</a></div>` : rows ? `<div style="display:grid;gap:14px">${rows}</div>` : `<div class="dash-card"><div class="dash-card-title">No matches generated yet</div><p style="font-size:12.5px;color:var(--ink2);line-height:1.7">Matching uses your saved profile and the currently active JobForion roles. It runs only when you request it and stores results separately from your profile.</p><a href="#matching-request" class="dash-btn dash-btn-primary">Find matches above</a></div>`}${matches.stored?.updated_at ? `<p style="font-size:11px;color:var(--ink3);margin-top:12px">Last matching run: ${escapeHtml(formatAccountDate(matches.stored.updated_at))}</p>` : ''}`;
  return wrap('matches', 'Job Matches', 'Private, on-demand recommendations based on your profile.', content, switchPill, user, ctx);
}

// ── Career Assistant ─────────────────────────────────────────────
function assistantMessageHtml(message) {
  return escapeHtml(message).replace(/\r?\n/g, '<br>');
}

export async function renderCareerAssistant(env, user, ctx, { csrfToken, error } = {}) {
  const [assistant, { switchPill }] = await Promise.all([getCareerAssistant(env, user.id), shellCtx(env, user, 'assistant')]);
  const bubbles = assistant.messages.length ? assistant.messages.map(item => `<div class="assistant-message ${item.role === 'user' ? 'assistant-message-user' : 'assistant-message-ai'}" style="max-width:88%;margin:${item.role === 'user' ? '0 0 12px auto' : '0 auto 12px 0'};padding:12px 14px;border-radius:14px;background:${item.role === 'user' ? 'var(--ink)' : 'var(--paper2)'};color:${item.role === 'user' ? '#fff' : 'var(--ink)'};border:1px solid ${item.role === 'user' ? 'var(--ink)' : 'var(--line)'}"><div class="assistant-message-label" style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.68;margin-bottom:6px">${item.role === 'user' ? 'You' : 'Career Assistant'}</div><div class="assistant-message-body" style="font-size:13px;line-height:1.7;overflow-wrap:anywhere">${assistantMessageHtml(item.content)}</div></div>`).join('') : `<div class="dash-empty">Ask for help with your profile, interview preparation, career planning, or your next job-search step.</div>`;
  const content = `${error ? `<div class="auth-err" role="alert">${escapeHtml(error)}</div>` : ''}<section class="account-page-intro"><div><span class="dash-kicker">PRIVATE CAREER GUIDANCE</span><h2>Career Assistant</h2><p>Get practical guidance based on the professional information you chose to share with JobForion.</p></div></section><section class="dash-card career-assistant-card"><div class="career-assistant-disclaimer" style="padding:12px 14px;border-radius:10px;background:var(--paper2);color:var(--ink2);font-size:11.5px;line-height:1.65;margin-bottom:16px">The assistant can help with career planning, profile improvement, interview preparation, and job-search strategy. It does not make hiring decisions and cannot provide legal, medical, tax, or personalized financial advice.</div><div class="career-assistant-history" aria-live="polite" style="min-height:120px;margin-bottom:18px">${bubbles}</div><form method="POST" action="/user/career-assistant" class="career-assistant-form">${csrfField(csrfToken)}<label class="pj-label" for="career-assistant-message">What would you like help with?</label><textarea id="career-assistant-message" class="pj-textarea" name="message" maxlength="2000" rows="5" required placeholder="For example: How can I strengthen my profile for backend roles?"></textarea><div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="dash-btn dash-btn-primary" type="submit">Ask Career Assistant</button></div></form></section>`;
  return wrap('assistant', 'Career Assistant', 'Private, practical guidance for your next career move.', content, switchPill, user, ctx);
}

// ── Saved Jobs ──────────────────────────────────────────────────
export async function renderSavedJobs(env, user, ctx) {
  const [jobs, { switchPill }] = await Promise.all([listSavedJobs(env, user.id, { limit: 50 }), shellCtx(env, user, 'saved')]);
  const cards = jobs.length ? await savedJobCards(env, jobs, ctx) : '';
  const content = `<section class="account-page-intro"><div><span class="dash-kicker">YOUR SHORTLIST</span><h2>Saved jobs</h2><p>Keep the roles you want to revisit close at hand.</p></div><a class="dash-btn dash-btn-primary" href="/jobs">Browse jobs</a></section><div class="saved-job-count"><strong>${jobs.length}</strong><span>saved job${jobs.length === 1 ? '' : 's'}</span></div>${cards ? `<div class="saved-jobs-grid">${cards}</div>` : `<div class="dash-card"><div class="dash-empty">No saved jobs yet. Browse open roles and use the bookmark action to build your shortlist.</div><a class="dash-btn dash-btn-primary" href="/jobs">Explore jobs</a></div>`}`;
  return wrap('saved', 'Saved Jobs', `${jobs.length} saved role${jobs.length === 1 ? '' : 's'}`, content, switchPill, user, ctx);
}

// ── Applications ────────────────────────────────────────────────
const APP_STATUS_LABEL = { saved: 'Saved', applied: 'Applied', viewed: 'Viewed', interview: 'Interview', rejected: 'Rejected', hired: 'Hired' };
export async function renderApplications(env, user, ctx) {
  const [apps, { switchPill }] = await Promise.all([listApplications(env, user.id, { limit: 50 }), shellCtx(env, user, 'applications')]);
  const content = `<section class="account-page-intro"><div><span class="dash-kicker">YOUR ACTIVITY</span><h2>Applications</h2><p>Review the roles you have opened or applied to through JobForion.</p></div><a class="dash-btn dash-btn-primary" href="/jobs">Find more jobs</a></section><div class="saved-job-count"><strong>${apps.length}</strong><span>tracked application${apps.length === 1 ? '' : 's'}</span></div><div class="dash-card applications-list">${apps.length ? apps.map(a => `<div class="application-row"><div class="application-main"><div class="application-title"><a href="/job/${a.job_id}">${escapeHtml(a.title)}</a></div><div class="application-company">${escapeHtml(a.company)}${a.location ? ` · ${escapeHtml(a.location)}` : ''}</div><div class="application-meta">${a.application_type === 'internal' ? 'Applied on JobForion' : 'External application tracked'}${a.updated_at ? ` · ${formatAccountDate(a.updated_at)}` : ''}</div></div><span class="status-badge ${appStatusClass(a.status)}">${escapeHtml(APP_STATUS_LABEL[a.status] || a.status || 'Tracked')}</span></div>`).join('') : `<div class="dash-empty">No applications tracked yet. When you use an application link on JobForion, it will appear here.</div>`}</div>`;
  return wrap('applications', 'Applications', `${apps.length} tracked application${apps.length === 1 ? '' : 's'}`, content, switchPill, user, ctx);
}

// ── Job Alerts ──────────────────────────────────────────────────
export async function renderJobAlerts(env, user, ctx, { csrfToken, error } = {}) {
  const [alerts, { switchPill }] = await Promise.all([listJobAlerts(env, user.id), shellCtx(env, user, 'alerts')]);
  const alertRows = alerts.map(a => { const parts = [a.keywords, a.category, a.skills, a.country, a.remote_type?.replace(/_/g, ' '), a.employment_type?.replace(/_/g, ' '), a.salary_min ? `from ${a.salary_min}` : ''].filter(Boolean); return `<div class="alert-row"><div class="alert-row-main"><div class="alert-row-title">${escapeHtml(parts.join(' · ') || 'All new jobs')}</div><div class="alert-row-sub">${escapeHtml(a.frequency || 'daily')} digest${a.last_notified_at ? ` · Last sent ${formatAccountDate(a.last_notified_at)}` : ''}</div></div><span class="status-badge ${a.active ? 'status-active' : 'status-pending'}">${a.active ? 'Active' : 'Paused'}</span><div class="account-inline-actions"><form method="POST" action="/user/job-alerts/toggle"><input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}"><input type="hidden" name="id" value="${a.id}"><button class="dash-btn dash-btn-sm" type="submit">${a.active ? 'Pause' : 'Resume'}</button></form><form method="POST" action="/user/job-alerts/delete" onsubmit="return confirm('Delete this alert?')"><input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}"><input type="hidden" name="id" value="${a.id}"><button class="dash-btn dash-btn-sm dash-btn-danger" type="submit">Delete</button></form></div></div>`; }).join('');
  const content = `${error ? `<div class="auth-err" role="alert">${escapeHtml(error)}</div>` : ''}<section class="account-page-intro"><div><span class="dash-kicker">STAY IN THE LOOP</span><h2>Job alerts</h2><p>Save a search and let the existing email service bring new matches to your inbox.</p></div></section><div class="dash-card"><div class="account-section-heading"><div><h2>Create a new alert</h2><p>Choose only the filters you want to receive.</p></div></div><form method="POST" action="/user/job-alerts"><div class="pj-row">${csrfField(csrfToken)}<div class="pj-group"><label class="pj-label" for="alert-keywords">Keywords</label><input id="alert-keywords" class="pj-input" name="keywords" placeholder="e.g. React, product design"></div><div class="pj-group"><label class="pj-label" for="alert-country">Country</label><input id="alert-country" class="pj-input" name="country" placeholder="Optional"></div></div><div class="pj-row"><div class="pj-group"><label class="pj-label" for="alert-category">Category</label><select id="alert-category" class="pj-select" name="category"><option value="">Any category</option>${categoryOptions(ctx)}</select></div><div class="pj-group"><label class="pj-label" for="alert-skills">Skills</label><input id="alert-skills" class="pj-input" name="skills" placeholder="Optional skills"></div></div><div class="pj-row"><div class="pj-group"><label class="pj-label" for="alert-remote">Remote type</label><select id="alert-remote" class="pj-select" name="remote_type"><option value="">Any remote type</option><option value="fully_remote">Fully remote</option><option value="hybrid">Hybrid</option><option value="on_site">On-site</option></select></div><div class="pj-group"><label class="pj-label" for="alert-employment">Employment</label><select id="alert-employment" class="pj-select" name="employment_type"><option value="">Any employment type</option><option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="contract">Contract</option></select></div></div><div class="pj-row"><div class="pj-group"><label class="pj-label" for="alert-salary">Minimum salary</label><input id="alert-salary" class="pj-input" type="number" min="0" name="salary_min" placeholder="Optional"></div><div class="pj-group"><label class="pj-label" for="alert-frequency">Email frequency</label><select id="alert-frequency" class="pj-select" name="frequency"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="instant">As matches arrive</option></select></div></div><button class="pj-submit" type="submit" style="max-width:220px">Create alert</button></form></div><div class="dash-card"><div class="account-section-heading"><div><h2>Your alerts</h2><p>${alerts.length} saved alert${alerts.length === 1 ? '' : 's'}</p></div></div>${alertRows || '<div class="dash-empty">No alerts yet. Create one above to receive relevant opportunities.</div>'}</div>`;
  return wrap('alerts', 'Job Alerts', `${alerts.length} alert${alerts.length === 1 ? '' : 's'}`, content, switchPill, user, ctx);
}

// ── Account Settings ────────────────────────────────────────────
export async function renderUserSettings(env, user, ctx, { csrfToken, error, ok } = {}) {
  const [sessions, { switchPill }] = await Promise.all([listSessions(env, user.id), shellCtx(env, user, 'settings')]);
  const content = `
    ${error ? `<div class="auth-err">${escapeHtml(error)}</div>` : ''}
    ${ok ? `<div class="auth-ok" role="status">${escapeHtml(ok)}</div>` : ''}
    <section class="account-page-intro"><div><span class="dash-kicker">PROTECT YOUR ACCOUNT</span><h2>Account settings</h2><p>Manage security, notifications, verification, and account access.</p></div></section>

    <div class="dash-card">
      <div class="dash-card-title">Change Password</div>
      <form method="POST" action="/user/settings/password">
        ${csrfField(csrfToken)}
        <div class="pj-group"><label class="pj-label" for="current-password">Current password</label><div class="account-password-wrap"><input id="current-password" class="pj-input" type="password" name="current_password" autocomplete="current-password" required><button type="button" data-account-password="current-password">Show</button></div></div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label" for="new-password">New password</label><div class="account-password-wrap"><input id="new-password" class="pj-input" type="password" name="new_password" autocomplete="new-password" required minlength="8"><button type="button" data-account-password="new-password">Show</button></div></div>
          <div class="pj-group"><label class="pj-label" for="confirm-password">Confirm new password</label><div class="account-password-wrap"><input id="confirm-password" class="pj-input" type="password" name="confirm_password" autocomplete="new-password" required minlength="8"><button type="button" data-account-password="confirm-password">Show</button></div></div>
        </div>
        <button class="pj-submit" type="submit" style="max-width:200px">Update Password</button>
      </form>
    </div>

    <div class="dash-card">
      <div class="dash-card-title">Change Email</div>
      <form method="POST" action="/user/settings/email">
        ${csrfField(csrfToken)}
        <div style="font-size:12px;color:var(--ink3);margin-bottom:10px">Current: <strong style="color:var(--ink2)">${escapeHtml(user.email)}</strong></div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label" for="new-email">New email</label><input id="new-email" class="pj-input" type="email" name="new_email" autocomplete="email" required></div>
          <div class="pj-group"><label class="pj-label" for="email-password">Confirm password</label><div class="account-password-wrap"><input id="email-password" class="pj-input" type="password" name="password" autocomplete="current-password" required><button type="button" data-account-password="email-password">Show</button></div></div>
        </div>
        <button class="pj-submit" type="submit" style="max-width:200px">Update Email</button>
      </form>
      <p style="font-size:11px;color:var(--ink3);margin-top:8px">You'll need to verify the new address before it's fully active.</p>
    </div>

    <div class="dash-card">
      <div class="dash-card-title">Notification Preferences</div>
      <form method="POST" action="/user/settings/notifications">
        ${csrfField(csrfToken)}
        <label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer;margin-bottom:12px">
          <input type="checkbox" id="email-notifications" name="email_notifications_enabled" value="1" ${(user.email_notifications_enabled !== false && user.email_notifications_enabled !== 0) ? 'checked' : ''} style="width:17px;height:17px;margin-top:1px">
          <span>
            <span style="font-size:12.5px;font-weight:700;color:var(--ink);display:block">Job Alert Emails</span>
            <span style="font-size:10.5px;color:var(--ink3)">Receive email digests for your Job Alerts. Turning this off pauses ALL alert emails without deleting them — manage individual alerts on the <a href="/user/job-alerts" style="color:var(--brand)">Job Alerts</a> page.</span>
          </span>
        </label>
        <button class="dash-btn dash-btn-primary" type="submit">Save Preference</button>
      </form>
      <p style="font-size:11px;color:var(--ink3);margin-top:10px">Account security emails (email verification, password reset) are always sent regardless of this setting.</p>
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
        <div class="pj-group"><label class="pj-label" for="delete-password">Confirm your password</label><div class="account-password-wrap"><input id="delete-password" class="pj-input" type="password" name="password" autocomplete="current-password" required><button type="button" data-account-password="delete-password">Show</button></div></div>
        <button class="dash-btn dash-btn-danger" type="submit">Delete My Account</button>
      </form>
    </div><script>(function(){document.querySelectorAll('[data-account-password]').forEach(function(button){button.addEventListener('click',function(){var input=document.getElementById(button.getAttribute('data-account-password'));var visible=input.type==='text';input.type=visible?'password':'text';button.textContent=visible?'Show':'Hide';});});})();</script>`;
  return wrap('settings', 'Account Settings', 'Manage your login, sessions, and account.', content, switchPill, user, ctx);
}
