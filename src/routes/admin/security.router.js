// src/routes/admin/security.router.js
// Admin & Security — full activity log + sign-in attempt monitoring. See
// admin.router.js for how every admin/*.router.js sub-router is
// composed.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderSecurityContent } from '../../pages/admin/security.js';
import { adminShell } from '../../pages/admin/shell.js';
import { errorPage } from './error-page.js';

export async function handleAdminSecurityRoute(url, request, env, base) {
  if (url.pathname === '/admin/security' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderSecurityContent(env);
      return new Response(adminShell('security', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }


  return null;
}
