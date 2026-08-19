// src/routes/admin/system.router.js
// System — cron status/manual sync+cleanup triggers, cache purge, salary
// backfill, and the full sync/cleanup history page. See admin.router.js
// for how every admin/*.router.js sub-router is composed.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderSystemContent } from '../../pages/admin/system.js';
import { adminShell } from '../../pages/admin/shell.js';
import { backfillSalaryUsd } from '../../db/sync.js';
import { cleanupStaleJobs } from '../../db/cleanup.js';
import { runJobAlertsDispatch } from '../../lib/job-alerts-dispatcher.js';
import { logActivity } from '../../lib/activity-log.js';
import { errorPage } from './error-page.js';

export async function handleAdminSystemRoute(url, request, env, base) {
  if (url.pathname === '/admin/system' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderSystemContent(env);
      return new Response(adminShell('system', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/cache/purge' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      // Best-effort purge of the Cache API entries this Worker itself
      // writes to (see lib/cache.js and routes/feed.router.js) — those
      // are keyed on the exact request URL, so we can't enumerate what's
      // cached, only proactively delete the known, common no-query-string
      // URLs. Query-string variants (paginated/filtered views) simply
      // expire on their normal TTL instead — never a correctness issue,
      // only a "how fresh right now" one.
      const cache = caches.default;
      const reqUrl = new URL(request.url);
      const base = `${reqUrl.protocol}//${reqUrl.host}`;
      const paths = ['/sitemap.xml', '/categories', '/companies', '/skills', '/countries'];
      await Promise.all(paths.map(p => cache.delete(new Request(`${base}${p}`, { method: 'GET' })).catch(() => {})));
      await logActivity(env, 'cache_purged', paths.join(', '));
      return new Response(null, { status: 302, headers: { 'Location': `/admin/system?flash=${encodeURIComponent('Cache purged')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/system/backfill-salary' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const result = await backfillSalaryUsd(env);
      await logActivity(env, 'salary_backfill_run', `${result.processed} processed, ${result.remaining} remaining`);
      const msg = result.remaining > 0
        ? `Processed ${result.processed} — ${result.remaining} remaining, click again to continue`
        : `Processed ${result.processed} — all salaries are now up to date`;
      return new Response(null, { status: 302, headers: { 'Location': `/admin/system?flash=${encodeURIComponent(msg)}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Job Alerts (see lib/job-alerts-dispatcher.js) ───────────────────
  if (url.pathname === '/admin/system/run-job-alerts' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const result = await runJobAlertsDispatch(env);
      const msg = result.error
        ? 'Job alerts dispatch failed — check Recent Activity for details'
        : `Sent ${result.sent} digest(s) — ${result.skipped} not due/no matches, ${result.failed} failed, out of ${result.totalAlerts} active alert(s)`;
      return new Response(null, { status: 302, headers: { 'Location': `/admin/system?flash=${encodeURIComponent(msg)}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Admin & Security (see pages/admin/security.js) ─────────────────
  if (url.pathname === '/admin/cleanup' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const result = await cleanupStaleJobs(env);
      await logActivity(env, 'cleanup_run', `${result.deleted} jobs removed`);
      return new Response(null, { status: 302, headers: { 'Location': `/admin?flash=${encodeURIComponent(`Cleanup ran — deleted ${result.deleted} jobs`)}` } });
    } catch (e) { return errorPage(e); }
  }


  return null;
}
