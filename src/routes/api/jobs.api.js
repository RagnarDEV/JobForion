// src/routes/api/jobs.api.js
// Public job listing/search JSON API (edge-cached, rate-limited).
// Returns a Response, or null when the path is not this module's concern.

import { checkRateLimit } from '../../lib/platform/rate-limit.js';
import { keywordCondition, normalizeSearchTerm } from '../../lib/platform/search-utils.js';
import { PUBLIC_JOB_STATUS_SQL, JOB_LISTING_COLUMNS, JOB_SORT_OPTIONS } from '../../config/constants.js';
import { resolveRawNames } from '../../lib/directory/directory-overrides.js';
import { getSettings } from '../../lib/platform/settings.js';
import { getVerifiedCompanyNameSet } from '../../lib/companies/companies.js';
import { attachCompanyLogos } from '../../lib/companies/company-logos.js';
import { hydrateHotPay } from '../../lib/jobs/hot-pay.js';
import { enqueueAnalyticsEvents } from '../../lib/analytics/events.js';

function publicJobsCacheKey(url) {
  return new Request(url.toString(), { method: 'GET' });
}

async function getPublicJobsCache(url, request) {
  if (request.method !== 'GET' || request.headers.get('Cookie') || typeof caches === 'undefined' || !caches?.default) return null;
  try { return await caches.default.match(publicJobsCacheKey(url)); } catch (e) { return null; }
}

export async function handleJobsApi(url, request, env, ctx) {
  if (url.pathname === '/api/jobs') {
    // RESILIENCE: the whole handler is wrapped in try/catch. This is the
    // busiest read endpoint on the site (backs live search-as-you-type)
    // and queries several columns/tables that are part of the newer
    // schema additions — during the first few requests after a schema
    // change, while db/schema.js's resumable migration is still catching
    // up (see SCHEMA_MIGRATION_BUDGET there), a column might not exist
    // yet. Returning an empty, well-formed result instead of a raw
    // uncaught error keeps the homepage's live search from breaking
    // during that (short, self-resolving) window.
    try {
    return await (async () => {
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
    const cachedJobs = await getPublicJobsCache(url, request);
    if (cachedJobs) return cachedJobs;
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
    const search = normalizeSearchTerm(queryValue("search") || queryValue("q")); // `q` accepted as an alias (plan §6's example URL shape) without renaming the param the existing frontend already sends
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
    // lib/directory/entities.js: location is either an exact match ("Germany") or
    // ends with ", <country>" ("Berlin, Germany"), since `location` is
    // free text with no normalized country column.
    const country = queryValue("country", 100);
    // Skill filter — matches the same jobs.skills JSON column that
    // jobsBySkill() (lib/directory/entities.js) parses via SQLite's json_each,
    // expressed here as a correlated EXISTS subquery so it composes with
    // the other AND-joined conditions on the single `jobs` table.
    const skill = queryValue("skill", 100);
    // Company filter — exact match on the jobs.company column, same value
    // shape produced by listCompanies() (lib/directory/entities.js).
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
      const kw = keywordCondition(search, { includeLocation: false });
      conditions.push(kw.sql);
      params.push(...kw.binds);
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
      // See lib/directory/directory-overrides.js: `country` here is the DISPLAY
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
      getVerifiedCompanyNameSet(env), // 60s-cached, see lib/companies/companies.js — drives the "✓ Verified" badge client-side (plan §8)
      getSettings(env),
    ]);
    const hydratedJobs = await attachCompanyLogos(env, results || []);
    const hotJobs = await hydrateHotPay(env, hydratedJobs, settings);
    const jobsWithVerified = hotJobs.map(j => ({ ...j, is_verified: verifiedCompanySet.has((j.company || '').toLowerCase()) }));
    const totalCount = cr[0]?.total || 0;
    // Derive search/filter analytics from the same server-side query that
    // produced `totalCount`. The browser must not be trusted to report its
    // own result count, especially for zero-result opportunity analysis.
    if (ctx?.waitUntil && (search || category || remoteType || employType || seniority || salaryMin || salaryMax || salaryTier || days || sourceType || country || skill || company)) {
      const analyticsEvents = [];
      if (search) analyticsEvents.push({ event_type: 'search', page: '/api/jobs', metadata: { query: search, results_count: Number(totalCount) || 0 } });
      const filters = [['category', category], ['remote_type', remoteType], ['employment_type', employType], ['seniority', seniority], ['salary_min', salaryMin], ['salary_max', salaryMax], ['salary_tier', salaryTier], ['days', days], ['source_type', sourceType], ['country', country], ['skill', skill], ['company', company]];
      for (const [filter, value] of filters) if (value !== '' && value !== null && value !== undefined) analyticsEvents.push({ event_type: 'filter_used', page: '/api/jobs', metadata: { filter, value: String(value).slice(0, 120) } });
      const tracking = enqueueAnalyticsEvents(env, analyticsEvents, { country: request.cf?.country || 'XX', userAgent: request.headers.get('User-Agent') || '', timeZone: settings.analytics_timezone, settings }).catch(() => {});
      ctx.waitUntil(tracking);
    }
    // Additive response fields (plan §25) — `jobs`/`total`/`page`/`sort`
    // are unchanged from before Stage 9, so any existing caller of this
    // endpoint keeps working with zero changes; totalPages/hasNext/
    // hasPrev just save every consumer from re-deriving
    // Math.ceil(total/limit) themselves (pages/home.js already did this
    // client-side and is left as-is rather than forced to switch).
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const response = new Response(JSON.stringify({
      jobs: jobsWithVerified, total: totalCount, page, sort: sortKey,
      totalPages, hasNext: page < totalPages, hasPrev: page > 1,
    }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=15, s-maxage=30" } });
    if (!request.headers.get('Cookie') && typeof caches !== 'undefined' && caches?.default && ctx?.waitUntil) {
      ctx.waitUntil(caches.default.put(publicJobsCacheKey(url), response.clone()).catch(() => {}));
    }
    return response;
    })();
    } catch (e) {
      return new Response(JSON.stringify({ jobs: [], total: 0, page: 1, totalPages: 1, hasNext: false, hasPrev: false }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
      });
    }
  }
  return null;
}
