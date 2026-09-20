// src/routes/admin/dashboard.router.js
// Overview — the /admin root: KPIs, System Health, Recent Activity, Quick
// Actions (see pages/admin/dashboard.js). Deliberately the LAST
// admin/*.router.js sub-router tried in admin.router.js, since '/admin'
// would otherwise need special-casing against every other '/admin/*'
// route — see admin.router.js for the exact composition order.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin, renderAdminDashboard } from '../../pages/admin.js';
import { errorPage } from './error-page.js';

export async function handleAdminDashboardRoute(url, request, env, base) {
  if (url.pathname === '/admin') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const html = await renderAdminDashboard(env, base);
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  return null;
}
