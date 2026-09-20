// src/routes/api/system.api.js
// Admin-only operational endpoints: manual sync trigger and health check.
// Returns a Response, or null when the path is not this module's concern.

import { syncJobs } from '../../db/sync.js';
import { PROVIDERS } from '../../providers/index.js';
import { checkRateLimit } from '../../lib/platform/rate-limit.js';
import { logActivity } from '../../lib/platform/activity-log.js';
import { verifyAdminCookie, verifyAdminCsrf } from '../../auth/admin-auth.js';
import { reportOperationalError } from '../../lib/platform/observability.js';

export async function handleSystemApi(url, request, env, ctx) {
  if (url.pathname === '/api/sync' && request.method === 'POST') {
    // SECURITY (critical): this endpoint used to be reachable by ANYONE —
    // no admin check, no rate limit — despite triggering a full,
    // subrequest-expensive multi-provider sync run (9 ATS providers) on
    // every call. The scheduled() cron in index.js calls syncJobs(env)
    // directly in-process and never goes through this HTTP route, so
    // gating the whole endpoint behind the admin cookie breaks nothing:
    // the only legitimate caller left is the "Sync Now" button in
    // pages/admin/system.js / dashboard.js, which already posts from an
    // authenticated same-origin admin page and sends the cookie
    // automatically. Unauthenticated requests now get exactly the same
    // 404 as /api/debug below, so as not to even confirm the route exists.
    const cookie = request.headers.get('Cookie');
    const ok = await verifyAdminCookie(env, cookie);
    if (!ok) return new Response('Not found', { status: 404 });
    let submittedCsrf = request.headers.get('X-Admin-CSRF') || '';
    if (!submittedCsrf) {
      try { submittedCsrf = String((await request.clone().formData()).get('_admin_csrf') || ''); } catch (e) {}
    }
    if (!await verifyAdminCsrf(env, cookie, submittedCsrf)) return new Response('Invalid CSRF token', { status: 403 });

    // Defense in depth on top of the auth gate: prevents accidental
    // double-submits or a compromised admin session from hammering every
    // provider's API repeatedly in a short window.
    const rl = await checkRateLimit(env, 'admin-sync', { maxRequests: 6, windowMinutes: 15, failClosed: true });
    if (!rl.allowed) {
      if (request.method === 'POST') {
        return new Response(null, { status: 302, headers: { 'Location': `/admin?flash=${encodeURIComponent('Sync already ran recently — please wait a few minutes.')}` } });
      }
      return new Response(JSON.stringify({ success: false, error: 'Too many sync requests. Please wait a few minutes.' }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    // Manual single-provider sync (plan §13/§21): the "Sync Now" button
    // on each provider card in pages/admin/sources.js posts here with
    // ?provider=greenhouse instead of triggering a full all-providers
    // run — same auth gate, same rate limit, same PROVIDERS registry
    // lookup already used everywhere else, so an unknown/mistyped
    // provider id is caught before syncJobs() even runs a query.
    const onlyProvider = url.searchParams.get('provider') || null;
    if (onlyProvider && !PROVIDERS[onlyProvider]) {
      const msg = `Unknown provider "${onlyProvider}"`;
      if (request.method === 'POST') return new Response(null, { status: 302, headers: { 'Location': `/admin/sources?flash=${encodeURIComponent(msg)}` } });
      return new Response(JSON.stringify({ success: false, error: msg }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    try {
      const result = await syncJobs(env, { onlyProvider });
      if (request.method === 'POST') {
        const label = onlyProvider ? `manual trigger (${onlyProvider})` : 'manual trigger';
        await logActivity(env, 'sync_run', label, `+${result.inserted} jobs, ${(result.errors || []).length} errors`);
        return new Response(null, { status: 302, headers: { 'Location': onlyProvider ? `/admin/sources?flash=${encodeURIComponent(`${onlyProvider}: +${result.inserted} jobs`)}` : '/admin' } });
      }
      return new Response(JSON.stringify({ success: true, ...result }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      // SECURITY: same rationale as /api/subscribe above — never echo
      // e.message to the response body, even to an authenticated admin,
      // since it's still logged permanently to admin_activity_log via the
      // Location redirect path today. Log the real reason server-side.
      reportOperationalError('api.sync', e, { provider: url.searchParams.get('provider') || 'all' });
      if (request.method === 'POST') {
        await logActivity(env, 'sync_run', 'manual trigger', 'failed — see Worker logs');
        return new Response(null, { status: 302, headers: { 'Location': `/admin?flash=${encodeURIComponent('Sync failed — check Worker logs for details.')}` } });
      }
      return new Response(JSON.stringify({ success: false, error: "Sync failed. Check Worker logs for details." }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (url.pathname === '/api/debug') {
    // SECURITY: this leaked a live row count to anyone, unauthenticated
    // — harmless on its own, but there's no legitimate reason for it to
    // be public, and "public endpoints that reveal internal state" are
    // exactly what a security review flags on a production site. Gated
    // behind the same admin cookie as everything under /admin instead
    // of deleting it outright, since it's still a genuinely convenient
    // one-line health check for whoever IS logged in.
    const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
    if (!ok) return new Response('Not found', { status: 404 });
    const { results } = await env.DB.prepare("SELECT COUNT(*) as count FROM jobs").all();
    return new Response(JSON.stringify({ jobs_in_db: results[0]?.count || 0 }), { headers: { "Content-Type": "application/json" } });
  }
  return null;
}
