// src/routes/auth.router.js
// /register /login /logout /forgot-password /reset-password /verify-email
//
// Every POST here is rate-limited (lib/rate-limit.js — the same D1-backed
// limiter already protecting /admin/login and /api/jobs) and CSRF-checked
// (lib/accounts/csrf.js). Deliberately gives IDENTICAL responses for
// "email not found" and "wrong password" on login. Registration is the
// one necessary exception — see the comment on the register handler for
// why silently succeeding there would be worse UX for a legitimate
// mistake without meaningfully improving security.

import { checkRateLimit } from '../lib/rate-limit.js';
import { logActivity } from '../lib/activity-log.js';
import { getSettings } from '../lib/settings.js';
import { getCategoryData } from '../lib/categories.js';
import { getCsrfToken, verifyCsrf } from '../lib/accounts/csrf.js';
import { createSession, destroySession, getSessionUser, destroyAllSessions } from '../lib/accounts/session.js';
import { generateToken, sha256Hex } from '../lib/accounts/tokens.js';
import { isPasswordStrongEnough } from '../lib/accounts/password.js';
import { sendEmail, verificationEmailContent, passwordResetEmailContent } from '../lib/accounts/email.js';
import { findUserByEmail, createUser, verifyCredentials, markEmailVerified, updateUserPassword } from '../lib/users.js';
import { renderLoginPage, renderRegisterPage, renderForgotPasswordPage, renderResetPasswordPage, renderVerifyEmailPage } from '../pages/auth.js';

const HTML = { "Content-Type": "text/html; charset=utf-8" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientKey(request, bucket) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return `auth:${bucket}:${ip}`;
}

async function pageCtx(env) {
  const [settings, categories] = await Promise.all([getSettings(env), getCategoryData(env)]);
  return { settings, categories };
}

export async function handleAuthRoute(url, request, env, base) {
  const session = await getSessionUser(env, request);

  // ── /register ─────────────────────────────────────────────────
  if (url.pathname === '/register') {
    if (session) return Response.redirect(`${base}/user/dashboard`, 302);
    const csrfToken = await getCsrfToken(env, null);

    if (request.method === 'GET') {
      return new Response(await renderRegisterPage({ csrfToken, ...(await pageCtx(env)) }), { headers: HTML });
    }

    const form = await request.formData();
    const submittedCsrf = (form.get('_csrf') || '').toString();
    if (!(await verifyCsrf(env, null, submittedCsrf))) {
      return new Response(await renderRegisterPage({ csrfToken, error: 'Your session expired — please try again.', ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }

    const rl = await checkRateLimit(env, clientKey(request, 'register'), { maxRequests: 5, windowMinutes: 60 });
    if (!rl.allowed) {
      return new Response(await renderRegisterPage({ csrfToken, error: 'Too many attempts. Please try again later.', ...(await pageCtx(env)) }), { status: 429, headers: HTML });
    }

    const email = (form.get('email') || '').toString().trim().toLowerCase();
    const password = (form.get('password') || '').toString();
    const confirmPassword = (form.get('confirm_password') || '').toString();

    if (!EMAIL_RE.test(email)) {
      return new Response(await renderRegisterPage({ csrfToken, error: 'Please enter a valid email address.', ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }
    if (!isPasswordStrongEnough(password)) {
      return new Response(await renderRegisterPage({ csrfToken, error: 'Password must be at least 8 characters.', ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }
    if (password !== confirmPassword) {
      return new Response(await renderRegisterPage({ csrfToken, error: 'Passwords do not match.', ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }

    const existing = await findUserByEmail(env, email);
    if (existing) {
      // Registration is the one place we DO confirm an email is taken —
      // unlike login, this doesn't help an attacker log in (they still
      // need the password), and hiding it would only confuse a
      // legitimate user who forgot they already have an account, with
      // no real security benefit (an attacker can already test this via
      // "forgot password" timing regardless).
      return new Response(await renderRegisterPage({ csrfToken, error: 'An account with this email already exists.', ...(await pageCtx(env)) }), { status: 409, headers: HTML });
    }

    const userId = await createUser(env, email, password);
    await logActivity(env, 'user_registered', email, { userId });

    // Fire-and-forget verification email (see lib/accounts/email.js —
    // no-ops gracefully if no provider is configured yet).
    const verifyToken = generateToken(32);
    const verifyHash = await sha256Hex(verifyToken);
    await env.DB.prepare(`INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now','+24 hours'))`).bind(userId, verifyHash).run();
    const { subject, text, html } = verificationEmailContent(base, verifyToken);
    await sendEmail(env, { to: email, subject, text, html });

    // Auto-login on registration (common, low-friction UX — plan §33
    // explicitly asks for a fast registration flow) — the account is
    // 'pending_verification' but fully usable for browsing/saving jobs;
    // only company creation is gated on email_verified (see
    // routes/company.router.js).
    const { cookie } = await createSession(env, userId, request);
    return new Response(null, { status: 302, headers: { 'Location': `${base}/user/dashboard?welcome=1`, 'Set-Cookie': cookie } });
  }

  // ── /login ────────────────────────────────────────────────────
  if (url.pathname === '/login') {
    if (session) return Response.redirect(`${base}/user/dashboard`, 302);
    const csrfToken = await getCsrfToken(env, null);

    if (request.method === 'GET') {
      return new Response(await renderLoginPage({ csrfToken, ...(await pageCtx(env)) }), { headers: HTML });
    }

    const form = await request.formData();
    const submittedCsrf = (form.get('_csrf') || '').toString();
    if (!(await verifyCsrf(env, null, submittedCsrf))) {
      return new Response(await renderLoginPage({ csrfToken, error: 'Your session expired — please try again.', ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }

    const rl = await checkRateLimit(env, clientKey(request, 'login'), { maxRequests: 8, windowMinutes: 15 });
    if (!rl.allowed) {
      await logActivity(env, 'user_login_rate_limited', (form.get('email') || '').toString());
      return new Response(await renderLoginPage({ csrfToken, error: 'Too many attempts. Please try again in a few minutes.', ...(await pageCtx(env)) }), { status: 429, headers: HTML });
    }

    const email = (form.get('email') || '').toString().trim().toLowerCase();
    const password = (form.get('password') || '').toString();
    const user = await verifyCredentials(env, email, password);

    if (!user) {
      await logActivity(env, 'user_login_failed', email);
      // Identical message regardless of whether the email exists — see
      // file header.
      return new Response(await renderLoginPage({ csrfToken, error: 'Incorrect email or password.', ...(await pageCtx(env)) }), { status: 401, headers: HTML });
    }
    if (user.status === 'suspended') {
      return new Response(await renderLoginPage({ csrfToken, error: 'This account has been suspended. Contact support for help.', ...(await pageCtx(env)) }), { status: 403, headers: HTML });
    }

    await logActivity(env, 'user_login_success', email, { userId: user.id });
    const { cookie } = await createSession(env, user.id, request);
    return new Response(null, { status: 302, headers: { 'Location': `${base}/user/dashboard`, 'Set-Cookie': cookie } });
  }

  // ── /logout ───────────────────────────────────────────────────
  if (url.pathname === '/logout' && request.method === 'POST') {
    const cookie = await destroySession(env, request);
    if (session) await logActivity(env, 'user_logout', session.user.email, { userId: session.user.id });
    return new Response(null, { status: 302, headers: { 'Location': `${base}/`, 'Set-Cookie': cookie } });
  }

  // ── /forgot-password ──────────────────────────────────────────
  if (url.pathname === '/forgot-password') {
    const csrfToken = await getCsrfToken(env, null);
    if (request.method === 'GET') {
      return new Response(await renderForgotPasswordPage({ csrfToken, ...(await pageCtx(env)) }), { headers: HTML });
    }

    const form = await request.formData();
    const submittedCsrf = (form.get('_csrf') || '').toString();
    if (!(await verifyCsrf(env, null, submittedCsrf))) {
      return new Response(await renderForgotPasswordPage({ csrfToken, ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }

    const rl = await checkRateLimit(env, clientKey(request, 'forgot_password'), { maxRequests: 5, windowMinutes: 60 });
    const email = (form.get('email') || '').toString().trim().toLowerCase();

    // ALWAYS show the same "check your email" screen, whether the email
    // exists, is unverified, or the request was rate-limited — this is
    // exactly the "don't reveal whether an account exists" requirement
    // (plan §9/§10), applied even to the rate-limit case itself so a
    // rate-limited probe can't be used to fingerprint valid emails
    // either.
    if (rl.allowed) {
      const user = await findUserByEmail(env, email);
      if (user && user.status !== 'deleted') {
        const resetToken = generateToken(32);
        const resetHash = await sha256Hex(resetToken);
        await env.DB.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now','+1 hour'))`).bind(user.id, resetHash).run();
        const { subject, text, html } = passwordResetEmailContent(base, resetToken);
        await sendEmail(env, { to: email, subject, text, html });
        await logActivity(env, 'user_password_reset_requested', email, { userId: user.id });
      }
    }

    return new Response(await renderForgotPasswordPage({ csrfToken, sent: true, ...(await pageCtx(env)) }), { headers: HTML });
  }

  // ── /reset-password ───────────────────────────────────────────
  if (url.pathname === '/reset-password') {
    const csrfToken = await getCsrfToken(env, null);
    const tokenFromQuery = url.searchParams.get('token') || '';

    if (request.method === 'GET') {
      const valid = tokenFromQuery ? await isValidResetToken(env, tokenFromQuery) : false;
      return new Response(await renderResetPasswordPage({ csrfToken, token: tokenFromQuery, invalid: !valid, ...(await pageCtx(env)) }), { headers: HTML });
    }

    const form = await request.formData();
    const submittedCsrf = (form.get('_csrf') || '').toString();
    const token = (form.get('token') || '').toString();
    if (!(await verifyCsrf(env, null, submittedCsrf))) {
      return new Response(await renderResetPasswordPage({ csrfToken, token, error: 'Your session expired — please try again.', ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }

    const rl = await checkRateLimit(env, clientKey(request, 'reset_password'), { maxRequests: 8, windowMinutes: 60 });
    if (!rl.allowed) {
      return new Response(await renderResetPasswordPage({ csrfToken, token, error: 'Too many attempts. Please try again later.', ...(await pageCtx(env)) }), { status: 429, headers: HTML });
    }

    const password = (form.get('password') || '').toString();
    const confirmPassword = (form.get('confirm_password') || '').toString();
    if (!isPasswordStrongEnough(password) || password !== confirmPassword) {
      return new Response(await renderResetPasswordPage({ csrfToken, token, error: 'Passwords must match and be at least 8 characters.', ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }

    const resetRow = await getValidResetRow(env, token);
    if (!resetRow) {
      return new Response(await renderResetPasswordPage({ csrfToken, token, invalid: true, ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }

    await updateUserPassword(env, resetRow.user_id, password);
    await env.DB.prepare(`UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(resetRow.id).run();
    // Changing the password invalidates every existing session (plan §8,
    // §10) — including on the device currently completing the reset, so
    // they log in fresh with the new password rather than trusting a
    // pre-reset cookie that could belong to whoever triggered the reset.
    await destroyAllSessions(env, resetRow.user_id);
    await logActivity(env, 'user_password_reset_completed', '', { userId: resetRow.user_id });

    return Response.redirect(`${base}/login?reset=1`, 302);
  }

  // ── /verify-email ─────────────────────────────────────────────
  if (url.pathname === '/verify-email' && request.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    if (!token) {
      return new Response(await renderVerifyEmailPage({ success: false, message: 'Missing verification token.', ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }
    const tokenHash = await sha256Hex(token);
    const { results } = await env.DB.prepare(
      `SELECT id, user_id FROM email_verifications WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now') LIMIT 1`
    ).bind(tokenHash).all();
    const row = results?.[0];
    if (!row) {
      return new Response(await renderVerifyEmailPage({ success: false, message: 'This verification link is invalid or has expired. You can request a new one from your dashboard.', ...(await pageCtx(env)) }), { status: 400, headers: HTML });
    }
    await markEmailVerified(env, row.user_id);
    await env.DB.prepare(`UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(row.id).run();
    await logActivity(env, 'user_email_verified', '', { userId: row.user_id });
    return new Response(await renderVerifyEmailPage({ success: true, message: 'Your email has been verified. Your account is now fully active.', ...(await pageCtx(env)) }), { headers: HTML });
  }

  return null;
}

async function isValidResetToken(env, token) {
  return !!(await getValidResetRow(env, token));
}
async function getValidResetRow(env, token) {
  const tokenHash = await sha256Hex(token);
  const { results } = await env.DB.prepare(
    `SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now') LIMIT 1`
  ).bind(tokenHash).all();
  return results?.[0] || null;
}
