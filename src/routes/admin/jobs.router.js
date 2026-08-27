// src/routes/admin/jobs.router.js
// Job Management — listing/search/edit/delete/feature, Bulk Actions
// (Admin Dashboard V2 Phase 2), and employer-submitted job-posting
// moderation (approve/reject into the live jobs table). See
// admin.router.js for how every admin/*.router.js sub-router is
// composed.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderJobsListContent, renderJobEditContent, renderDuplicatesContent, buildJobsFilterSql } from '../../pages/admin/jobs.js';
import { adminShell } from '../../pages/admin/shell.js';
import { JOB_TYPE_META } from '../../config/constants.js';
import { getSettings } from '../../lib/settings.js';
import { logActivity } from '../../lib/activity-log.js';
import { errorPage } from './error-page.js';
import { salaryClassificationForJob } from '../../lib/salary-tier.js';

export async function handleAdminJobsRoute(url, request, env, base) {
  // ── CSV Export (plan §22) — admin-only, respects whatever filters are
  // currently active in the query string (shares buildJobsFilterSql with
  // the list page so the two can never disagree about what "current
  // filters" means). Capped at 5000 rows in one export; anything beyond
  // that should be narrowed with filters first rather than pulling the
  // entire table into memory in one Worker invocation.
  if (url.pathname === '/admin/jobs/export' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const { whereSql, binds } = buildJobsFilterSql(url.searchParams);
      const { results } = await env.DB.prepare(
        `SELECT id,title,company,location,remote_type,employment_type,seniority,salary,status,source,source_type,job_type,featured,created_at,updated_at,expires_at,url FROM jobs ${whereSql} ORDER BY id DESC LIMIT 5000`
      ).bind(...binds).all();

      // RFC 4180 quoting + a defense against "CSV/formula injection": if a
      // field's first character is one Excel/Sheets treats as a formula
      // trigger (=,+,-,@), a leading tab is prepended so it's imported as
      // inert text instead of executed as a formula when someone opens
      // this export — the same mitigation OWASP recommends for any
      // user-influenced CSV export (job titles/company names here
      // ultimately come from external providers or employer submissions,
      // so they're not trusted input).
      const csvCell = (v) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@]/.test(s)) s = '\t' + s;
        if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
      };
      const header = ['ID', 'Title', 'Company', 'Location', 'Remote Type', 'Employment Type', 'Seniority', 'Salary', 'Status', 'Source', 'Source Type', 'Job Type', 'Featured', 'Created', 'Updated', 'Expires', 'Apply URL'];
      const lines = [header.map(csvCell).join(',')];
      for (const j of results || []) {
        lines.push([j.id, j.title, j.company, j.location, j.remote_type, j.employment_type, j.seniority, j.salary, j.status, j.source, j.source_type, j.job_type, j.featured ? 'Yes' : 'No', j.created_at, j.updated_at, j.expires_at, j.url].map(csvCell).join(','));
      }
      await logActivity(env, 'jobs_exported_csv', `${(results || []).length} rows`);
      return new Response(lines.join('\r\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="jobforion-jobs-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
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
            //
            // skills/seniority carry straight through from job_postings
            // (Stage 4: Professional Post a Job) instead of being
            // hardcoded to '[]'/'' as before — p.skills is already a JSON
            // array string in the exact shape jobs.skills expects, since
            // routes/company.router.js writes it with JSON.stringify().
            //
            // salary_min_usd/salary_max_usd were NEVER populated for
            // employer-submitted jobs before this — re-parsing p.salary
            // through the same lib/salary.js used for every provider-
            // synced job is what makes an employer job's "Hot 🔥" badge,
            // salary sort, and salary_min search filter all work
            // identically to a synced one.
            const settings = await getSettings(env);
            const classification = salaryClassificationForJob(p, settings);
            const parsedSalary = classification.parsed;
            const salaryTier = classification;
            const insertResult = await env.DB.prepare(
              `INSERT OR IGNORE INTO jobs (title,company,location,url,description,salary,remote_type,skills,seniority,employment_type,job_handle,source,source_type,company_id,submitted_by_user_id,salary_min_usd,salary_max_usd,salary_tier,salary_tier_confidence,status,updated_at,expires_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual','employer',?,?,?,?,?,?,'active',CURRENT_TIMESTAMP,datetime('now','+45 days'))`
            ).bind(
              p.title, p.company, p.location || 'Remote', p.url, p.description || '', p.salary || '', p.remote_type || 'fully_remote',
              p.skills || '[]', p.seniority || '', p.employment_type || 'full_time', '',
              p.company_id || null, p.user_id || null, parsedSalary.annualMinUsd, parsedSalary.annualMaxUsd, salaryTier.tier, salaryTier.confidence
            ).run();
            await env.DB.prepare("UPDATE job_postings SET status='approved' WHERE id = ?").bind(id).run();
            // Duplicate Detection (plan §11): jobs.url is UNIQUE, so
            // INSERT OR IGNORE silently matches zero rows when this exact
            // apply URL already belongs to another job (provider-synced
            // or a previously-approved posting) — the posting is still
            // marked 'approved' (from the employer's point of view it
            // genuinely was), but the audit log makes the "why didn't a
            // new job appear" case visible to whoever approved it instead
            // of it looking like approval silently did nothing.
            const wasDuplicate = !insertResult.meta?.changes;
            await logActivity(env, 'posting_approved', p.title, { companyId: p.company_id || undefined, duplicateUrl: wasDuplicate || undefined });
          } catch (e) { /* keep posting pending rather than crash the whole request */ }
        }
      }
      return new Response(null, { status: 302, headers: { 'Location': `/admin?flash=${encodeURIComponent('Posting approved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/postings/reject' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const id = form.get('id');
      // Rejection reason (plan §10) — a fixed dropdown reason plus an
      // optional free-text note, concatenated into one column rather than
      // two, since nothing downstream (company jobs page, this admin
      // list) needs to distinguish them separately.
      const reasonCode = (form.get('reason') || '').toString().slice(0, 60);
      const reasonNote = (form.get('reason_note') || '').toString().trim().slice(0, 300);
      const reason = [reasonCode, reasonNote].filter(Boolean).join(' — ') || null;
      if (id) {
        await env.DB.prepare("UPDATE job_postings SET status='rejected', rejection_reason = ? WHERE id = ?").bind(reason, id).run();
        await logActivity(env, 'posting_rejected', String(id), { reason: reasonCode || undefined });
      }
      return new Response(null, { status: 302, headers: { 'Location': `/admin?flash=${encodeURIComponent('Posting rejected')}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Bulk approve/reject for job_postings (plan §8) — separate from
  // the /admin/jobs/bulk handler above since job_postings and jobs are
  // different tables with different status vocabularies (see
  // POSTING_STATUS_META vs JOB_STATUS_META). Approving in bulk reuses
  // the exact same per-row insert logic as the single approve handler
  // above (duplicate-URL detection included) rather than a fast-path
  // batch INSERT, since each posting needs its own parseSalary() call
  // and its own INSERT OR IGNORE dedupe check against jobs.url.
  if (url.pathname === '/admin/postings/bulk' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const action = (form.get('bulk_action') || '').toString();
      const ids = form.getAll('ids').map(v => parseInt(v.toString(), 10)).filter(n => Number.isInteger(n) && n > 0).slice(0, 200);
      if (!ids.length || !['approve', 'reject'].includes(action)) {
        return new Response(null, { status: 302, headers: { 'Location': `/admin?flash=${encodeURIComponent('No postings selected')}` } });
      }

      let changed = 0;
      const settings = action === 'approve' ? await getSettings(env) : null;
      if (action === 'reject') {
        const reasonCode = (form.get('reason') || 'Other').toString().slice(0, 60);
        const placeholders = ids.map(() => '?').join(',');
        const r = await env.DB.prepare(`UPDATE job_postings SET status='rejected', rejection_reason = ? WHERE id IN (${placeholders}) AND status = 'pending'`).bind(reasonCode, ...ids).run();
        changed = r.meta?.changes || 0;
        await logActivity(env, 'postings_bulk_rejected', `${changed} postings`, { reason: reasonCode });
      } else {
        for (const id of ids) {
          try {
            const { results } = await env.DB.prepare("SELECT * FROM job_postings WHERE id = ? AND status = 'pending'").bind(id).all();
            const p = results[0];
            if (!p) continue;
            const classification = salaryClassificationForJob(p, settings);
            const parsedSalary = classification.parsed;
            const salaryTier = classification;
            await env.DB.prepare(
              `INSERT OR IGNORE INTO jobs (title,company,location,url,description,salary,remote_type,skills,seniority,employment_type,job_handle,source,source_type,company_id,submitted_by_user_id,salary_min_usd,salary_max_usd,salary_tier,salary_tier_confidence,status,updated_at,expires_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual','employer',?,?,?,?,?,?,'active',CURRENT_TIMESTAMP,datetime('now','+45 days'))`
            ).bind(
              p.title, p.company, p.location || 'Remote', p.url, p.description || '', p.salary || '', p.remote_type || 'fully_remote',
              p.skills || '[]', p.seniority || '', p.employment_type || 'full_time', '',
              p.company_id || null, p.user_id || null, parsedSalary.annualMinUsd, parsedSalary.annualMaxUsd, salaryTier.tier, salaryTier.confidence
            ).run();
            await env.DB.prepare("UPDATE job_postings SET status='approved' WHERE id = ?").bind(id).run();
            changed++;
          } catch (e) { /* one bad posting must not abort the rest of the batch */ }
        }
        await logActivity(env, 'postings_bulk_approved', `${changed} postings`);
      }

      return new Response(null, { status: 302, headers: { 'Location': `/admin?flash=${encodeURIComponent(`${changed} posting${changed === 1 ? '' : 's'} ${action === 'approve' ? 'approved' : 'rejected'}`)}` } });
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
      const editedSalary = (form.get('salary') || '').toString().slice(0, 60);
      const editedDescription = (form.get('description') || '').toString().slice(0, 20000);
      const settings = await getSettings(env);
      const classification = salaryClassificationForJob({ salary: editedSalary, description: editedDescription }, settings);
      const parsedSalary = classification.parsed;
      const salaryTier = classification;
      await env.DB.prepare(
        `UPDATE jobs SET title=?, company=?, location=?, url=?, salary=?, seniority=?, remote_type=?, employment_type=?, skills=?, description=?, salary_min_usd=?, salary_max_usd=?, salary_tier=?, salary_tier_confidence=?, featured=?, job_type=?, job_type_note=? WHERE id=?`
      ).bind(
        (form.get('title') || '').toString().slice(0, 200),
        (form.get('company') || '').toString().slice(0, 200),
        (form.get('location') || '').toString().slice(0, 200),
        (form.get('url') || '').toString().slice(0, 500),
        editedSalary,
        (form.get('seniority') || '').toString().slice(0, 60),
        (form.get('remote_type') || '').toString(),
        (form.get('employment_type') || '').toString(),
        JSON.stringify(skills),
        editedDescription,
        parsedSalary.annualMinUsd, parsedSalary.annualMaxUsd, salaryTier.tier, salaryTier.confidence,
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
      } else if (['pause', 'resume', 'close', 'archive', 'restore'].includes(action)) {
        // Bulk status transitions (plan §8/§25) — reuses the exact same
        // status vocabulary as db/cleanup.js's lifecycle and the
        // company-facing pause/resume/close/archive actions in
        // routes/company.router.js, so a job bulk-paused here behaves
        // identically to one a company paused themselves (same
        // PUBLIC_JOB_STATUS_SQL exclusion, same eventual cleanup timeline
        // once archived).
        const newStatus = action === 'restore' ? 'active' : action === 'resume' ? 'active' : action + 'd';
        for (const chunk of chunks) {
          const placeholders = chunk.map(() => '?').join(',');
          const r = await env.DB.prepare(`UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).bind(newStatus, ...chunk).run();
          changed += r.meta?.changes || 0;
        }
        flashMsg = `${changed} job${changed === 1 ? '' : 's'} → ${newStatus}`;
        await logActivity(env, 'jobs_bulk_status_changed', `${changed} jobs → ${newStatus} (manual selection)`);
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
      const days = Math.min(3650, Math.max(7, parseInt(form.get('days') || '45', 10) || 45));
      // Manual stale cleanup must follow the same soft lifecycle as the
      // scheduled cleaner. Hard-deleting here used to orphan saved_jobs,
      // applications, and job_intelligence rows and could remove a live job
      // solely because its created_at was old. Mark rows expired instead;
      // the daily cleanup owns the later archived → deleted transition.
      const r = await env.DB.prepare(
        `UPDATE jobs SET status = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE status NOT IN ('expired', 'archived')
           AND created_at < datetime('now', '-' || ? || ' day')
           AND (updated_at IS NULL OR updated_at < datetime('now', '-' || ? || ' day'))`
      ).bind(days, days).run();
      await logActivity(env, 'jobs_bulk_status_changed', `${r.meta?.changes || 0} jobs marked expired after ${days}d`);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/jobs?flash=${encodeURIComponent(`Marked ${r.meta?.changes || 0} stale jobs expired`)}` } });
    } catch (e) { return errorPage(e); }
  }


  return null;
}
