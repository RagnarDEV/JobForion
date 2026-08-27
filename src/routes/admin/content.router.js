// src/routes/admin/content.router.js
// Content Management — static Pages CMS, the nav-buttons that can link to
// them, and the Blog CMS. See admin.router.js for how every
// admin/*.router.js sub-router is composed.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderPagesListContent, renderPageEditContent, renderPageNewContent } from '../../pages/admin/pages-cms.js';
import { renderBlogListContent, renderBlogEditContent, renderBlogNewContent } from '../../pages/admin/blog-cms.js';
import { adminShell } from '../../pages/admin/shell.js';
import { getPageBySlug, createPage, updatePage, deletePage, movePage } from '../../lib/pages-cms.js';
import { createNavButton, deleteNavButton } from '../../lib/nav-buttons.js';
import { getPostById, createPost, updatePost, deletePost } from '../../lib/blog-cms.js';
import { logActivity } from '../../lib/activity-log.js';
import { errorPage } from './error-page.js';

export async function handleAdminContentRoute(url, request, env, base) {
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
      if (!page) return new Response(adminShell('pages', `<div class="adm-wrap"><div class="adm-card">Page not found. <a href="/admin/pages">Back</a></div></div>`), { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
        custom_html: (form.get('custom_html') || '').toString(),
        custom_css: (form.get('custom_css') || '').toString(),
        custom_js: (form.get('custom_js') || '').toString(),
        status: (form.get('status') || '').toString(),
        scheduled_at: (form.get('scheduled_at') || '').toString(),
        show_in_footer: !!form.get('show_in_footer'),
        show_in_menu: !!form.get('show_in_menu'),
      });
      await logActivity(env, 'page_created', (form.get('slug') || '').toString());
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
        custom_html: (form.get('custom_html') || '').toString(),
        custom_css: (form.get('custom_css') || '').toString(),
        custom_js: (form.get('custom_js') || '').toString(),
        status: (form.get('status') || '').toString(),
        scheduled_at: (form.get('scheduled_at') || '').toString(),
        show_in_footer: !!form.get('show_in_footer'),
        show_in_menu: !!form.get('show_in_menu'),
      });
      await logActivity(env, 'page_updated', slug);
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
      await logActivity(env, 'page_deleted', (form.get('slug') || '').toString());
      return new Response(null, { status: 302, headers: { 'Location': `/admin/pages?flash=${encodeURIComponent('Page deleted')}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Custom menu buttons (see lib/nav-buttons.js) — managed from the
  // same /admin/pages screen since both control what appears in the
  // site's nav/menu. ──────────────────────────────────────────────
  if (url.pathname === '/admin/nav-buttons/create' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await createNavButton(env, {
        label: (form.get('label') || '').toString(),
        url: (form.get('url') || '').toString(),
        icon: (form.get('icon') || '').toString(),
        color: (form.get('color') || '').toString(),
      });
      return new Response(null, { status: 302, headers: { 'Location': `/admin/pages?flash=${encodeURIComponent('Button added')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/nav-buttons/toggle' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      if (id) await env.DB.prepare('UPDATE nav_buttons SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(id).run();
      return new Response(null, { status: 302, headers: { 'Location': '/admin/pages' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/nav-buttons/delete' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      if (id) await deleteNavButton(env, id);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/pages?flash=${encodeURIComponent('Button deleted')}` } });
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
      if (!post) return new Response(adminShell('blog', `<div class="adm-wrap"><div class="adm-card">Article not found. <a href="/admin/blog">Back</a></div></div>`), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response(adminShell('blog', await renderBlogEditContent(env, post)), { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
      await logActivity(env, 'blog_created', (form.get('title') || '').toString());
      return new Response(null, { status: 302, headers: { 'Location': `/admin/blog?flash=${encodeURIComponent('Article created')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/blog/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = parseInt((form.get('id') || '0').toString(), 10);
      // The "Auto-delete this article" checkbox only ever renders for
      // auto_generated posts (see pages/admin/blog-cms.js's postForm) —
      // look the post up first so a manual post's update never
      // accidentally toggles a field it never had a control for.
      const existing = await getPostById(env, id, { includeUnpublished: true });
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
        auto_expire: existing?.auto_generated ? !!form.get('auto_expire') : undefined,
      });
      await logActivity(env, 'blog_updated', (form.get('title') || '').toString());
      return new Response(null, { status: 302, headers: { 'Location': `/admin/blog/edit?id=${id}&flash=${encodeURIComponent('Saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/blog/delete' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await deletePost(env, parseInt((form.get('id') || '0').toString(), 10));
      await logActivity(env, 'blog_deleted', `post #${form.get('id')}`);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/blog?flash=${encodeURIComponent('Article deleted')}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Job Card Style Manager ────────────────────────────────────

  return null;
}
