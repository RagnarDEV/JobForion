// src/auth/admin-auth.js
// Stateless HMAC-signed admin session cookie (no session storage needed).

export async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function makeAdminCookie(env) {
  const expiry = Date.now() + 1000 * 60 * 60 * 24;
  const sig = await hmacHex(env.ADMIN_PASSWORD || '', `admin:${expiry}`);
  return `${expiry}.${sig}`;
}
export async function verifyAdminCookie(env, cookieHeader) {
  if (!cookieHeader) return false;
  const match = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith('jn_admin='));
  if (!match) return false;
  const val = match.slice('jn_admin='.length);
  const [expiryStr, sig] = val.split('.');
  const expiry = parseInt(expiryStr, 10);
  if (!expiry || expiry < Date.now()) return false;
  const expected = await hmacHex(env.ADMIN_PASSWORD || '', `admin:${expiry}`);
  return expected === sig;
}

