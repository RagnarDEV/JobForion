// src/routes/admin/jobs.router.js
// Job Management — listing/search/edit/delete/feature, Bulk Actions
// (Admin Dashboard V2 Phase 2), and employer-submitted job-posting
// moderation (approve/reject into the live jobs table). See
// admin.router.js for how every admin/*.router.js sub-router is
// composed.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderJobsListContent, renderJobEditContent, renderDuplicatesContent } from '../../pages/admin/jobs.js';
import { adminShell } from '../../pages/admin/shell.js';
import { JOB_TYPE_META } from '../../config/constants.js';
import { getSettings } from '../../lib/settings.js';
import { logActivity } from '../../lib/activity-log.js';
import { errorPage } from './error-page.js';

export async function handleAdminJobsRoute(url, request, env, base) {
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
            // Employer Submitted Jobs (plan §16) — every job approved
            // through this Post-a-Job pipeline is source_type='employer',
            // distinct from provider-synced jobs (source_type defaults to
            // 'provider' for every Greenhouse/Lever/Ashby/etc. row — see
            // ensureAccountTables() in db/schema.js). company_id and
            // submitted_by_user_id are only set when the posting actually
            // came from the new authenticated /company/post-job flow
            // (routes/company.router.js) — the original anonymous public
            // "Post a Job" modal still works exactly as before and simply
            // leaves both NULL, which is a perfectly valid employer job.
            await env.DB.prepare(
              `INSERT OR IGNORE INTO jobs (title,company,location,url,description,salary,remote_type,skills,seniority,employment_type,job_handle,source,source_type,company_id,submitted_by_user_id,status,updated_at,expires_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual','employer',?,?,'active',CURRENT_TIMESTAMP,datetime('now','+45 days'))`
            ).bind(p.title, p.company, p.location || 'Remote', p.url, p.description || '', p.salary || '', p.remote_type || 'fully_remote', '[]', '', p.employment_type || 'full_time', '', p.company_id || null, p.user_id || null).run();
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
      await logActivity(env, 'job_updated', (form.get('title') || '').toString());
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
      await logActivity(env, 'job_deleted', `job #${id}`);
      const sep = redirect.includes('?') ? '&' : '?';
      return new Response(null, { status: 302, headers: { 'Location': `${redirect}${sep}flash=${encodeURIComponent('Job deleted')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/jobs/feature' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      // Feature Flag: Featured Jobs (see lib/settings.js). Blocked at the
      // source — the "Pinned" badge/tint is also fully suppressed
      // site-wide when this is off (see components/job-card.js).
      const settings = await getSettings(env);
      if (settings.feature_featured_jobs === '0') {
        return new Response(null, { status: 302, headers: { 'Location': `/admin/jobs?flash=${encodeURIComponent('Featured Jobs is disabled in Settings')}` } });
      }
      const form = await request.formData();
      const id = form.get('id');
      const redirect = (form.get('redirect') || '/admin/jobs').toString();
      if (id) await env.DB.prepare('UPDATE jobs SET featured = CASE WHEN featured = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(id).run();
      await logActivity(env, 'job_featured_toggled', `job #${id}`);
      const sep = redirect.includes('?') ? '&' : '?';
      return new Response(null, { status: 302, headers: { 'Location': `${redirect}${sep}flash=${encodeURIComponent('Job pin updated')}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Bulk Actions (Admin Dashboard V2, Phase 2) ──────────────────────
  // Handles every action the bulk bar in pages/admin/jobs.js can send:
  // delete / feature / unfeature / set_job_type. Same D1 batch pattern
  // already used everywhere else in this codebase (db/cleanup.js,
  // db/sync.js) — chunked so a large selection never sends one
  // enormous SQL statement, and capped at 500 ids per request so a
  // malformed/huge form post can't turn into an unbounded operation.
  if (url.pathname === '/admin/jobs/bulk' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const action = (form.get('bulk_action') || '').toString();
      const redirect = (form.get('redirect') || '/admin/jobs').toString();
      const sep = redirect.includes('?') ? '&' : '?';
      const ids = form.getAll('ids')
        .map(v => parseInt(v.toString(), 10))
        .filter(n => Number.isInteger(n) && n > 0)
        .slice(0, 500);

      if (!ids.length) {
        return new Response(null, { status: 302, headers: { 'Location': `${redirect}${sep}flash=${encodeURIComponent('No jobs selected')}` } });
      }

      const BULK_CHUNK = 100; // D1 caps bound parameters per statement at 100 — see db/cleanup.js for the same constraint
      const chunks = [];
      for (let i = 0; i < ids.length; i += BULK_CHUNK) chunks.push(ids.slice(i, i + BULK_CHUNK));

      let changed = 0;
      let flashMsg = '';

      if (action === 'delete') {
        for (const chunk of chunks) {
          const placeholders = chunk.map(() => '?').join(',');
          const r = await env.DB.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).bind(...chunk).run();
          changed += r.meta?.changes || 0;
        }
        flashMsg = `Deleted ${changed} job${changed === 1 ? '' : 's'}`;
        await logActivity(env, 'jobs_bulk_deleted', `${changed} jobs (manual selection)`);
      } else if (action === 'feature' || action === 'unfeature') {
        const settings = await getSettings(env);
        if (settings.feature_featured_jobs === '0') {
          return new Response(null, { status: 302, headers: { 'Location': `${redirect}${sep}flash=${encodeURIComponent('Featured Jobs is disabled in Settings')}` } });
        }
        const val = action === 'feature' ? 1 : 0;
        for (const chunk of chunks) {
          const placeholders = chunk.map(() => '?').join(',');
          const r = await env.DB.prepare(`UPDATE jobs SET featured = ? WHERE id IN (${placeholders})`).bind(val, ...chunk).run();
          changed += r.meta?.changes || 0;
        }
        flashMsg = `${action === 'feature' ? 'Pinned' : 'Unpinned'} ${changed} job${changed === 1 ? '' : 's'}`;
        await logActivity(env, 'job_featured_toggled', `${changed} jobs → ${action}`);
      } else if (action === 'set_job_type') {
        const jobType = (form.get('job_type_value') || '').toString();
        if (!JOB_TYPE_META[jobType]) {
          return new Response(null, { status: 302, headers: { 'Location': `${redirect}${sep}flash=${encodeURIComponent('Invalid job type')}` } });
        }
        for (const chunk of chunks) {
          const placeholders = chunk.map(() => '?').join(',');
          const r = await env.DB.prepare(`UPDATE jobs SET job_type = ? WHERE id IN (${placeholders})`).bind(jobType, ...chunk).run();
          changed += r.meta?.changes || 0;
        }
        flashMsg = `Set ${changed} job${changed === 1 ? '' : 's'} to ${jobType}`;
        await logActivity(env, 'job_type_bulk_changed', `${changed} jobs → ${jobType}`);
      } else {
        return new Response(null, { status: 302, headers: { 'Location': `${redirect}${sep}flash=${encodeURIComponent('Unknown bulk action')}` } });
      }

      return new Response(null, { status: 302, headers: { 'Location': `${redirect}${sep}flash=${encodeURIComponent(flashMsg)}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/jobs/delete-stale' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const days = Math.max(7, parseInt(form.get('days') || '45', 10) || 45);
      const r = await env.DB.prepare(`DELETE FROM jobs WHERE created_at < datetime('now', '-' || ? || ' day')`).bind(days).run();
      await logActivity(env, 'jobs_bulk_deleted', `${r.meta?.changes || 0} jobs older than ${days}d`);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/jobs?flash=${encodeURIComponent(`Deleted ${r.meta?.changes || 0} stale jobs`)}` } });
    } catch (e) { return errorPage(e); }
  }


  return null;
}
