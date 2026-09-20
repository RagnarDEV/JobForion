// src/routes/admin/auth.router.js
// Admin login / logout — split out of admin.router.js (see that file for
// how every admin/*.router.js sub-router is composed). Owns the two
// routes that exist BEFORE an admin session exists, so it's deliberately
// the first sub-router tried.

import { makeAdminCookie, timingSafeEqualStr } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { checkRateLimit, resetRateLimit, memoryRateLimit, resetMemoryRateLimit } from '../../lib/platform/rate-limit.js';
import { logActivity } from '../../lib/platform/activity-log.js';
import { errorPage } from './error-page.js';

export async function handleAdminAuthRoute(url, request, env, base) {
  if (url.pathname === '/admin/login' && request.method === 'POST') {
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      // SECURITY: brute-force protection on the single most sensitive
      // endpoint in the app. Same lib/platform/rate-limit.js already protecting
      // /api/subscribe and /api/post-job — this was the one write
      // endpoint that had been missed. Checked BEFORE reading the form
      // body so a flood of attempts can't even spend time parsing.
      const rlKey = `admin-login:${ip}`;
      const rlOpts = { maxRequests: 5, windowMinutes: 15 };
      let rl = await checkRateLimit(env, rlKey, { ...rlOpts, failClosed: true });
      // D1 limiter unavailable (table not migrated yet / transient D1 error):
      // fall back to a per-isolate limiter instead of locking the admin out.
      if (rl.error) rl = memoryRateLimit(rlKey, rlOpts);
      if (!rl.allowed) {
        await logActivity(env, 'login_rate_limited', ip);
        return new Response(renderAdminLogin(`Too many attempts. Try again in ${rl.retryAfterMinutes || 15} minute(s).`), { status: 429, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      const form = await request.formData();
      const pw = form.get('password') || '';
      // SECURITY: timing-safe comparison (see auth/admin-auth.js) instead
      // of `===`, which short-circuits on the first mismatched character
      // and can theoretically leak how many leading characters were
      // correct via response timing.
      if (env.ADMIN_PASSWORD && timingSafeEqualStr(pw, env.ADMIN_PASSWORD)) {
        const cookie = await makeAdminCookie(env);
        // A correct password must never count toward a lockout.
        resetMemoryRateLimit(rlKey);
        await resetRateLimit(env, rlKey);
        await logActivity(env, 'login_success', ip);
        return new Response(null, { status: 302, headers: { 'Location': '/admin', 'Set-Cookie': `jn_admin=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400` } });
      }
      await logActivity(env, 'login_failed', ip);
      return new Response(renderAdminLogin(true), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/logout') {
    return new Response(null, { status: 302, headers: { 'Location': '/admin', 'Set-Cookie': 'jn_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
  }


  return null;
}
