// src/lib/accounts/session.js
// ════════════════════════════════════════════════════════════════
// USER SESSIONS — completely separate cookie/table from the Admin
// Dashboard's auth (auth/admin-auth.js uses cookie `jn_admin`, an
// HMAC-signed value with NO database row at all). This system uses
// cookie `jf_session`, holding a random bearer token whose SHA-256 hash
// is the primary key of a real `user_sessions` row (see
// ensureAccountTables() in db/schema.js) — this is what makes
// "logout from all devices" and "revoke this session" possible, which
// the stateless admin cookie deliberately doesn't need for its single
// shared-password use case.
//
// Cookie flags: HttpOnly (unreachable from JS — the plan explicitly
// forbids localStorage for anything session-related), Secure, SameSite=
// Lax (allows normal top-level navigation like following an email link
// while still blocking cross-site POST forgery — CSRF-sensitive POSTs
// are additionally protected by lib/accounts/csrf.js on top of this).
// ════════════════════════════════════════════════════════════════

import { generateToken, sha256Hex } from './tokens.js';

export const SESSION_COOKIE = 'jf_session';
const SESSION_LIFETIME_DAYS = 30;
// Sliding renewal: only touch last_seen_at (and extend expiry) at most
// once per this many minutes, so a logged-in user browsing normally
// doesn't generate a D1 write on every single page view.
const RENEW_THRESHOLD_MINUTES = 60;

function cookieHeader(token, maxAgeSeconds) {
  const attrs = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  attrs.push(maxAgeSeconds != null ? `Max-Age=${maxAgeSeconds}` : 'Max-Age=0');
  return attrs.join('; ');
}

async function hashIp(request) {
  // Never store a raw IP (see plan §23 — don't expose sensitive info);
  // a hash is enough to support future "new device/location" alerts
  // without retaining the IP itself.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  return ip ? await sha256Hex(ip) : null;
}

// Returns { token, cookie } — caller sets the returned cookie header on
// the Response. Does NOT check credentials; call after password
// verification succeeds (see routes/auth.router.js).
export async function createSession(env, userId, request) {
  const token = generateToken(32);
  const id = await sha256Hex(token);
  const maxAgeSeconds = SESSION_LIFETIME_DAYS * 86400;
  const userAgent = (request.headers.get('User-Agent') || '').slice(0, 200);
  const ipHash = await hashIp(request);

  await env.DB.prepare(
    `INSERT INTO user_sessions (id, user_id, expires_at, user_agent, ip_hash) VALUES (?, ?, datetime('now','+${SESSION_LIFETIME_DAYS} days'), ?, ?)`
  ).bind(id, userId, userAgent, ipHash).run();

  await env.DB.prepare(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(userId).run();

  return { token, cookie: cookieHeader(token, maxAgeSeconds) };
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

// Returns { user, sessionId } or null. `user` never includes
// password_hash (SELECT explicitly excludes it — see plan §23, "don't
// expose sensitive info in API responses").
export async function getSessionUser(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);

  try {
    const { results } = await env.DB.prepare(
      `SELECT s.id as session_id, s.expires_at, s.last_seen_at,
              u.id, u.email, u.email_verified, u.status, u.created_at
       FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now') LIMIT 1`
    ).bind(id).all();
    const row = results?.[0];
    if (!row) return null;
    if (row.status === 'deleted' || row.status === 'suspended') return null;

    // Sliding renewal — best-effort, never blocks the request.
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at.replace(' ', 'T') + 'Z') : null;
    const staleMinutes = lastSeen ? (Date.now() - lastSeen.getTime()) / 60000 : Infinity;
    if (staleMinutes > RENEW_THRESHOLD_MINUTES) {
      env.DB.prepare(
        `UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP, expires_at = datetime('now','+${SESSION_LIFETIME_DAYS} days') WHERE id = ?`
      ).bind(id).run().catch(() => {});
    }

    return {
      user: { id: row.id, email: row.email, email_verified: !!row.email_verified, status: row.status, created_at: row.created_at },
      sessionId: id,
    };
  } catch (e) {
    return null;
  }
}

export async function destroySession(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    const id = await sha256Hex(token);
    await env.DB.prepare(`DELETE FROM user_sessions WHERE id = ?`).bind(id).run().catch(() => {});
  }
  return cookieHeader('', null);
}

// "Logout from all devices" / invoked automatically on password change
// (see plan §8 — "changing password invalidates sessions when needed").
// `exceptSessionId` optionally keeps the CURRENT session alive (used
// after a self-service password change so the user isn't immediately
// logged out of the tab they just used).
export async function destroyAllSessions(env, userId, exceptSessionId = null) {
  if (exceptSessionId) {
    await env.DB.prepare(`DELETE FROM user_sessions WHERE user_id = ? AND id != ?`).bind(userId, exceptSessionId).run();
  } else {
    await env.DB.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(userId).run();
  }
}

export async function destroySessionById(env, userId, sessionId) {
  // userId included in the WHERE clause specifically to prevent IDOR —
  // a user can only ever revoke a session that is actually theirs, even
  // if they somehow guessed another session's hashed id.
  await env.DB.prepare(`DELETE FROM user_sessions WHERE id = ? AND user_id = ?`).bind(sessionId, userId).run();
}

export async function listSessions(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, expires_at, last_seen_at, user_agent FROM user_sessions WHERE user_id = ? ORDER BY last_seen_at DESC`
  ).bind(userId).all();
  return results || [];
}
