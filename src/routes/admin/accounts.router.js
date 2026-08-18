// src/routes/admin/accounts.router.js
// Admin management for Users and Company Accounts (the new Identity
// system). Uses the SAME verifyAdminCookie() gate as every other admin
// route — this is purely additive to the existing Admin Dashboard, not a
// new authentication system (plan §22/§36 explicitly forbid that).

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderAdminUsersContent, renderAdminCompanyAccountsContent } from '../../pages/admin/accounts.js';
import { adminShell } from '../../pages/admin/shell.js';
import { logActivity } from '../../lib/activity-log.js';
import { setUserStatus } from '../../lib/users.js';
import { setCompanyStatus, setCompanyVerified } from '../../lib/companies.js';
import { destroyAllSessions } from '../../lib/accounts/session.js';
import { errorPage } from './error-page.js';

const HTML = { "Content-Type": "text/html; charset=utf-8" };

export async function handleAdminAccountsRoute(url, request, env, base) {
  const isAccountsPath = url.pathname.startsWith('/admin/accounts');
  if (!isAccountsPath) return null;

  const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
  if (!ok) return new Response(renderAdminLogin(false), { headers: HTML });

  try {
    if (url.pathname === '/admin/accounts/users' && request.method === 'GET') {
      const content = await renderAdminUsersContent(env, url.searchParams);
      return new Response(adminShell('users', content), { headers: HTML });
    }
    if (url.pathname === '/admin/accounts/users/suspend' && request.method === 'POST') {
      const form = await request.formData();
      const id = parseInt((form.get('id') || '0').toString(), 10);
      if (id) {
        await setUserStatus(env, id, 'suspended');
        await destroyAllSessions(env, id);
        await logActivity(env, 'user_suspended', String(id));
      }
      return new Response(null, { status: 302, headers: { 'Location': '/admin/accounts/users' } });
    }
    if (url.pathname === '/admin/accounts/users/restore' && request.method === 'POST') {
      const form = await request.formData();
      const id = parseInt((form.get('id') || '0').toString(), 10);
      if (id) { await setUserStatus(env, id, 'active'); await logActivity(env, 'user_restored', String(id)); }
      return new Response(null, { status: 302, headers: { 'Location': '/admin/accounts/users' } });
    }

    if (url.pathname === '/admin/accounts/companies' && request.method === 'GET') {
      const content = await renderAdminCompanyAccountsContent(env, url.searchParams);
      return new Response(adminShell('company-accounts', content), { headers: HTML });
    }
    if (url.pathname === '/admin/accounts/companies/verify' && request.method === 'POST') {
      const form = await request.formData();
      const id = parseInt((form.get('id') || '0').toString(), 10);
      if (id) { await setCompanyVerified(env, id, true); await logActivity(env, 'company_verified', String(id)); }
      return new Response(null, { status: 302, headers: { 'Location': '/admin/accounts/companies' } });
    }
    if (url.pathname === '/admin/accounts/companies/reject' && request.method === 'POST') {
      const form = await request.formData();
      const id = parseInt((form.get('id') || '0').toString(), 10);
      if (id) { await setCompanyStatus(env, id, 'rejected'); await logActivity(env, 'company_rejected', String(id)); }
      return new Response(null, { status: 302, headers: { 'Location': '/admin/accounts/companies' } });
    }
    if (url.pathname === '/admin/accounts/companies/suspend' && request.method === 'POST') {
      const form = await request.formData();
      const id = parseInt((form.get('id') || '0').toString(), 10);
      if (id) { await setCompanyStatus(env, id, 'suspended'); await logActivity(env, 'company_suspended', String(id)); }
      return new Response(null, { status: 302, headers: { 'Location': '/admin/accounts/companies' } });
    }
  } catch (e) { return errorPage(e); }

  return null;
}
