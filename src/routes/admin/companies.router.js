// src/routes/admin/companies.router.js
// Company Management — listing page plus hide/unhide (the site models
// "hide a company" as a small exclusion list, hidden_companies, since
// there's no separate companies table — see lib/entities.js). See
// admin.router.js for how every admin/*.router.js sub-router is
// composed.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderCompaniesListContent } from '../../pages/admin/companies.js';
import { adminShell } from '../../pages/admin/shell.js';
import { logActivity } from '../../lib/activity-log.js';
import { errorPage } from './error-page.js';

export async function handleAdminCompaniesRoute(url, request, env, base) {
  if (url.pathname === '/admin/companies' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderCompaniesListContent(env, url.searchParams);
      return new Response(adminShell('companies', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  // ── Job Sources (see pages/admin/sources.js) ──────────────────────
  if (url.pathname === '/admin/companies/hide' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const company = (form.get('company') || '').toString().trim();
      if (company) {
        await env.DB.prepare("INSERT OR IGNORE INTO hidden_companies (company_lower) VALUES (?)").bind(company.toLowerCase()).run();
        await logActivity(env, 'company_hidden', company);
      }
      return new Response(null, { status: 302, headers: { 'Location': `/admin/companies?flash=${encodeURIComponent('Company hidden')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/companies/unhide' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const company = (form.get('company') || '').toString().trim();
      if (company) {
        await env.DB.prepare("DELETE FROM hidden_companies WHERE company_lower = ?").bind(company.toLowerCase()).run();
        await logActivity(env, 'company_unhidden', company);
      }
      return new Response(null, { status: 302, headers: { 'Location': `/admin/companies?flash=${encodeURIComponent('Company unhidden')}` } });
    } catch (e) { return errorPage(e); }
  }


  return null;
}
