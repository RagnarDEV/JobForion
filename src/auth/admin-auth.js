// src/auth/admin-auth.js
// Stateless HMAC-signed admin session cookie (no session storage needed).

export async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time-ish string comparison — mitigates (does not fully
// eliminate; network jitter dominates in practice over a Worker's
// microsecond-scale differences) timing side-channels on the admin
// password check and the signed-cookie check below. Always walks the
// full length of the LONGER string, so response time can't leak how
// many leading characters matched — unlike a naive `a === b`, which
// short-circuits on the first mismatching character.
export function timingSafeEqualStr(a, b) {
  const strA = String(a ?? '');
  const strB = String(b ?? '');
  const len = Math.max(strA.length, strB.length, 1);
  let diff = strA.length === strB.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const ca = i < strA.length ? strA.charCodeAt(i) : 0;
    const cb = i < strB.length ? strB.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
// SECURITY: the cookie/CSRF HMAC key. Prefer a dedicated ADMIN_SESSION_SECRET
// (wrangler secret put ADMIN_SESSION_SECRET — any long random string) so a
// leaked admin cookie can never be used to brute-force the admin PASSWORD
// offline. Falls back to ADMIN_PASSWORD so existing deployments keep working;
// setting the new secret invalidates current admin sessions (re-login once).
export function adminSigningSecret(env) {
  return String(env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || '');
}

export async function makeAdminCookie(env) {
  const expiry = Date.now() + 1000 * 60 * 60 * 24;
  const sig = await hmacHex(adminSigningSecret(env), `admin:${expiry}`);
  return `${expiry}.${sig}`;
}
function adminCookieValue(cookieHeader) {
  const match = String(cookieHeader || '').split(';').map(s => s.trim()).find(s => s.startsWith('jn_admin='));
  return match ? match.slice('jn_admin='.length) : '';
}

export async function verifyAdminCookie(env, cookieHeader) {
  // Fail closed when no signing secret is configured at all.
  if (!adminSigningSecret(env)) return false;
  const val = adminCookieValue(cookieHeader);
  if (!val) return false;
  const [expiryStr, sig] = val.split('.');
  const expiry = parseInt(expiryStr, 10);
  if (!expiry || expiry < Date.now() || !sig) return false;
  const expected = await hmacHex(adminSigningSecret(env), `admin:${expiry}`);
  return timingSafeEqualStr(expected, sig);
}

// Admin CSRF token: statelessly bound to the current signed admin cookie.
// It is safe to place in a hidden form field because it does not grant admin
// access by itself; the signed, expiring jn_admin cookie remains mandatory.
export async function getAdminCsrfToken(env, cookieHeader) {
  const cookie = adminCookieValue(cookieHeader);
  return cookie ? hmacHex(adminSigningSecret(env), `admin-csrf:${cookie}`) : '';
}

export async function verifyAdminCsrf(env, cookieHeader, submittedToken) {
  const expected = await getAdminCsrfToken(env, cookieHeader);
  return Boolean(expected && submittedToken && timingSafeEqualStr(expected, submittedToken));
}

