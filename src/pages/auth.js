// src/pages/auth.js
// Server-rendered auth pages (no SPA/JS framework, matching the rest of
// the site). Every form is a plain <form method="POST"> with a hidden
// CSRF field (lib/accounts/csrf.js) so it degrades gracefully and is
// protected the same way regardless of JS being enabled.

import { baseLayout } from '../layout/base-layout.js';
import { csrfField } from '../lib/accounts/csrf.js';
import { escapeHtml } from '../lib/entities.js';
import { BASE_URL } from '../config/constants.js';

function authShell({ title, sub, body, foot, error, ok }) {
  return `
<div class="auth-wrap">
  <div class="auth-card">
    <div class="auth-title">${title}</div>
    ${sub ? `<div class="auth-sub">${sub}</div>` : ''}
    ${error ? `<div class="auth-err">${escapeHtml(error)}</div>` : ''}
    ${ok ? `<div class="auth-ok">${escapeHtml(ok)}</div>` : ''}
    ${body}
    ${foot ? `<div class="auth-foot">${foot}</div>` : ''}
  </div>
</div>`;
}

export async function renderLoginPage({ csrfToken, error, settings, categories }) {
  const body = `
    <form method="POST" action="/login">
      ${csrfField(csrfToken)}
      <div class="pj-group"><label class="pj-label">Email</label><input class="pj-input" type="email" name="email" required autofocus placeholder="you@example.com"></div>
      <div class="pj-group"><label class="pj-label">Password</label><input class="pj-input" type="password" name="password" required placeholder="••••••••"></div>
      <div class="auth-links"><span></span><a href="/forgot-password">Forgot password?</a></div>
      <button class="pj-submit" type="submit">Log In →</button>
    </form>`;
  return baseLayout('Log In — JobForion', 'Log in to your JobForion account.', `${BASE_URL}/login`, '', authShell({
    title: '👋 Welcome back', sub: 'Log in to manage your saved jobs, applications, and alerts.', body, error,
    foot: `Don't have an account? <a href="/register">Create one</a>`,
  }), '', 'noindex, follow', settings, categories);
}

export async function renderRegisterPage({ csrfToken, error, settings, categories }) {
  const body = `
    <form method="POST" action="/register">
      ${csrfField(csrfToken)}
      <div class="pj-group"><label class="pj-label">Email</label><input class="pj-input" type="email" name="email" required autofocus placeholder="you@example.com"></div>
      <div class="pj-group"><label class="pj-label">Password</label><input class="pj-input" type="password" name="password" required minlength="8" placeholder="At least 8 characters"></div>
      <div class="pj-group"><label class="pj-label">Confirm Password</label><input class="pj-input" type="password" name="confirm_password" required minlength="8" placeholder="Re-enter your password"></div>
      <button class="pj-submit" type="submit">Create Account →</button>
    </form>
    <p style="font-size:11px;color:var(--ink3);margin-top:12px;text-align:center">By creating an account you agree to our <a href="/terms" style="color:var(--brand)">Terms</a> and <a href="/privacy" style="color:var(--brand)">Privacy Policy</a>.</p>`;
  return baseLayout('Create Account — JobForion', 'Create a free JobForion account to save jobs, track applications, and get alerts.', `${BASE_URL}/register`, '', authShell({
    title: '🚀 Create your account', sub: 'Takes less than a minute. You can complete your profile later.', body, error,
    foot: `Already have an account? <a href="/login">Log in</a>`,
  }), '', 'noindex, follow', settings, categories);
}

export async function renderForgotPasswordPage({ csrfToken, sent, settings, categories }) {
  const body = sent
    ? `<p style="font-size:13.5px;color:var(--ink2);line-height:1.7">If an account exists for that email, we've sent a password reset link. It expires in 1 hour.</p>`
    : `<form method="POST" action="/forgot-password">
      ${csrfField(csrfToken)}
      <div class="pj-group"><label class="pj-label">Email</label><input class="pj-input" type="email" name="email" required autofocus placeholder="you@example.com"></div>
      <button class="pj-submit" type="submit">Send Reset Link →</button>
    </form>`;
  return baseLayout('Forgot Password — JobForion', 'Reset your JobForion account password.', `${BASE_URL}/forgot-password`, '', authShell({
    title: '🔑 Forgot your password?', sub: sent ? '' : "Enter your email and we'll send you a reset link.", body,
    foot: `<a href="/login">← Back to log in</a>`,
  }), '', 'noindex, follow', settings, categories);
}

export async function renderResetPasswordPage({ csrfToken, token, error, invalid, settings, categories }) {
  const body = invalid
    ? `<p style="font-size:13.5px;color:var(--ink2);line-height:1.7">This reset link is invalid or has expired. Request a new one below.</p>`
    : `<form method="POST" action="/reset-password">
      ${csrfField(csrfToken)}
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <div class="pj-group"><label class="pj-label">New Password</label><input class="pj-input" type="password" name="password" required minlength="8" autofocus placeholder="At least 8 characters"></div>
      <div class="pj-group"><label class="pj-label">Confirm New Password</label><input class="pj-input" type="password" name="confirm_password" required minlength="8"></div>
      <button class="pj-submit" type="submit">Reset Password →</button>
    </form>`;
  return baseLayout('Reset Password — JobForion', 'Choose a new password for your JobForion account.', `${BASE_URL}/reset-password`, '', authShell({
    title: '🔒 Reset your password', body, error,
    foot: invalid ? `<a href="/forgot-password">Request a new link</a>` : `<a href="/login">← Back to log in</a>`,
  }), '', 'noindex, follow', settings, categories);
}

export async function renderVerifyEmailPage({ success, message, settings, categories }) {
  const body = `<p style="font-size:13.5px;color:var(--ink2);line-height:1.7">${escapeHtml(message)}</p>`;
  return baseLayout('Verify Email — JobForion', 'Verify your JobForion account email address.', `${BASE_URL}/verify-email`, '', authShell({
    title: success ? '✅ Email verified' : '⚠️ Verification issue', body,
    foot: `<a href="/user/dashboard">Go to your dashboard →</a>`,
  }), '', 'noindex, follow', settings, categories);
}
