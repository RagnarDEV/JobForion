// src/routes/admin/blog-automation.router.js
// Blog Automation admin routes. Settings are saved through the EXISTING
// /admin/settings/update handler (routes/admin/website.router.js) — every
// blog_auto_* key is registered in lib/settings.js's SETTINGS_KEYS /
// CHECKBOX_SETTINGS_KEYS, so no separate save endpoint is needed here.
// This router only owns the page itself and the two manual triggers
// ("Generate Article Now" / "Run Expiration Now") used for on-demand
// testing without waiting for the next cron.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderBlogAutomationContent } from '../../pages/admin/blog-automation.js';
import { adminShell } from '../../pages/admin/shell.js';
import { runBlogGeneration } from '../../lib/blog-automation/generator.js';
import { runBlogExpirationCleanup } from '../../lib/blog-automation/expiration.js';
import { errorPage } from './error-page.js';

export async function handleAdminBlogAutomationRoute(url, request, env, base) {
  if (url.pathname === '/admin/blog-automation' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderBlogAutomationContent(env);
      return new Response(adminShell('blog-automation', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/blog-automation/run-now' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const result = await runBlogGeneration(env, { force: true });
      const flash = result?.success
        ? `Article published: "${result.title}"`
        : `No article generated (${result?.reason || 'unknown reason'}) — check Recent Activity below for details`;
      return new Response(null, { status: 302, headers: { 'Location': `/admin/blog-automation?flash=${encodeURIComponent(flash)}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/blog-automation/expire-now' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const result = await runBlogExpirationCleanup(env);
      const flash = result?.skipped ? 'Auto-delete is turned off — nothing was removed' : `Removed ${result?.deleted || 0} expired article(s)`;
      return new Response(null, { status: 302, headers: { 'Location': `/admin/blog-automation?flash=${encodeURIComponent(flash)}` } });
    } catch (e) { return errorPage(e); }
  }

  return null;
}
