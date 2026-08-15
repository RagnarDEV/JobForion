// src/routes/admin/taxonomy.router.js
// Categories & Directory (Taxonomy) — dynamic category CRUD/reorder plus
// directory overrides (custom names/descriptions for company/skill/city
// pages). See admin.router.js for how every admin/*.router.js sub-router
// is composed.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderCategoriesContent } from '../../pages/admin/categories.js';
import { renderDirectoryContent } from '../../pages/admin/directory.js';
import { adminShell } from '../../pages/admin/shell.js';
import { createCategory, updateCategory, deleteCategory, moveCategory } from '../../lib/categories.js';
import { setOverride, clearOverride, DIRECTORY_KINDS } from '../../lib/directory-overrides.js';
import { logActivity } from '../../lib/activity-log.js';
import { errorPage } from './error-page.js';

export async function handleAdminTaxonomyRoute(url, request, env, base) {
  if (url.pathname === '/admin/categories' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderCategoriesContent(env);
      return new Response(adminShell('categories', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/categories/create' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await createCategory(env, {
        key: (form.get('key') || '').toString(),
        label: (form.get('label') || '').toString(),
        emoji: (form.get('emoji') || '').toString(),
        color: (form.get('color') || '').toString(),
      });
      await logActivity(env, 'category_created', (form.get('label') || '').toString());
      return new Response(null, { status: 302, headers: { 'Location': `/admin/categories?flash=${encodeURIComponent('Category added')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/categories/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const key = (form.get('key') || '').toString();
      await updateCategory(env, key, {
        label: (form.get('label') || '').toString(),
        emoji: (form.get('emoji') || '').toString(),
        color: (form.get('color') || '').toString(),
        active: !!form.get('active'),
      });
      await logActivity(env, 'category_updated', key);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/categories?flash=${encodeURIComponent('Category updated')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/categories/move' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const key = (form.get('key') || '').toString();
      const direction = (form.get('direction') || '').toString() === 'up' ? 'up' : 'down';
      await moveCategory(env, key, direction);
      return new Response(null, { status: 302, headers: { 'Location': '/admin/categories' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/categories/delete' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const key = (form.get('key') || '').toString();
      await deleteCategory(env, key);
      await logActivity(env, 'category_deleted', key);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/categories?flash=${encodeURIComponent('Category deleted')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/directory' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderDirectoryContent(env, url.searchParams);
      return new Response(adminShell('directory', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/directory/save' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const kind = (form.get('kind') || '').toString();
      if (!DIRECTORY_KINDS.includes(kind)) return new Response('Invalid kind', { status: 400 });
      const name = (form.get('name') || '').toString();
      await setOverride(env, kind, name, {
        displayName: (form.get('display_name') || '').toString(),
        hidden: !!form.get('hidden'),
      });
      return new Response(null, { status: 302, headers: { 'Location': `/admin/directory?flash=${encodeURIComponent('Saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/directory/reset' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const kind = (form.get('kind') || '').toString();
      if (!DIRECTORY_KINDS.includes(kind)) return new Response('Invalid kind', { status: 400 });
      const name = (form.get('name') || '').toString();
      await clearOverride(env, kind, name);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/directory?flash=${encodeURIComponent('Reset to auto-detected')}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Pages CMS ──────────────────────────────────────────────────

  return null;
}
