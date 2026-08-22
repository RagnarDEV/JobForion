// src/routes/api.router.js
// JSON API surface: job search/listing, alert subscription, employer job
// submissions, manual sync trigger, and a tiny debug endpoint.

import { syncJobs } from '../db/sync.js';
import { PROVIDERS } from '../providers/index.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { JOB_TYPE_SORT_SQL, PUBLIC_JOB_STATUS_SQL } from '../config/constants.js';
import { resolveRawNames } from '../lib/directory-overrides.js';
import { getSettings } from '../lib/settings.js';
import { logActivity } from '../lib/activity-log.js';
import { verifyAdminCookie } from '../auth/admin-auth.js';
import { getSessionUser } from '../lib/accounts/session.js';
import { saveJob, unsaveJob } from '../lib/saved-jobs.js';
import { recordApplication } from '../lib/applications.js';
import { getVerifiedCompanyNameSet } from '../lib/companies.js';

export async function handleApiRoute(url, request, env) {
  // ── Account-aware saved-jobs toggle ─────────────────────────────
  // Complements the existing localStorage-based "Saved" button (still
  // used by anonymous visitors — see pages/home.js's client script,
  // completely unchanged) — when a session cookie is present, saves are
  // ALSO persisted server-side so they survive across devices. No
  // existing behavior is removed; this is additive.
  if (url.pathname === '/api/user/saved-jobs' && request.method === 'POST') {
    const session = await getSessionUser(env, request);
    if (!session) return new Response(JSON.stringify({ success: false, error: 'Not signed in' }), { status: 401, headers: { "Content-Type": "application/json" } });
    try {
      const { job_id, action } = await request.json();
      const jobId = parseInt(job_id, 10);
      if (!jobId) return new Response(JSON.stringify({ success: false, error: 'job_id required' }), { status: 400, headers: { "Content-Type": "application/json" } });
      if (action === 'unsave') await unsaveJob(env, session.user.id, jobId);
      else await saveJob(env, session.user.id, jobId);
      return new Response(JSON.stringify({ success: true, saved: action !== 'unsave' }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, error: 'Invalid request' }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === '/api/user/applications' && request.method === 'POST') {
    const session = await getSessionUser(env, request);
    if (!session) return new Response(JSON.stringify({ success: false, error: 'Not signed in' }), { status: 401, headers: { "Content-Type": "application/json" } });
    try {
      const { job_id, status, application_type } = await request.json();
      const jobId = parseInt(job_id, 10);
      if (!jobId) return new Response(JSON.stringify({ success: false, error: 'job_id required' }), { status: 400, headers: { "Content-Type": "application/json" } });
      await recordApplication(env, session.user.id, jobId, { status: status || 'applied', application_type: application_type || 'external' });
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, error: 'Invalid request' }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    const session = await getSessionUser(env, request);
    return new Response(JSON.stringify({ user: session ? { id: session.user.id, email: session.user.email, email_verified: session.user.email_verified } : null }), { headers: { "Content-Type": "application/json" } });
  }

  if (url.pathname === '/api/subscribe' && request.method === 'POST') {
    try {
      // Feature Flag: Job Alerts — see lib/settings.js. Turning this off
      // from /admin/settings stops new subscriptions immediately without
      // touching existing subscriber rows or the sync/cleanup crons.
      const settings = await getSettings(env);
      if (settings.feature_job_alerts === '0') {
        return new Response(JSON.stringify({ success: false, error: "Job alerts are currently disabled." }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(env, `subscribe:${ip}`, { maxRequests: 5, windowMinutes: 60 });
      if (!rl.allowed) {
        return new Response(JSON.stringify({ success: false, error: "Too many attempts. Please try again later." }), { status: 429, headers: { "Content-Type": "application/json" } });
      }
      const { email, keywords } = await request.json();
      if (!email || !keywords?.length) return new Response(JSON.stringify({ success: false, error: "Required" }), { headers: { "Content-Type": "application/json" } });
      await env.DB.prepare("INSERT OR REPLACE INTO subscribers (email,keywords) VALUES (?,?)").bind(email, JSON.stringify(keywords)).run();
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      // SECURITY: never echo e.message to an anonymous caller — it can
      // contain raw D1/SQLite error text (column names, constraint
      // details). Log the real reason server-side only (visible in
      // Cloudflare's Observability tab) and return a generic message,
      // same pattern already used by /api/post-job below.
      console.error('[/api/subscribe]', e && e.stack || e);
      return new Response(JSON.stringify({ success: false, error: "Something went wrong. Please try again." }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (url.pathname === '/api/post-job' && request.method === 'POST') {
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(env, `post-job:${ip}`, { maxRequests: 3, windowMinutes: 60 });
      if (!rl.allowed) {
        return new Response(JSON.stringify({ success: false, error: "Too many submissions. Please try again later." }), { status: 429, headers: { "Content-Type": "application/json" } });
      }
      const b = await request.json();
      const title = (b.title || '').toString().slice(0, 150);
      const company = (b.company || '').toString().slice(0, 100);
      const email = (b.email || '').toString().slice(0, 150);
      const jobUrl = (b.url || '').toString().slice(0, 400);
      if (!title || !company || !email || !jobUrl) {
        return new Response(JSON.stringify({ success: false, error: "Please fill in all required fields." }), { headers: { "Content-Type": "application/json" } });
      }
      await env.DB.prepare(
        `INSERT INTO job_postings (title,company,email,url,location,category,employment_type,remote_type,salary,description,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`
      ).bind(
        title, company, email, jobUrl,
        (b.location || '').toString().slice(0, 100),
        (b.category || '').toString().slice(0, 40),
        (b.employment_type || 'full_time').toString().slice(0, 40),
        (b.remote_type || 'fully_remote').toString().slice(0, 40),
        (b.salary || '').toString().slice(0, 60),
        (b.description || '').toString().slice(0, 4000)
      ).run();
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, error: "Something went wrong. Please try again." }), { status: 500, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === '/api/jobs') {
    // SECURITY / STABILITY: this is the single most D1-expensive public
    // route (multiple LIKE conditions + a COUNT(*) run twice per
    // request) and, until now, the one public data endpoint with no
    // rate limit at all — every write endpoint (subscribe, post-job,
    // admin login) already had one. The limit is generous (well above
    // normal pagination/filter-clicking speed) because this also backs
    // legitimate in-page search-as-you-type; it exists to blunt
    // scraping/DoS, not to throttle real visitors.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rl = await checkRateLimit(env, `api-jobs:${ip}`, { maxRequests: 60, windowMinutes: 1 });
    if (!rl.allowed) {
      return new Response(JSON.stringify({ jobs: [], total: 0, page: 1, error: 'Too many requests. Please slow down.' }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Retry-After": String((rl.retryAfterMinutes || 1) * 60) },
      });
    }
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = 20, offset = (page - 1) * limit;
    const category = url.searchParams.get("category") || "";
    const search = url.searchParams.get("search") || "";
    const remoteType = url.searchParams.get("remote_type") || "";
    const employType = url.searchParams.get("employment_type") || "";
    const seniority = url.searchParams.get("seniority") || "";
    const salaryMin = url.searchParams.get("salary_min") || "";
    const days = url.searchParams.get("days") || "";
    // Country filter — same matching heuristic as jobsByRegion() in
    // lib/entities.js: location is either an exact match ("Germany") or
    // ends with ", <country>" ("Berlin, Germany"), since `location` is
    // free text with no normalized country column.
    const country = url.searchParams.get("country") || "";
    // Skill filter — matches the same jobs.skills JSON column that
    // jobsBySkill() (lib/entities.js) parses via SQLite's json_each,
    // expressed here as a correlated EXISTS subquery so it composes with
    // the other AND-joined conditions on the single `jobs` table.
    const skill = url.searchParams.get("skill") || "";
    // Company filter — exact match on the jobs.company column, same value
    // shape produced by listCompanies() (lib/entities.js).
    const company = url.searchParams.get("company") || "";
    const conditions = [PUBLIC_JOB_STATUS_SQL], params = [];
    if (category) { conditions.push("LOWER(title) LIKE ?"); params.push(`%${category}%`); }
    if (search) { conditions.push("(LOWER(title) LIKE ? OR LOWER(company) LIKE ?)"); params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`); }
    if (remoteType) { conditions.push("remote_type = ?"); params.push(remoteType); }
    if (employType) { conditions.push("employment_type = ?"); params.push(employType); }
    if (seniority) { conditions.push("LOWER(seniority) LIKE ?"); params.push(`%${seniority.toLowerCase()}%`); }
    if (salaryMin) { conditions.push("salary_max_usd >= ?"); params.push(parseInt(salaryMin) * 1000); }
    if (days) { conditions.push("created_at >= datetime('now', '-' || ? || ' days')"); params.push(parseInt(days)); }
    if (country) {
      // See lib/directory-overrides.js: `country` here is the DISPLAY
      // name a user clicked in the filter panel, which may differ from
      // what's literally stored in jobs.location if an admin renamed it
      // at /admin/directory. Resolve back to the raw name(s) first, or
      // this filter would silently return zero results after a rename.
      const rawCountryNames = await resolveRawNames(env, 'country', country);
      if (rawCountryNames.length) {
        conditions.push('(' + rawCountryNames.map(() => '(location = ? OR location LIKE ?)').join(' OR ') + ')');
        params.push(...rawCountryNames.flatMap(n => [n, `%, ${n}`]));
      } else {
        conditions.push('1 = 0'); // renamed-away/hidden country — no matches, not "ignore filter"
      }
    }
    if (skill) {
      const rawSkillNames = await resolveRawNames(env, 'skill', skill);
      if (rawSkillNames.length) {
        conditions.push(`EXISTS (SELECT 1 FROM json_each(jobs.skills) je WHERE je.value IN (${rawSkillNames.map(() => '?').join(',')}))`);
        params.push(...rawSkillNames);
      } else {
        conditions.push('1 = 0');
      }
    }
    if (company) { conditions.push("company = ?"); params.push(company); }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const [{ results }, { results: cr }, verifiedCompanySet] = await Promise.all([
      env.DB.prepare(`SELECT * FROM jobs${where} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, featured DESC, id DESC LIMIT ${limit} OFFSET ${offset}`).bind(...params).all(),
      env.DB.prepare(`SELECT COUNT(*) as total FROM jobs${where}`).bind(...params).all(),
      getVerifiedCompanyNameSet(env), // 60s-cached, see lib/companies.js — drives the "✓ Verified" badge client-side (plan §8)
    ]);
    const jobsWithVerified = (results || []).map(j => ({ ...j, is_verified: verifiedCompanySet.has((j.company || '').toLowerCase()) }));
    return new Response(JSON.stringify({ jobs: jobsWithVerified, total: cr[0]?.total || 0, page }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }

  if (url.pathname === '/api/sync') {
    // SECURITY (critical): this endpoint used to be reachable by ANYONE —
    // no admin check, no rate limit — despite triggering a full,
    // subrequest-expensive multi-provider sync run (9 ATS providers) on
    // every call. The scheduled() cron in index.js calls syncJobs(env)
    // directly in-process and never goes through this HTTP route, so
    // gating the whole endpoint behind the admin cookie breaks nothing:
    // the only legitimate caller left is the "Sync Now" button in
    // pages/admin/system.js / dashboard.js, which already posts from an
    // authenticated same-origin admin page and sends the cookie
    // automatically. Unauthenticated requests now get exactly the same
    // 404 as /api/debug below, so as not to even confirm the route exists.
    const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
    if (!ok) return new Response('Not found', { status: 404 });

    // Defense in depth on top of the auth gate: prevents accidental
    // double-submits or a compromised admin session from hammering every
    // provider's API repeatedly in a short window.
    const rl = await checkRateLimit(env, 'admin-sync', { maxRequests: 6, windowMinutes: 15 });
    if (!rl.allowed) {
      if (request.method === 'POST') {
        return new Response(null, { status: 302, headers: { 'Location': `/admin?flash=${encodeURIComponent('Sync already ran recently — please wait a few minutes.')}` } });
      }
      return new Response(JSON.stringify({ success: false, error: 'Too many sync requests. Please wait a few minutes.' }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    // Manual single-provider sync (plan §13/§21): the "Sync Now" button
    // on each provider card in pages/admin/sources.js posts here with
    // ?provider=greenhouse instead of triggering a full all-providers
    // run — same auth gate, same rate limit, same PROVIDERS registry
    // lookup already used everywhere else, so an unknown/mistyped
    // provider id is caught before syncJobs() even runs a query.
    const onlyProvider = url.searchParams.get('provider') || null;
    if (onlyProvider && !PROVIDERS[onlyProvider]) {
      const msg = `Unknown provider "${onlyProvider}"`;
      if (request.method === 'POST') return new Response(null, { status: 302, headers: { 'Location': `/admin/sources?flash=${encodeURIComponent(msg)}` } });
      return new Response(JSON.stringify({ success: false, error: msg }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    try {
      const result = await syncJobs(env, { onlyProvider });
      if (request.method === 'POST') {
        const label = onlyProvider ? `manual trigger (${onlyProvider})` : 'manual trigger';
        await logActivity(env, 'sync_run', label, `+${result.inserted} jobs, ${(result.errors || []).length} errors`);
        return new Response(null, { status: 302, headers: { 'Location': onlyProvider ? `/admin/sources?flash=${encodeURIComponent(`${onlyProvider}: +${result.inserted} jobs`)}` : '/admin' } });
      }
      return new Response(JSON.stringify({ success: true, ...result }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      // SECURITY: same rationale as /api/subscribe above — never echo
      // e.message to the response body, even to an authenticated admin,
      // since it's still logged permanently to admin_activity_log via the
      // Location redirect path today. Log the real reason server-side.
      console.error('[/api/sync]', e && e.stack || e);
      if (request.method === 'POST') {
        await logActivity(env, 'sync_run', 'manual trigger', 'failed — see Worker logs');
        return new Response(null, { status: 302, headers: { 'Location': `/admin?flash=${encodeURIComponent('Sync failed — check Worker logs for details.')}` } });
      }
      return new Response(JSON.stringify({ success: false, error: "Sync failed. Check Worker logs for details." }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (url.pathname === '/api/debug') {
    // SECURITY: this leaked a live row count to anyone, unauthenticated
    // — harmless on its own, but there's no legitimate reason for it to
    // be public, and "public endpoints that reveal internal state" are
    // exactly what a security review flags on a production site. Gated
    // behind the same admin cookie as everything under /admin instead
    // of deleting it outright, since it's still a genuinely convenient
    // one-line health check for whoever IS logged in.
    const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
    if (!ok) return new Response('Not found', { status: 404 });
    const { results } = await env.DB.prepare("SELECT COUNT(*) as count FROM jobs").all();
    return new Response(JSON.stringify({ jobs_in_db: results[0]?.count || 0 }), { headers: { "Content-Type": "application/json" } });
  }

  return null;
}
