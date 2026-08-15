// src/routes/admin/sources.router.js
// Job Sources / Providers — company-level ATS source CRUD (api_sources
// table) plus the /admin/sources overview page (pages/admin/sources.js).
// See admin.router.js for how every admin/*.router.js sub-router is
// composed.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { insertApiSource } from '../../db/sync.js';
import { renderSourcesContent } from '../../pages/admin/sources.js';
import { adminShell } from '../../pages/admin/shell.js';
import { logActivity } from '../../lib/activity-log.js';
import { errorPage } from './error-page.js';

export async function handleAdminSourcesRoute(url, request, env, base) {
  if (url.pathname === '/admin/api-sources' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const label = (form.get('label') || 'Source').toString().trim().slice(0, 60);
      const apiKey = (form.get('api_key') || '').toString().trim().slice(0, 200);
      const provider = (form.get('provider') || 'greenhouse').toString().trim().slice(0, 40);
      if (apiKey) {
        await insertApiSource(env, label, apiKey, provider);
        await logActivity(env, 'source_added', `${label} (${provider})`);
      }
      return new Response(null, { status: 302, headers: { 'Location': '/admin/sources' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/api-sources/toggle' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      if (id) await env.DB.prepare('UPDATE api_sources SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(id).run();
      await logActivity(env, 'source_toggled', `source #${id}`);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/sources?flash=${encodeURIComponent('Source updated')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/api-sources/delete' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      if (id) await env.DB.prepare("DELETE FROM api_sources WHERE id = ?").bind(id).run();
      await logActivity(env, 'source_deleted', `source #${id}`);
      return new Response(null, { status: 302, headers: { 'Location': '/admin/sources' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/sources' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderSourcesContent(env);
      return new Response(adminShell('sources', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  // ── Homepage Sections Builder (see pages/admin/homepage.js) ────────

  return null;
}
