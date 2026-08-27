// src/routes/api.router.js
// JSON API surface: job search/listing, alert subscription, employer job
// submissions, manual sync trigger, and a tiny debug endpoint.

import { syncJobs } from '../db/sync.js';
import { PROVIDERS } from '../providers/index.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { PUBLIC_JOB_STATUS_SQL, JOB_LISTING_COLUMNS, JOB_SORT_OPTIONS } from '../config/constants.js';
import { resolveRawNames } from '../lib/directory-overrides.js';
import { getSettings } from '../lib/settings.js';
import { logActivity } from '../lib/activity-log.js';
import { verifyAdminCookie } from '../auth/admin-auth.js';
import { getSessionUser } from '../lib/accounts/session.js';
import { saveJob, unsaveJob, listSavedJobIds } from '../lib/saved-jobs.js';
import { recordApplication } from '../lib/applications.js';
import { getVerifiedCompanyNameSet } from '../lib/companies.js';
import { attachCompanyLogos } from '../lib/company-logos.js';
import { hydrateHotPay } from '../lib/hot-pay.js';
import { safeExternalUrl } from '../lib/entities.js';
import { verifyCsrf } from '../lib/accounts/csrf.js';
import {
  listProducts, createPendingOrder, listUserOrders, listUserEntitlements,
  getMonetizationOverview, getRevenueAnalytics, verifyPaymentWebhook,
  processPaymentWebhook,   createAffiliateClick,
} from '../lib/monetization.js';
import { enqueueAnalyticsEvents, getAnalyticsOverview, getAnalyticsReport, getAnalyticsFunnel, getAnalyticsSearches, getAnalyticsFilters, getAnalyticsRealtime, getAnalyticsAlerts, getAnalyticsHealth, getAnalyticsTrends, getAnalyticsTopJobs, getAnalyticsTopCompanies, rowsToCsv } from '../lib/analytics.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleApiRoute(url, request, env) {
  const jsonResponse = (payload, status = 200, extra = {}) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...extra } });

  // ── Protected Admin Analytics API ───────────────────────────────
  if (url.pathname.startsWith('/api/admin/analytics')) {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    const input = { preset: url.searchParams.get('preset') || '30d', from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '', timeZone: (await getSettings(env)).analytics_timezone };
    if (url.pathname === '/api/admin/analytics/overview') return jsonResponse(await getAnalyticsOverview(env, input));
    if (url.pathname === '/api/admin/analytics/traffic') return jsonResponse({ ...(await getAnalyticsReport(env, 'traffic', input)), trends: await getAnalyticsTrends(env, input) });
    if (url.pathname === '/api/admin/analytics/jobs') return jsonResponse(await getAnalyticsTopJobs(env, input));
    if (url.pathname === '/api/admin/analytics/companies') return jsonResponse(await getAnalyticsTopCompanies(env, input));
    if (url.pathname === '/api/admin/analytics/searches') return jsonResponse(await getAnalyticsSearches(env, input));
    if (url.pathname === '/api/admin/analytics/filters') return jsonResponse(await getAnalyticsFilters(env, input));
    if (url.pathname === '/api/admin/analytics/funnel') return jsonResponse(await getAnalyticsFunnel(env, input));
    if (url.pathname === '/api/admin/analytics/geography') return jsonResponse(await getAnalyticsReport(env, 'geography', input));
    if (url.pathname === '/api/admin/analytics/devices') return jsonResponse(await getAnalyticsReport(env, 'devices', input));
    if (url.pathname === '/api/admin/analytics/realtime') return jsonResponse({ events: await getAnalyticsRealtime(env) });
    if (url.pathname === '/api/admin/analytics/alerts') return jsonResponse({ alerts: await getAnalyticsAlerts(env), health: await getAnalyticsHealth(env) });
    if (url.pathname === '/api/admin/analytics/revenue') return jsonResponse(await getRevenueAnalytics(env, url.searchParams.get('days') || 30));
    if (url.pathname === '/api/admin/analytics/payments') { try { const { results } = await env.DB.prepare(`SELECT status,COUNT(*) count,SUM(gross_amount_minor) amount FROM monetization_transactions GROUP BY status`).all(); return jsonResponse({ rows: results || [] }); } catch (e) { return jsonResponse({ rows: [] }); } }
    if (url.pathname === '/api/admin/analytics/affiliate') { try { const { results } = await env.DB.prepare(`SELECT program_id,COUNT(*) clicks,COUNT(DISTINCT session_hash) unique_clicks FROM affiliate_clicks GROUP BY program_id ORDER BY clicks DESC`).all(); return jsonResponse({ rows: results || [] }); } catch (e) { return jsonResponse({ rows: [] }); } }
    if (url.pathname === '/api/admin/analytics/export') {
      const type = url.searchParams.get('type') || 'traffic';
      let data;
      if (type === 'jobs') data = await getAnalyticsTopJobs(env, input); else if (type === 'companies') data = await getAnalyticsTopCompanies(env, input); else if (type === 'searches') data = await getAnalyticsSearches(env, input); else if (type === 'filters') data = await getAnalyticsFilters(env, input); else data = await getAnalyticsReport(env, 'traffic', input);
      return new Response(rowsToCsv(data.rows || []), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="jobforion-${type}-analytics.csv"` } });
    }
    return jsonResponse({ success: false, error: 'Not found.' }, 404);
  }

  // ── First-party analytics event intake ──────────────────────────
  // This endpoint accepts only the strict whitelist from lib/analytics.js;
  // it never accepts authoritative revenue, payment state, role, or owner IDs.
  if (url.pathname === '/api/analytics/events' && request.method === 'POST') {
    try {
      const rl = await checkRateLimit(env, `analytics:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, { maxRequests: 120, windowMinutes: 10 });
      if (!rl.allowed) return jsonResponse({ accepted: 0, error: 'Too many analytics events.' }, 429);
      const body = await request.json();
      const settings = await getSettings(env);
      const session = request.headers.get('Cookie') ? await getSessionUser(env, request) : null;
      const events = Array.isArray(body?.events) ? body.events : [body];
      const result = await enqueueAnalyticsEvents(env, events, { user_id: session?.user?.id || null, country: request.cf?.country || 'XX', timeZone: settings.analytics_timezone, userAgent: request.headers.get('User-Agent') || '', settings });
      return jsonResponse({ accepted: result.accepted || 0 });
    } catch (e) { return jsonResponse({ accepted: 0 }); }
  }

  // ── Monetization: public catalog, server-priced pending orders, and
  // trusted webhook boundary. No endpoint accepts client price/currency as
  // authoritative and no endpoint marks an order paid from browser input. ──
  if (url.pathname === '/api/monetization/products' && request.method === 'GET') {
    return jsonResponse({ products: await listProducts(env, { activeOnly: true }) });
  }
  if (url.pathname === '/api/monetization/orders' && request.method === 'POST') {
    const session = await getSessionUser(env, request);
    if (!session) return jsonResponse({ success: false, error: 'Not signed in.' }, 401);
    try {
      const body = await request.json();
      const csrfToken = request.headers.get('X-CSRF-Token') || body._csrf || '';
      if (!await verifyCsrf(env, session.sessionId, String(csrfToken))) return jsonResponse({ success: false, error: 'Invalid CSRF token.' }, 403);
      const rl = await checkRateLimit(env, `monetization-order:${session.user.id}`, { maxRequests: 10, windowMinutes: 10 });
      if (!rl.allowed) return jsonResponse({ success: false, error: 'Too many checkout attempts.' }, 429);
      const result = await createPendingOrder(env, session.user, body);
      return jsonResponse(result, result.ok ? 202 : (result.status || 400));
    } catch (e) { return jsonResponse({ success: false, error: 'Invalid order request.' }, 400); }
  }
  if (url.pathname === '/api/monetization/orders' && request.method === 'GET') {
    const session = await getSessionUser(env, request);
    if (!session) return jsonResponse({ success: false, error: 'Not signed in.' }, 401);
    return jsonResponse({ orders: await listUserOrders(env, session.user.id) });
  }
  if (url.pathname === '/api/monetization/entitlements' && request.method === 'GET') {
    const session = await getSessionUser(env, request);
    if (!session) return jsonResponse({ success: false, error: 'Not signed in.' }, 401);
    return jsonResponse({ entitlements: await listUserEntitlements(env, session.user.id) });
  }
  if (url.pathname === '/api/monetization/analytics' && request.method === 'GET') {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    return jsonResponse({ overview: await getMonetizationOverview(env), revenue: await getRevenueAnalytics(env, url.searchParams.get('days')) });
  }
  if (url.pathname === '/api/monetization/transactions' && request.method === 'GET') {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    try { const { results } = await env.DB.prepare('SELECT t.*, o.order_ref, p.name product_name FROM monetization_transactions t LEFT JOIN monetization_orders o ON o.id=t.order_id LEFT JOIN monetization_products p ON p.id=o.product_id ORDER BY t.id DESC LIMIT 100').all(); return jsonResponse({ transactions: results || [] }); } catch (e) { return jsonResponse({ transactions: [] }); }
  }
  if (url.pathname === '/api/monetization/refunds' && request.method === 'GET') {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    try { const { results } = await env.DB.prepare('SELECT r.*, o.order_ref FROM monetization_refunds r LEFT JOIN monetization_orders o ON o.id=r.order_id ORDER BY r.id DESC LIMIT 100').all(); return jsonResponse({ refunds: results || [] }); } catch (e) { return jsonResponse({ refunds: [] }); }
  }
  if (url.pathname === '/api/monetization/campaigns' && request.method === 'GET') {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    try { const { results } = await env.DB.prepare('SELECT * FROM monetization_campaigns ORDER BY id DESC LIMIT 100').all(); return jsonResponse({ campaigns: results || [] }); } catch (e) { return jsonResponse({ campaigns: [] }); }
  }
  if (url.pathname === '/api/monetization/affiliate-click' && request.method === 'POST') {
    try {
      const rl = await checkRateLimit(env, `affiliate-click:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, { maxRequests: 60, windowMinutes: 10 });
      if (!rl.allowed) return jsonResponse({ success: false, error: 'Too many requests.' }, 429);
      const result = await createAffiliateClick(env, await request.json(), request);
      return jsonResponse(result, result.ok ? 200 : 400);
    } catch (e) { return jsonResponse({ success: false, error: 'Invalid affiliate click.' }, 400); }
  }
  if (url.pathname === '/api/monetization/webhook' && request.method === 'POST') {
    const rawBody = await request.text();
    const verified = await verifyPaymentWebhook(env, rawBody, request.headers);
    if (!verified.ok) return jsonResponse({ success: false, error: verified.error }, verified.status);
    try {
      const result = await processPaymentWebhook(env, JSON.parse(rawBody));
      return jsonResponse(result, result.ok ? 200 : (result.status || 400));
    } catch (e) { return jsonResponse({ success: false, error: 'Invalid webhook payload.' }, 400); }
  }

  // ── Account-aware saved-jobs toggle ─────────────────────────────
  // Authenticated saves are persisted server-side so they survive across
  // devices. Anonymous clients are directed to the existing login flow by
  // the page renderers; this endpoint remains intentionally 401-only for
  // unauthenticated requests.
  if (url.pathname === '/api/user/saved-jobs' && request.method === 'GET') {
    const session = await getSessionUser(env, request);
    if (!session) return new Response(JSON.stringify({ success: false, error: 'Not signed in', job_ids: [] }), { status: 401, headers: { "Content-Type": "application/json" } });
    try {
      const job_ids = await listSavedJobIds(env, session.user.id);
      return new Response(JSON.stringify({ success: true, job_ids }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: 'Unable to load saved jobs', job_ids: [] }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (url.pathname === '/api/user/saved-jobs' && request.method === 'POST') {
    const session = await getSessionUser(env, request);
    if (!session) return new Response(JSON.stringify({ success: false, error: 'Not signed in' }), { status: 401, headers: { "Content-Type": "application/json" } });
    try {
      const rl = await checkRateLimit(env, `saved-jobs:${session.user.id}`, { maxRequests: 60, windowMinutes: 1 });
      if (!rl.allowed) return new Response(JSON.stringify({ success: false, error: 'Too many requests' }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String((rl.retryAfterMinutes || 1) * 60) } });
      const { job_id, action } = await request.json();
      const jobId = parseInt(job_id, 10);
      if (!Number.isInteger(jobId) || jobId <= 0 || jobId > 2147483647) return new Response(JSON.stringify({ success: false, error: 'job_id required' }), { status: 400, headers: { "Content-Type": "application/json" } });
      if (action !== 'unsave') {
        const { results } = await env.DB.prepare(`SELECT id FROM jobs WHERE id = ? AND status = 'active' LIMIT 1`).bind(jobId).all();
        if (!results?.length) return new Response(JSON.stringify({ success: false, error: 'Job is no longer available' }), { status: 404, headers: { "Content-Type": "application/json" } });
        await saveJob(env, session.user.id, jobId);
      } else await unsaveJob(env, session.user.id, jobId);
      return new Response(JSON.stringify({ success: true, saved: action !== 'unsave' }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, error: 'Invalid request' }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === '/api/user/applications' && request.method === 'POST') {
    const session = await getSessionUser(env, request);
    if (!session) return new Response(JSON.stringify({ success: false, error: 'Not signed in' }), { status: 401, headers: { "Content-Type": "application/json" } });
    try {
      const rl = await checkRateLimit(env, `applications:${session.user.id}`, { maxRequests: 30, windowMinutes: 1 });
      if (!rl.allowed) return new Response(JSON.stringify({ success: false, error: 'Too many requests' }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String((rl.retryAfterMinutes || 1) * 60) } });
      const { job_id, status, application_type } = await request.json();
      const jobId = parseInt(job_id, 10);
      if (!Number.isInteger(jobId) || jobId <= 0 || jobId > 2147483647) return new Response(JSON.stringify({ success: false, error: 'job_id required' }), { status: 400, headers: { "Content-Type": "application/json" } });
      const { results } = await env.DB.prepare(`SELECT id FROM jobs WHERE id = ? LIMIT 1`).bind(jobId).all();
      if (!results?.length) return new Response(JSON.stringify({ success: false, error: 'Job not found' }), { status: 404, headers: { "Content-Type": "application/json" } });
      const allowedStatuses = new Set(['saved', 'applied', 'viewed', 'interview', 'rejected', 'hired']);
      const nextStatus = allowedStatuses.has(String(status || 'applied')) ? String(status || 'applied') : 'applied';
      await recordApplication(env, session.user.id, jobId, { status: nextStatus, application_type: application_type === 'internal' ? 'internal' : 'external' });
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
      const cleanEmail = String(email || '').trim().toLowerCase().slice(0, 254);
      const cleanKeywords = Array.isArray(keywords) ? keywords.map(value => String(value || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20) : [];
      if (!EMAIL_RE.test(cleanEmail) || !cleanKeywords.length) return new Response(JSON.stringify({ success: false, error: "Required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      await env.DB.prepare("INSERT OR REPLACE INTO subscribers (email,keywords) VALUES (?,?)").bind(cleanEmail, JSON.stringify(cleanKeywords)).run();
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
      const email = (b.email || '').toString().trim().toLowerCase().slice(0, 254);
      const jobUrl = safeExternalUrl((b.url || '').toString().slice(0, 400));
      if (!title || !company || !EMAIL_RE.test(email) || !jobUrl) {
        return new Response(JSON.stringify({ success: false, error: "Please fill in all required fields." }), { status: 400, headers: { "Content-Type": "application/json" } });
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
    // Page Size (plan §11/§26) — `limit` is a fixed constant, never read
    // from the query string at all, so a crafted `?limit=999999` has
    // nothing to attach to. `page` IS user-controlled and must be
    // clamped server-side regardless of what the frontend already does
    // client-side (Stage 9's clientside clamp in pages/home.js is a UX
    // nicety, not a security boundary) — a negative/zero/absurdly large
    // page must never reach an unbounded raw OFFSET calculation. It is
    // clamped to a practical upper bound as well as a floor of 1, so a
    // crafted request cannot force an arbitrarily deep scan.
    const page = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1));
    const limit = 20, offset = (page - 1) * limit;
    const queryValue = (name, max = 120) => String(url.searchParams.get(name) || '').trim().slice(0, max);
    const category = queryValue("category");
    const search = queryValue("search") || queryValue("q"); // `q` accepted as an alias (plan §6's example URL shape) without renaming the param the existing frontend already sends
    const remoteType = queryValue("remote_type", 40);
    const employType = queryValue("employment_type", 40);
    const seniority = queryValue("seniority", 80);
    const salaryMin = queryValue("salary_min", 20);
    const salaryMax = queryValue("salary_max", 20);
    const salaryTierRaw = queryValue("salary_tier", 20).toUpperCase();
    const salaryTier = ['HIGH', 'GOOD', 'STANDARD', 'UNKNOWN'].includes(salaryTierRaw) ? salaryTierRaw : '';
    // Date Posted (plan §5) — a fixed whitelist of day-counts, not an
    // arbitrary integer straight from the query string. The value is
    // still bound as a parameter either way (never string-concatenated
    // into SQL), so this isn't a SQL-injection fix — it's a correctness
    // one: an unvalidated `?days=` could otherwise be 0, negative, or a
    // huge number that doesn't correspond to any of the UI's actual
    // "Today / 3 / 7 / 14 / 30 days" options.
    const ALLOWED_DAYS = new Set([1, 3, 7, 14, 30]);
    const daysRaw = parseInt(url.searchParams.get("days") || "", 10);
    const days = ALLOWED_DAYS.has(daysRaw) ? daysRaw : null;
    // Source (plan §5/§22) — provider-synced vs employer-submitted vs
    // admin-created, using the exact same source_type values Job
    // Management (Stage 5) already writes to every row. Internal details
    // (which SPECIFIC provider, source_job_id, submitted_by_user_id) are
    // never exposed here — only this coarse, public-safe distinction.
    const ALLOWED_SOURCE_TYPES = new Set(['provider', 'employer', 'admin']);
    const sourceTypeRaw = (url.searchParams.get("source_type") || "").toLowerCase();
    const sourceType = ALLOWED_SOURCE_TYPES.has(sourceTypeRaw) ? sourceTypeRaw : "";
    // Sort (plan §8) — same JOB_SORT_OPTIONS allow-list Admin Job
    // Management (Stage 5) uses; an unrecognized/absent value always
    // falls back to 'relevance', never a raw column from the query string.
    const sortKeyRaw = url.searchParams.get("sort") || "relevance";
    const sortKey = JOB_SORT_OPTIONS[sortKeyRaw] ? sortKeyRaw : "relevance";
    // Country filter — same matching heuristic as jobsByRegion() in
    // lib/entities.js: location is either an exact match ("Germany") or
    // ends with ", <country>" ("Berlin, Germany"), since `location` is
    // free text with no normalized country column.
    const country = queryValue("country", 100);
    // Skill filter — matches the same jobs.skills JSON column that
    // jobsBySkill() (lib/entities.js) parses via SQLite's json_each,
    // expressed here as a correlated EXISTS subquery so it composes with
    // the other AND-joined conditions on the single `jobs` table.
    const skill = queryValue("skill", 100);
    // Company filter — exact match on the jobs.company column, same value
    // shape produced by listCompanies() (lib/entities.js).
    const company = queryValue("company", 160);
    const conditions = [PUBLIC_JOB_STATUS_SQL], params = [];
    if (category) { conditions.push("LOWER(title) LIKE ?"); params.push(`%${category}%`); }
    if (search) {
      // Keyword Search (plan §2/§4) — searches every field a candidate
      // would actually expect a keyword match to come from: title,
      // company, skills (JSON array — via json_each, same technique as
      // the skill filter above), and description. Previously this only
      // matched title/company, so a search for a specific technology
      // that only appeared in the skills list or job description (not
      // literally in the title) returned zero results even though a
      // clearly relevant job existed.
      const s = search.toLowerCase();
      conditions.push(`(LOWER(title) LIKE ? OR LOWER(company) LIKE ? OR LOWER(description) LIKE ? OR EXISTS (SELECT 1 FROM json_each(jobs.skills) je WHERE LOWER(je.value) LIKE ?))`);
      params.push(`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`);
    }
    if (remoteType) { conditions.push("remote_type = ?"); params.push(remoteType); }
    if (employType) { conditions.push("employment_type = ?"); params.push(employType); }
    if (seniority) { conditions.push("LOWER(seniority) LIKE ?"); params.push(`%${seniority.toLowerCase()}%`); }
    const salaryMinUsd = Number.parseInt(salaryMin, 10);
    const salaryMaxUsd = Number.parseInt(salaryMax, 10);
    if (Number.isFinite(salaryMinUsd) && salaryMinUsd >= 0) { conditions.push("salary_max_usd >= ?"); params.push(salaryMinUsd); }
    if (Number.isFinite(salaryMaxUsd) && salaryMaxUsd >= 0) { conditions.push("salary_min_usd <= ?"); params.push(salaryMaxUsd); }
    if (salaryTier) { conditions.push("COALESCE(salary_tier, 'UNKNOWN') = ?"); params.push(salaryTier); }
    if (days) { conditions.push("created_at >= datetime('now', '-' || ? || ' days')"); params.push(days); }
    if (sourceType) { conditions.push("source_type = ?"); params.push(sourceType); }
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

    // Search Relevance (plan §4) — the simplest effective strategy per
    // the plan's own guidance, not a scoring engine: when a keyword is
    // active AND the user hasn't explicitly picked a different sort, tier
    // matches by WHERE the keyword hit (title > skills > company) ahead
    // of the existing job_type/featured tiering, instead of every match
    // being treated as equally relevant. An explicit sort choice (Newest,
    // Highest Salary, ...) always wins outright — a searcher who picks
    // "Newest" wants newest first, not relevance-then-newest.
    let orderBySql = JOB_SORT_OPTIONS[sortKey].sql;
    const orderParams = [];
    if (search && sortKey === 'relevance') {
      const s = search.toLowerCase();
      orderBySql = `CASE
        WHEN LOWER(title) LIKE ? THEN 0
        WHEN EXISTS (SELECT 1 FROM json_each(jobs.skills) je2 WHERE LOWER(je2.value) LIKE ?) THEN 1
        WHEN LOWER(company) LIKE ? THEN 2
        ELSE 3
      END ASC, ${orderBySql}`;
      orderParams.push(`%${s}%`, `%${s}%`, `%${s}%`);
    }

    const [{ results }, { results: cr }, verifiedCompanySet, settings] = await Promise.all([
      env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS} FROM jobs${where} ORDER BY ${orderBySql} LIMIT ${limit} OFFSET ${offset}`).bind(...params, ...orderParams).all(),
      env.DB.prepare(`SELECT COUNT(*) as total FROM jobs${where}`).bind(...params).all(),
      getVerifiedCompanyNameSet(env), // 60s-cached, see lib/companies.js — drives the "✓ Verified" badge client-side (plan §8)
      getSettings(env),
    ]);
    const hydratedJobs = await attachCompanyLogos(env, results || []);
    const hotJobs = await hydrateHotPay(env, hydratedJobs, settings);
    const jobsWithVerified = hotJobs.map(j => ({ ...j, is_verified: verifiedCompanySet.has((j.company || '').toLowerCase()) }));
    const totalCount = cr[0]?.total || 0;
    // Additive response fields (plan §25) — `jobs`/`total`/`page`/`sort`
    // are unchanged from before Stage 9, so any existing caller of this
    // endpoint keeps working with zero changes; totalPages/hasNext/
    // hasPrev just save every consumer from re-deriving
    // Math.ceil(total/limit) themselves (pages/home.js already did this
    // client-side and is left as-is rather than forced to switch).
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    return new Response(JSON.stringify({
      jobs: jobsWithVerified, total: totalCount, page, sort: sortKey,
      totalPages, hasNext: page < totalPages, hasPrev: page > 1,
    }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
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
