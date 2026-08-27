// src/routes/admin/blog-automation.router.js
// Blog Automation admin routes. Its settings use a dedicated partial-save
// endpoint so posting this form can never overwrite unrelated Site/SEO
// feature flags. This router owns the page, settings save, and the two
// manual triggers ("Generate Article Now" / "Run Expiration Now") used for
// on-demand testing without waiting for the next cron.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderBlogAutomationContent } from '../../pages/admin/blog-automation.js';
import { adminShell } from '../../pages/admin/shell.js';
import { runBlogGeneration } from '../../lib/blog-automation/generator.js';
import { runBlogExpirationCleanup } from '../../lib/blog-automation/expiration.js';
import { setSettings, SETTINGS_DEFAULTS, CHECKBOX_SETTINGS_KEYS } from '../../lib/settings.js';
import { logActivity } from '../../lib/activity-log.js';
import { errorPage } from './error-page.js';

const BLOG_AUTOMATION_KEYS = Object.keys(SETTINGS_DEFAULTS).filter(key => key.startsWith('blog_auto_'));
const BLOG_AUTOMATION_CHECKBOX_KEYS = new Set(BLOG_AUTOMATION_KEYS.filter(key => CHECKBOX_SETTINGS_KEYS.includes(key)));
const BLOG_AUTOMATION_TEXT_KEYS = BLOG_AUTOMATION_KEYS.filter(key => !BLOG_AUTOMATION_CHECKBOX_KEYS.has(key));

function cleanScheduleDays(value) {
  const days = String(value || '').split(',')
    .map(value => parseInt(value.trim(), 10))
    .filter(value => Number.isInteger(value) && value >= 0 && value <= 6);
  return [...new Set(days)].sort((a, b) => a - b).join(',');
}

export async function handleAdminBlogAutomationRoute(url, request, env, base) {
  if (url.pathname === '/admin/blog-automation' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderBlogAutomationContent(env);
      return new Response(adminShell('blog-automation', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/blog-automation/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const updates = {};
      for (const key of BLOG_AUTOMATION_CHECKBOX_KEYS) updates[key] = form.get(key) ? '1' : '0';
      for (const key of BLOG_AUTOMATION_TEXT_KEYS) {
        if (!form.has(key)) continue;
        const value = key === 'blog_auto_schedule_days'
          ? cleanScheduleDays(form.get(key))
          : String(form.get(key) || '').trim().slice(0, 200);
        updates[key] = value;
      }
      await setSettings(env, updates);
      await logActivity(env, 'blog_automation_settings_updated', 'Blog Automation settings');
      return new Response(null, { status: 302, headers: { 'Location': `/admin/blog-automation?flash=${encodeURIComponent('Blog Automation settings saved')}` } });
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
