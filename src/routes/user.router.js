// src/routes/user.router.js
// /user/* — every route here requires an authenticated session
// (lib/accounts/session.js). Unauthenticated visitors are redirected to
// /login?next=<original path> so they land back where they intended
// after signing in.

import { getSettings } from '../lib/settings.js';
import { getCategoryData } from '../lib/categories.js';
import { getSessionUser, destroyAllSessions, destroySessionById, destroySession } from '../lib/accounts/session.js';
import { getCsrfToken, verifyCsrf } from '../lib/accounts/csrf.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { logActivity } from '../lib/activity-log.js';
import { verifyCredentials, updateUserPassword, softDeleteUser, updateUserProfile, updateUserEmail, setEmailNotificationsEnabled, findUserByEmail } from '../lib/users.js';
import { isPasswordStrongEnough } from '../lib/accounts/password.js';
import { generateToken, sha256Hex } from '../lib/accounts/tokens.js';
import { sendEmail, verificationEmailContent } from '../lib/accounts/email.js';
import { createJobAlert, updateJobAlert, deleteJobAlert } from '../lib/job-alerts.js';
import { getUserMatches, generateUserMatches } from '../lib/matching.js';
import { getCareerAssistant, sendCareerMessage, CAREER_ASSISTANT_LIMITS } from '../lib/career-assistant.js';
import {
  renderUserOverview, renderUserProfile, renderUserMatches, renderCareerAssistant, renderSavedJobs, renderApplications, renderJobAlerts, renderUserSettings,
} from '../pages/user-dashboard.js';

const HTML = { "Content-Type": "text/html; charset=utf-8" };

async function ctx(env) {
  const [settings, categories] = await Promise.all([getSettings(env), getCategoryData(env)]);
  return { settings, categories };
}

function splitProfileList(value, max = 30) {
  return String(value || '').split(/\r?\n|,/).map(item => item.trim().slice(0, 240)).filter(Boolean).slice(0, max);
}

function profilePreferences(form) {
  const preferences = {};
  const remote = String(form.get('preferred_remote_type') || '').trim();
  const employment = String(form.get('preferred_employment_type') || '').trim();
  const country = String(form.get('preferred_country') || '').trim().slice(0, 100);
  if (remote) preferences.remote_type = remote;
  if (employment) preferences.employment_type = employment;
  if (country) preferences.country = country;
  return preferences;
}

export async function handleUserRoute(url, request, env, base) {
  if (!url.pathname.startsWith('/user/')) return null;

  const session = await getSessionUser(env, request);
  if (!session) {
    return Response.redirect(`${base}/login?next=${encodeURIComponent(url.pathname)}`, 302);
  }
  const { user } = session;
  const pageCtx = await ctx(env);
  const csrfToken = await getCsrfToken(env, session.sessionId);

  async function requireCsrf(request) {
    const form = await request.formData();
    const ok = await verifyCsrf(env, session.sessionId, (form.get('_csrf') || '').toString());
    return { form, ok };
  }

  // ── Overview ──
  if (url.pathname === '/user/dashboard' && request.method === 'GET') {
    return new Response(await renderUserOverview(env, user, pageCtx, { welcome: url.searchParams.get('welcome') === '1' }), { headers: HTML });
  }

  // ── Profile ──
  if (url.pathname === '/user/profile' && request.method === 'GET') {
    return new Response(await renderUserProfile(env, user, pageCtx, { csrfToken }), { headers: HTML });
  }
  if (url.pathname === '/user/profile' && request.method === 'POST') {
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderUserProfile(env, user, pageCtx, { csrfToken, error: 'Your session expired — please try again.' }), { status: 400, headers: HTML });
    await updateUserProfile(env, user.id, {
      full_name: form.get('full_name'), avatar_url: form.get('avatar_url'), job_title: form.get('job_title'), country: form.get('country'), city: form.get('city'),
      bio: form.get('bio'), skills: splitProfileList(form.get('skills'), 50), experience: splitProfileList(form.get('experience'), 30),
      education: splitProfileList(form.get('education'), 20), languages: splitProfileList(form.get('languages'), 20), job_preferences: profilePreferences(form),
      linkedin_url: form.get('linkedin_url'), portfolio_url: form.get('portfolio_url'), resume_url: form.get('resume_url'),
    });
    return new Response(await renderUserProfile(env, user, pageCtx, { csrfToken, saved: true }), { headers: HTML });
  }

  // ── Job Matches ──
  if (url.pathname === '/user/matches' && request.method === 'GET') {
    const errorKey = url.searchParams.get('error');
    const errorMessage = errorKey === 'profile' ? 'Add a professional title, bio, skills, or experience before matching.' : errorKey === 'jobs' ? 'There are no active jobs available for matching right now.' : errorKey ? 'Matching is temporarily unavailable. Please try again later.' : undefined;
    return new Response(await renderUserMatches(env, user, pageCtx, { csrfToken, ok: url.searchParams.get('ok') === '1', error: errorMessage }), { headers: HTML });
  }
  if (url.pathname === '/user/matches/generate' && request.method === 'POST') {
    const { ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderUserMatches(env, user, pageCtx, { csrfToken, error: 'Your session expired — please try again.' }), { status: 400, headers: HTML });
    const rl = await checkRateLimit(env, `matching:${user.id}`, { maxRequests: 3, windowMinutes: 30 });
    if (!rl.allowed) return new Response(await renderUserMatches(env, user, pageCtx, { csrfToken, error: 'Too many matching requests. Try again later.' }), { status: 429, headers: HTML });
    const profile = await getUserProfile(env, user.id);
    const result = await generateUserMatches(env, user.id, profile, pageCtx.settings, { force: true });
    await logActivity(env, 'user_job_matching', `user#${user.id}`, { status: result.success ? 'success' : 'failed', error_code: result.error?.code || null, cache_hit: result.metadata?.cache_hit === true });
    if (result.success) return new Response(null, { status: 302, headers: { Location: '/user/matches?ok=1' } });
    const error = result.error?.code === 'matching_profile_incomplete' ? 'profile' : result.error?.code === 'matching_no_jobs' ? 'jobs' : 'unavailable';
    return new Response(null, { status: 302, headers: { Location: `/user/matches?error=${error}` } });
  }

  // ── Career Assistant ──
  if (url.pathname === '/user/career-assistant' && request.method === 'GET') {
    return new Response(await renderCareerAssistant(env, user, pageCtx, { csrfToken, error: url.searchParams.get('error') ? 'Career Assistant could not complete that request. Please try again.' : undefined }), { headers: HTML });
  }
  if (url.pathname === '/user/career-assistant' && request.method === 'POST') {
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderCareerAssistant(env, user, pageCtx, { csrfToken, error: 'Your session expired — please try again.' }), { status: 400, headers: HTML });
    const rl = await checkRateLimit(env, `career_assistant:${user.id}`, { maxRequests: CAREER_ASSISTANT_LIMITS.maxRequests, windowMinutes: CAREER_ASSISTANT_LIMITS.windowMinutes });
    if (!rl.allowed) return new Response(await renderCareerAssistant(env, user, pageCtx, { csrfToken, error: 'You have reached the assistant request limit. Please try again later.' }), { status: 429, headers: HTML });
    const profile = await getUserProfile(env, user.id);
    const result = await sendCareerMessage(env, user.id, profile, form.get('message'), pageCtx.settings);
    await logActivity(env, 'user_career_assistant', `user#${user.id}`, { status: result.success ? 'success' : 'failed', error_code: result.error?.code || null });
    if (result.success) return new Response(null, { status: 302, headers: { Location: '/user/career-assistant' } });
    const errorKey = result.error?.code === 'assistant_invalid_message' || result.error?.code === 'assistant_message_too_long' ? 'input' : 'unavailable';
    return new Response(null, { status: 302, headers: { Location: `/user/career-assistant?error=${errorKey}` } });
  }

  // ── Saved Jobs ──
  if (url.pathname === '/user/saved-jobs' && request.method === 'GET') {
    return new Response(await renderSavedJobs(env, user, pageCtx), { headers: HTML });
  }

  // ── Applications ──
  if (url.pathname === '/user/applications' && request.method === 'GET') {
    return new Response(await renderApplications(env, user, pageCtx), { headers: HTML });
  }

  // ── Job Alerts ──
  if (url.pathname === '/user/job-alerts' && request.method === 'GET') {
    return new Response(await renderJobAlerts(env, user, pageCtx, { csrfToken }), { headers: HTML });
  }
  if (url.pathname === '/user/job-alerts' && request.method === 'POST') {
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderJobAlerts(env, user, pageCtx, { csrfToken, error: 'Your session expired — please try again.' }), { status: 400, headers: HTML });
    await createJobAlert(env, user.id, {
      keywords: form.get('keywords'), category: form.get('category'), skills: form.get('skills'), country: form.get('country'),
      remote_type: form.get('remote_type'), employment_type: form.get('employment_type'), salary_min: form.get('salary_min'), frequency: form.get('frequency'),
    });
    return new Response(null, { status: 302, headers: { 'Location': '/user/job-alerts' } });
  }
  if (url.pathname === '/user/job-alerts/toggle' && request.method === 'POST') {
    const { form, ok } = await requireCsrf(request);
    if (ok) {
      const id = parseInt((form.get('id') || '0').toString(), 10);
      const { results } = await env.DB.prepare(`SELECT active FROM job_alerts WHERE id = ? AND user_id = ?`).bind(id, user.id).all();
      if (results?.[0]) await updateJobAlert(env, user.id, id, { ...results[0], active: results[0].active ? 0 : 1 });
    }
    return new Response(null, { status: 302, headers: { 'Location': '/user/job-alerts' } });
  }
  if (url.pathname === '/user/job-alerts/delete' && request.method === 'POST') {
    const { form, ok } = await requireCsrf(request);
    if (ok) await deleteJobAlert(env, user.id, parseInt((form.get('id') || '0').toString(), 10));
    return new Response(null, { status: 302, headers: { 'Location': '/user/job-alerts' } });
  }

  // ── Settings ──
  if (url.pathname === '/user/settings' && request.method === 'GET') {
    return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, ok: url.searchParams.get('ok') || undefined }), { headers: HTML });
  }

  if (url.pathname === '/user/settings/password' && request.method === 'POST') {
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'Your session expired.' }), { status: 400, headers: HTML });

    const rl = await checkRateLimit(env, `auth:change_password:${user.id}`, { maxRequests: 6, windowMinutes: 30 });
    if (!rl.allowed) return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'Too many attempts. Try again later.' }), { status: 429, headers: HTML });

    const current = (form.get('current_password') || '').toString();
    const next = (form.get('new_password') || '').toString();
    const confirm = (form.get('confirm_password') || '').toString();

    const verified = await verifyCredentials(env, user.email, current);
    if (!verified) return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'Current password is incorrect.' }), { status: 401, headers: HTML });
    if (!isPasswordStrongEnough(next) || next !== confirm) return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'New passwords must match and be at least 8 characters.' }), { status: 400, headers: HTML });

    await updateUserPassword(env, user.id, next);
    // Invalidate every OTHER session, keep this one alive (plan §8) —
    // the user just proved their identity with the current password, so
    // signing them out of their own active tab would be poor UX for no
    // extra security.
    await destroyAllSessions(env, user.id, session.sessionId);
    await logActivity(env, 'user_password_changed', `user#${user.id}`, { userId: user.id });
    return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, ok: 'Password updated. Your other sessions have been logged out.' }), { headers: HTML });
  }

  if (url.pathname === '/user/settings/email' && request.method === 'POST') {
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'Your session expired.' }), { status: 400, headers: HTML });

    const rl = await checkRateLimit(env, `auth:change_email:${user.id}`, { maxRequests: 5, windowMinutes: 60 });
    if (!rl.allowed) return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'Too many attempts. Try again later.' }), { status: 429, headers: HTML });

    const newEmail = (form.get('new_email') || '').toString().trim().toLowerCase();
    const password = (form.get('password') || '').toString();
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!EMAIL_RE.test(newEmail)) {
      return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'Please enter a valid email address.' }), { status: 400, headers: HTML });
    }
    const verified = await verifyCredentials(env, user.email, password);
    if (!verified) return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'Incorrect password.' }), { status: 401, headers: HTML });

    if (newEmail === user.email) {
      return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'That is already your current email.' }), { status: 400, headers: HTML });
    }
    const existing = await findUserByEmail(env, newEmail);
    if (existing) {
      return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'That email is already in use by another account.' }), { status: 409, headers: HTML });
    }

    await updateUserEmail(env, user.id, newEmail);
    await logActivity(env, 'user_email_changed', `user#${user.id}`, { userId: user.id });

    // New address starts unverified (updateUserEmail resets
    // email_verified=0) — send it a fresh verification link immediately
    // rather than leaving the user to figure out they need one.
    const token = generateToken(32);
    const hash = await sha256Hex(token);
    await env.DB.prepare(`INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now','+24 hours'))`).bind(user.id, hash).run();
    const { subject, text, html } = verificationEmailContent(base, token);
    await sendEmail(env, { to: newEmail, subject, text, html });

    const refreshed = { ...user, email: newEmail, email_verified: false };
    return new Response(await renderUserSettings(env, refreshed, pageCtx, { csrfToken, ok: `Email updated to ${newEmail}. Check your inbox to verify it.` }), { headers: HTML });
  }

  if (url.pathname === '/user/settings/notifications' && request.method === 'POST') {
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'Your session expired.' }), { status: 400, headers: HTML });
    const enabled = !!form.get('email_notifications_enabled');
    await setEmailNotificationsEnabled(env, user.id, enabled);
    const refreshed = { ...user, email_notifications_enabled: enabled };
    return new Response(await renderUserSettings(env, refreshed, pageCtx, { csrfToken, ok: 'Notification preferences saved.' }), { headers: HTML });
  }

  if (url.pathname === '/user/settings/resend-verification' && request.method === 'POST') {
    const { ok } = await requireCsrf(request);
    if (ok && !user.email_verified) {
      const rl = await checkRateLimit(env, `auth:resend_verify:${user.id}`, { maxRequests: 3, windowMinutes: 60 });
      if (rl.allowed) {
        const token = generateToken(32);
        const hash = await sha256Hex(token);
        await env.DB.prepare(`INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now','+24 hours'))`).bind(user.id, hash).run();
        const { subject, text, html } = verificationEmailContent(base, token);
        await sendEmail(env, { to: user.email, subject, text, html });
      }
    }
    return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, ok: 'Verification email sent (if not rate-limited).' }), { headers: HTML });
  }

  if (url.pathname === '/user/settings/revoke-session' && request.method === 'POST') {
    const { form, ok } = await requireCsrf(request);
    if (ok) await destroySessionById(env, user.id, (form.get('session_id') || '').toString());
    return new Response(null, { status: 302, headers: { 'Location': '/user/settings' } });
  }

  if (url.pathname === '/user/settings/logout-all' && request.method === 'POST') {
    const { ok } = await requireCsrf(request);
    if (ok) await destroyAllSessions(env, user.id);
    const cookie = await destroySession(env, request);
    return new Response(null, { status: 302, headers: { 'Location': `${base}/login`, 'Set-Cookie': cookie } });
  }

  if (url.pathname === '/user/settings/delete-account' && request.method === 'POST') {
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'Your session expired.' }), { status: 400, headers: HTML });
    const verified = await verifyCredentials(env, user.email, (form.get('password') || '').toString());
    if (!verified) return new Response(await renderUserSettings(env, user, pageCtx, { csrfToken, error: 'Incorrect password.' }), { status: 401, headers: HTML });
    await softDeleteUser(env, user.id);
    await logActivity(env, 'user_account_deleted', `user#${user.id}`, { userId: user.id });
    const cookie = await destroySession(env, request);
    return new Response(null, { status: 302, headers: { 'Location': `${base}/`, 'Set-Cookie': cookie } });
  }

  return null;
}
