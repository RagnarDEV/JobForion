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

// Falls back to a fixed development pepper ONLY if the secret isn't
// configured — CSRF tokens still work end-to-end locally, but a real
// deployment should set CSRF_SECRET via `wrangler secret put` for a
// value that isn't checked into source control. Losing/rotating this
// secret simply invalidates in-flight tokens (users re-submit), it does
// not affect passwords or sessions themselves.
function pepper(env) {
  return env.CSRF_SECRET || 'jobforion-dev-csrf-pepper-change-in-production';
}

export async function getCsrfToken(env, sessionId) {
  const basis = sessionId || 'anonymous';
  return sha256Hex(`${basis}:${pepper(env)}`);
}

export async function verifyCsrf(env, sessionId, submittedToken) {
  if (!submittedToken) return false;
  const expected = await getCsrfToken(env, sessionId);
  if (expected.length !== submittedToken.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ submittedToken.charCodeAt(i);
  return diff === 0;
}

export function csrfField(token) {
  return `<input type="hidden" name="_csrf" value="${token}">`;
}
