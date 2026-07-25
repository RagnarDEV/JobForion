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
import { adminShell } from '../pages/admin/shell.js';

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
      const provider = (form.get('provider') || 'jobdatalake').toString().trim().slice(0, 40);
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

  if (url.pathname === '/admin/jobs/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      if (!id) return new Response(null, { status: 302, headers: { 'Location': '/admin/jobs' } });
      const skills = (form.get('skills') || '').toString().split(',').map(s => s.trim()).filter(Boolean);
      await env.DB.prepare(
        `UPDATE jobs SET title=?, company=?, location=?, url=?, salary=?, seniority=?, remote_type=?, employment_type=?, skills=?, description=?, featured=? WHERE id=?`
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
