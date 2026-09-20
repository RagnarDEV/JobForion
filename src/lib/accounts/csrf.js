// src/lib/accounts/csrf.js
// ════════════════════════════════════════════════════════════════
// CSRF PROTECTION — double-submit-cookie pattern, sized for this
// project's plain server-rendered HTML forms (no SPA/JS framework
// anywhere on the site — see the existing "Post a Job" modal for the
// established pattern of plain <form method="POST">). A per-session
// secret is derived deterministically from the session id + a
// server-side pepper, so no extra database write or table is needed:
// the token is verifiable statelessly from the session cookie already
// established by lib/accounts/session.js.
//
// Every state-changing account/company route (POST) must call
// verifyCsrf() before touching the database. GET requests never need a
// token. The Admin Dashboard's own forms are UNCHANGED by this file —
// they continue to rely on the admin cookie + same-origin form posts as
// before; this module is additive, only used by the new
// routes/auth.router.js, routes/user.router.js, routes/company.router.js.
// ════════════════════════════════════════════════════════════════

import { sha256Hex } from './tokens.js';

// Production must fail closed when CSRF_SECRET is missing. An implicit,
// source-controlled pepper makes every deployment share the same CSRF key
// and turns a configuration mistake into a real security weakness. A fixed
// fallback remains available only when the runtime explicitly identifies
// itself as development, which keeps local work convenient without making
// an unlabelled Worker environment silently insecure.
const DEV_PEPPER = 'jobforion-dev-csrf-pepper-change-in-production';
function isExplicitDevelopment(env = {}) {
  return String(env.ENVIRONMENT || env.NODE_ENV || env.CF_ENV || '').toLowerCase() === 'development'
    || String(env.JOBFORION_DEV || '') === '1';
}
function pepper(env = {}) {
  const configured = String(env.CSRF_SECRET || '').trim();
  return configured || (isExplicitDevelopment(env) ? DEV_PEPPER : null);
}

export async function getCsrfToken(env, sessionId) {
  const secret = pepper(env);
  if (!secret) return '';
  const basis = sessionId || 'anonymous';
  return sha256Hex(`${basis}:${secret}`);
}

export async function verifyCsrf(env, sessionId, submittedToken) {
  if (!submittedToken) return false;
  const expected = await getCsrfToken(env, sessionId);
  if (!expected || expected.length !== submittedToken.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ submittedToken.charCodeAt(i);
  return diff === 0;
}

export function csrfField(token) {
  return `<input type="hidden" name="_csrf" value="${token}">`;
}
