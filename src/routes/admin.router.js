// src/routes/admin.router.js
// Everything under /admin — cookie-gated dashboard, API-source management,
// job-posting moderation. Data-mutating endpoints (POST) verify the signed
// admin cookie before touching D1.
//
// UPDATE: every branch is now wrapped in try/catch. Previously an uncaught
// exception anywhere in this file (a transient D1 error, a bad bind value,
// a timeout) would bubble all the way up and Cloudflare would show its
// generic "Error 1101 — Worker threw exception" page, with zero detail on
// what actually went wrong. Now the real error message is rendered inline
// so it can be diagnosed immediately instead of guessing.

import { makeAdminCookie, verifyAdminCookie } from '../auth/admin-auth.js';
import { renderAdminLogin, renderAdminDashboard } from '../pages/admin.js';
import { insertApiSource } from '../db/sync.js';
import { cleanupStaleJobs } from '../db/cleanup.js';
import { renderJobsListContent, renderJobEditContent, renderDuplicatesContent } from '../pages/admin/jobs.js';
import { renderCompaniesListContent } from '../pages/admin/companies.js';
import { renderSettingsContent } from '../pages/admin/settings.js';
import { renderCategoriesContent } from '../pages/admin/categories.js';
import { renderDirectoryContent } from '../pages/admin/directory.js';
import { renderPagesListContent, renderPageEditContent, renderPageNewContent } from '../pages/admin/pages-cms.js';
import { renderBlogListContent, renderBlogEditContent, renderBlogNewContent } from '../pages/admin/blog-cms.js';
import { renderCardStylesContent } from '../pages/admin/card-styles.js';
import { renderAdsContent } from '../pages/admin/ads.js';
import { adminShell } from '../pages/admin/shell.js';
import { JOB_TYPE_META } from '../config/constants.js';
import { setSettings, SETTINGS_KEYS } from '../lib/settings.js';
import { createCategory, updateCategory, deleteCategory, moveCategory } from '../lib/categories.js';
import { setOverride, clearOverride, DIRECTORY_KINDS } from '../lib/directory-overrides.js';
import { getPageBySlug, createPage, updatePage, deletePage, movePage } from '../lib/pages-cms.js';
import { getPostById, createPost, updatePost, deletePost } from '../lib/blog-cms.js';
import { updateCardStyle, resetCardStyle, CARD_STYLE_JOB_TYPES } from '../lib/job-card-styles.js';
import { updateAdSlot, resetAdSlot, AD_SLOT_DEFS } from '../lib/ad-slots.js';

function errorPage(err) {
  const msg = (err && err.message ? err.message : String(err)).replace(/</g, '&lt;');
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Error — JobForion</title><meta name="robots" content="noindex, nofollow">
<style>
body{font-family:-apple-system,sans-serif;background:#03060F;color:#E8F0FF;padding:40px 20px;max-width:640px;margin:0 auto;line-height:1.6}
.box{background:#111F35;border:1px solid #1E3352;border-radius:14px;padding:26px}
h1{font-size:18px;color:#FF5C7A;margin-bottom:14px}
p{font-size:13px;color:#8BA5CC;margin-bottom:12px}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:#03060F;padding:14px;border-radius:10px;color:#8BA5CC;overflow:auto;border:1px solid #152236}
a{color:#4F8EF7;text-decoration:none;font-weight:600}
a:hover{text-decoration:underline}
</style></head><body>
<div class="box">
<h1>⚠️ حدث خطأ أثناء تنفيذ العملية</h1>
<p>هذه رسالة الخطأ الفعلية القادمة من الخادم أو قاعدة البيانات:</p>
<pre>${msg}</pre>
<p style="margin-top:18px"><a href="/admin">← العودة إلى لوحة التحكم</a></p>
</div>
</body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function handleAdminRoute(url, request, env, base) {
  if (url.pathname === '/admin/login' && request.method === 'POST') {
    try {
      const form = await request.formData();
      const pw = form.get('password') || '';
      if (env.ADMIN_PASSWORD && pw === env.ADMIN_PASSWORD) {
        const cookie = await makeAdminCookie(env);
        return new Response(null, { status: 302, headers: { 'Location': '/admin', 'Set-Cookie': `jn_admin=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400` } });
      }
      return new Response(renderAdminLogin(true), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/logout') {
    return new Response(null, { status: 302, headers: { 'Location': '/admin', 'Set-Cookie': 'jn_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
  }

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
      }
      return new Response(null, { status: 302, headers: { 'Location': '/admin' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/api-sources/delete' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      if (id) await env.DB.prepare("DELETE FROM api_sources WHERE id = ?").bind(id).run();
      return new Response(null, { status: 302, headers: { 'Location': '/admin' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/postings/approve' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      if (id) {
        const { results } = await env.DB.prepare("SELECT * FROM job_postings WHERE id = ?").bind(id).all();
        const p = results[0];
        if (p) {
          try {
            await env.DB.prepare(
              `INSERT OR IGNORE INTO jobs (title,company,location,url,description,salary,remote_type,skills,seniority,employment_type,job_handle,source,status,updated_at,expires_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual','active',CURRENT_TIMESTAMP,datetime('now','+45 days'))`
            ).bind(p.title, p.company, p.location || 'Remote', p.url, p.description || '', p.salary || '', p.remote_type || 'fully_remote', '[]', '', p.employment_type || 'full_time', '').run();
            await env.DB.prepare("UPDATE job_postings SET status='approved' WHERE id = ?").bind(id).run();
          } catch (e) { /* keep posting pending rather than crash the whole request */ }
        }
      }
      return new Response(null, { status: 302, headers: { 'Location': '/admin' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/postings/reject' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      if (id) await env.DB.prepare("UPDATE job_postings SET status='rejected' WHERE id = ?").bind(id).run();
      return new Response(null, { status: 302, headers: { 'Location': '/admin' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/jobs' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderJobsListContent(env, url.searchParams);
      return new Response(adminShell('jobs', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/jobs/edit' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const id = url.searchParams.get('id');
      const content = await renderJobEditContent(env, id);
      return new Response(adminShell('jobs', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/jobs/duplicates' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderDuplicatesContent(env);
      return new Response(adminShell('jobs', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/companies' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderCompaniesListContent(env, url.searchParams);
      return new Response(adminShell('companies', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/companies/hide' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const company = (form.get('company') || '').toString().trim();
      if (company) {
        await env.DB.prepare("INSERT OR IGNORE INTO hidden_companies (company_lower) VALUES (?)").bind(company.toLowerCase()).run();
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
      }
      return new Response(null, { status: 302, headers: { 'Location': `/admin/companies?flash=${encodeURIComponent('Company unhidden')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/settings' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderSettingsContent(env);
      return new Response(adminShell('settings', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/settings/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      // Explicit allow-list (SETTINGS_KEYS) rather than trusting arbitrary
      // posted field names — setSettings() also enforces this itself, but
      // filtering here too keeps the intent obvious at the call site.
      const updates = {};
      for (const key of SETTINGS_KEYS) {
        if (key === 'maintenance_mode') { updates[key] = form.get('maintenance_mode') ? '1' : '0'; continue; }
        if (form.has(key)) updates[key] = (form.get(key) || '').toString().slice(0, 2000);
      }
      await setSettings(env, updates);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/settings?flash=${encodeURIComponent('Settings saved')}` } });
    } catch (e) { return errorPage(e); }
  }

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
  if (url.pathname === '/admin/pages' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderPagesListContent(env);
      return new Response(adminShell('pages', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/pages/new' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response(adminShell('pages', renderPageNewContent()), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/pages/edit' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const slug = url.searchParams.get('slug') || '';
      const page = await getPageBySlug(env, slug, { includeUnpublished: true });
      if (!page) return new Response(adminShell('pages', `<div class="adm-wrap"><div class="adm-card">Page not found. <a href="/admin/pages">← Back</a></div></div>`), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response(adminShell('pages', renderPageEditContent(page)), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/pages/create' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await createPage(env, {
        slug: (form.get('slug') || '').toString().trim().toLowerCase(),
        title: (form.get('title') || '').toString(),
        meta_description: (form.get('meta_description') || '').toString(),
        body: (form.get('body') || '').toString(),
        status: (form.get('status') || '').toString(),
        scheduled_at: (form.get('scheduled_at') || '').toString(),
        show_in_footer: !!form.get('show_in_footer'),
      });
      return new Response(null, { status: 302, headers: { 'Location': `/admin/pages?flash=${encodeURIComponent('Page created')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/pages/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const slug = (form.get('slug') || '').toString();
      await updatePage(env, slug, {
        title: (form.get('title') || '').toString(),
        meta_description: (form.get('meta_description') || '').toString(),
        body: (form.get('body') || '').toString(),
        status: (form.get('status') || '').toString(),
        scheduled_at: (form.get('scheduled_at') || '').toString(),
        show_in_footer: !!form.get('show_in_footer'),
      });
      return new Response(null, { status: 302, headers: { 'Location': `/admin/pages/edit?slug=${encodeURIComponent(slug)}&flash=${encodeURIComponent('Saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/pages/move' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await movePage(env, (form.get('slug') || '').toString(), (form.get('direction') || '').toString());
      return new Response(null, { status: 302, headers: { 'Location': '/admin/pages' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/pages/delete' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await deletePage(env, (form.get('slug') || '').toString());
      return new Response(null, { status: 302, headers: { 'Location': `/admin/pages?flash=${encodeURIComponent('Page deleted')}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Blog CMS ───────────────────────────────────────────────────
  if (url.pathname === '/admin/blog' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderBlogListContent(env);
      return new Response(adminShell('blog', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/blog/new' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response(adminShell('blog', renderBlogNewContent()), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/blog/edit' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const id = parseInt(url.searchParams.get('id') || '0', 10);
      const post = await getPostById(env, id, { includeUnpublished: true });
      if (!post) return new Response(adminShell('blog', `<div class="adm-wrap"><div class="adm-card">Article not found. <a href="/admin/blog">← Back</a></div></div>`), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response(adminShell('blog', renderBlogEditContent(post)), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/blog/create' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await createPost(env, {
        title: (form.get('title') || '').toString(),
        excerpt: (form.get('excerpt') || '').toString(),
        body: (form.get('body') || '').toString(),
        category: (form.get('category') || '').toString(),
        tags: (form.get('tags') || '').toString().split(',').map(t => t.trim()).filter(Boolean),
        cover_image_url: (form.get('cover_image_url') || '').toString(),
        status: (form.get('status') || '').toString(),
        scheduled_at: (form.get('scheduled_at') || '').toString(),
        read_time: (form.get('read_time') || '').toString(),
      });
      return new Response(null, { status: 302, headers: { 'Location': `/admin/blog?flash=${encodeURIComponent('Article created')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/blog/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = parseInt((form.get('id') || '0').toString(), 10);
      await updatePost(env, id, {
        title: (form.get('title') || '').toString(),
        excerpt: (form.get('excerpt') || '').toString(),
        body: (form.get('body') || '').toString(),
        category: (form.get('category') || '').toString(),
        tags: (form.get('tags') || '').toString().split(',').map(t => t.trim()).filter(Boolean),
        cover_image_url: (form.get('cover_image_url') || '').toString(),
        status: (form.get('status') || '').toString(),
        scheduled_at: (form.get('scheduled_at') || '').toString(),
        read_time: (form.get('read_time') || '').toString(),
      });
      return new Response(null, { status: 302, headers: { 'Location': `/admin/blog/edit?id=${id}&flash=${encodeURIComponent('Saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/blog/delete' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await deletePost(env, parseInt((form.get('id') || '0').toString(), 10));
      return new Response(null, { status: 302, headers: { 'Location': `/admin/blog?flash=${encodeURIComponent('Article deleted')}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Job Card Style Manager ────────────────────────────────────
  if (url.pathname === '/admin/card-styles' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderCardStylesContent(env);
      return new Response(adminShell('card-styles', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/card-styles/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const jobType = (form.get('job_type') || '').toString();
      if (!CARD_STYLE_JOB_TYPES.includes(jobType)) return new Response('Invalid job type', { status: 400 });
      await updateCardStyle(env, jobType, {
        bg_type: (form.get('bg_type') || '').toString(),
        bg_color1: (form.get('bg_color1') || '').toString(),
        bg_color2: (form.get('bg_color2') || '').toString(),
        gradient_angle: form.get('gradient_angle'),
        border_style: (form.get('border_style') || '').toString(),
        border_color: (form.get('border_color') || '').toString(),
        border_width: form.get('border_width'),
        logo_size: form.get('logo_size'),
        card_padding: form.get('card_padding'),
        shadow: (form.get('shadow') || '').toString(),
        badge_bg_color: (form.get('badge_bg_color') || '').toString(),
        badge_text_color: (form.get('badge_text_color') || '').toString(),
      });
      return new Response(null, { status: 302, headers: { 'Location': `/admin/card-styles?flash=${encodeURIComponent(jobType + ' style saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/card-styles/reset' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const jobType = (form.get('job_type') || '').toString();
      if (!CARD_STYLE_JOB_TYPES.includes(jobType)) return new Response('Invalid job type', { status: 400 });
      await resetCardStyle(env, jobType);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/card-styles?flash=${encodeURIComponent(jobType + ' reset to default')}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Ads ────────────────────────────────────────────────────────
  if (url.pathname === '/admin/ads' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderAdsContent(env);
      return new Response(adminShell('ads', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/ads/toggle-global' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await setSettings(env, { ads_enabled: form.get('ads_enabled') ? '1' : '0' });
      return new Response(null, { status: 302, headers: { 'Location': `/admin/ads?flash=${encodeURIComponent('Saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/ads/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const slotId = (form.get('slot_id') || '').toString();
      if (!AD_SLOT_DEFS.some(s => s.id === slotId)) return new Response('Invalid slot', { status: 400 });
      await updateAdSlot(env, slotId, {
        code: (form.get('code') || '').toString(),
        enabled: !!form.get('enabled'),
        width: form.get('width'),
        height: form.get('height'),
      });
      return new Response(null, { status: 302, headers: { 'Location': `/admin/ads?flash=${encodeURIComponent('Ad slot saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/ads/reset' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const slotId = (form.get('slot_id') || '').toString();
      if (!AD_SLOT_DEFS.some(s => s.id === slotId)) return new Response('Invalid slot', { status: 400 });
      await resetAdSlot(env, slotId);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/ads?flash=${encodeURIComponent('Reset to default')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/jobs/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      if (!id) return new Response(null, { status: 302, headers: { 'Location': '/admin/jobs' } });
      const skills = (form.get('skills') || '').toString().split(',').map(s => s.trim()).filter(Boolean);
      const submittedJobType = (form.get('job_type') || '').toString();
      const jobType = JOB_TYPE_META[submittedJobType] ? submittedJobType : 'Free';
      await env.DB.prepare(
        `UPDATE jobs SET title=?, company=?, location=?, url=?, salary=?, seniority=?, remote_type=?, employment_type=?, skills=?, description=?, featured=?, job_type=?, job_type_note=? WHERE id=?`
      ).bind(
        (form.get('title') || '').toString().slice(0, 200),
        (form.get('company') || '').toString().slice(0, 200),
        (form.get('location') || '').toString().slice(0, 200),
        (form.get('url') || '').toString().slice(0, 500),
        (form.get('salary') || '').toString().slice(0, 60),
        (form.get('seniority') || '').toString().slice(0, 60),
        (form.get('remote_type') || '').toString(),
        (form.get('employment_type') || '').toString(),
        JSON.stringify(skills),
        (form.get('description') || '').toString().slice(0, 20000),
        form.get('featured') ? 1 : 0,
        jobType,
        (form.get('job_type_note') || '').toString().slice(0, 140),
        id
      ).run();
      return new Response(null, { status: 302, headers: { 'Location': `/admin/jobs/edit?id=${id}&flash=${encodeURIComponent('Job updated')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/jobs/delete' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      const redirect = (form.get('redirect') || '/admin/jobs').toString();
      if (id) await env.DB.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run();
      const sep = redirect.includes('?') ? '&' : '?';
      return new Response(null, { status: 302, headers: { 'Location': `${redirect}${sep}flash=${encodeURIComponent('Job deleted')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/jobs/feature' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      const redirect = (form.get('redirect') || '/admin/jobs').toString();
      if (id) await env.DB.prepare('UPDATE jobs SET featured = CASE WHEN featured = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(id).run();
      const sep = redirect.includes('?') ? '&' : '?';
      return new Response(null, { status: 302, headers: { 'Location': `${redirect}${sep}flash=${encodeURIComponent('Job pin updated')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/jobs/delete-stale' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const days = Math.max(7, parseInt(form.get('days') || '45', 10) || 45);
      const r = await env.DB.prepare(`DELETE FROM jobs WHERE created_at < datetime('now', '-' || ? || ' day')`).bind(days).run();
      return new Response(null, { status: 302, headers: { 'Location': `/admin/jobs?flash=${encodeURIComponent(`Deleted ${r.meta?.changes || 0} stale jobs`)}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/cleanup' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const result = await cleanupStaleJobs(env);
      return new Response(null, { status: 302, headers: { 'Location': `/admin?flash=${encodeURIComponent(`Cleanup ran — deleted ${result.deleted} jobs`)}` } });
    } catch (e) { return errorPage(e); }
  }

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
