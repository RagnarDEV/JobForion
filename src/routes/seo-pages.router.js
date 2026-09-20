// src/routes/seo-pages.router.js
// Deployment verification marker: automatic Worker redeploy requested.
// Programmatic SEO directory + detail pages. Index pages are wrapped in the
// Cache API (src/lib/platform/cache.js) since they're aggregate D1 queries that don't
// change per-request; detail pages set a shorter Cache-Control instead.

import {
  renderJobsIndex,
  renderCategoriesIndex, renderCategoryDetail,
  renderCompaniesIndex, renderCompanyDetail,
  renderSkillsIndex, renderSkillDetail,
  renderCountriesIndex, renderCountryDetail, renderRemoteJobsLanding,
  renderSearchPage,
} from '../pages/seo-pages.js';
import { renderNotFoundPage } from '../pages/public-content.js';
import { withCache, CACHE_PRESETS } from '../lib/platform/cache.js';
import { getSettings } from '../lib/platform/settings.js';
import { getSessionUser, isAnonymousRequest } from '../lib/accounts/session.js';
import { checkRateLimit } from '../lib/platform/rate-limit.js';
import { safeDecodeURIComponent } from '../lib/platform/search-utils.js';

// Keyword searches are the most expensive public query (multi-column LIKE +
// json_each over every active job). Cache hits never reach this guard (see
// withCache options.guard) so only genuine misses cost a D1 write.
function searchRateGuard(env, request) {
  return async () => {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rl = await checkRateLimit(env, `search:${ip}`, { maxRequests: 30, windowMinutes: 1 });
    if (rl.allowed) return null;
    return new Response('Too many searches. Please wait a minute and try again.', {
      status: 429,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60', 'Cache-Control': 'no-store' },
    });
  };
}

export async function handleSeoPagesRoute(url, request, env, ctx, base) {
  // Feature Flags (Admin Dashboard V2, Phase 2): Company/Country/Skill
  // directory pages can each be switched off from /admin/settings without
  // a redeploy. Checked once, centrally, here — every index AND detail
  // route below shares the same on/off decision, so there's no risk of
  // the index page disappearing from nav while its detail pages stay
  // crawlable (or vice versa).
  const settings = await getSettings(env);
  const public404 = async () => new Response(await renderNotFoundPage(base, env, null), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });

  if (url.pathname === '/remote-jobs') {
    const page = url.searchParams.get('page') || '';
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderRemoteJobsLanding(env, base, null, { page }), { allowedParams: ['page'] });
  }

  if (url.pathname === '/jobs') {
    const filterKeys = ['q', 'search', 'category', 'remote_type', 'employment_type', 'seniority', 'country', 'skill', 'company', 'salary_min', 'salary_max', 'days', 'source_type', 'sort', 'page'];
    const filters = Object.fromEntries(filterKeys.map(key => [key, url.searchParams.get(key) || '']));
    // Anonymous visitors (no session cookie => identical HTML for everyone)
    // are served from the edge cache with a NORMALISED key; searches are
    // rate-limited on a cache miss. Signed-in visitors keep the live render.
    if (isAnonymousRequest(request)) {
      return await withCache(ctx, request, CACHE_PRESETS.search,
        async () => renderJobsIndex(env, base, null, filters),
        { allowedParams: filterKeys, guard: filters.q || filters.search ? searchRateGuard(env, request) : null });
    }
    if (filters.q || filters.search) {
      const blocked = await searchRateGuard(env, request)();
      if (blocked) return blocked;
    }
    const session = await getSessionUser(env, request);
    return new Response(await renderJobsIndex(env, base, session?.user || null, filters), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
  }

  if (url.pathname === '/categories') {
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderCategoriesIndex(env, base), { allowedParams: [] });
  }
  const catMatch = url.pathname.match(/^\/categories\/([a-z][a-z0-9]{1,19})$/);
  if (catMatch) {
    return await withCache(ctx, request, CACHE_PRESETS.entity,
      async () => renderCategoryDetail(env, base, catMatch[1], null, { page: url.searchParams.get('page') || '' }),
      { allowedParams: ['page'], onEmpty: public404 });
  }
  if (url.pathname === '/companies' || url.pathname.match(/^\/companies\/([a-z0-9-]+)$/)) {
    if (settings.feature_company_pages === '0') return public404();
  }
  if (url.pathname === '/companies') {
    // withCache() keys on the full request URL (including query string),
    // so each distinct filter combination gets its own edge-cache entry —
    // no risk of one visitor's filtered view leaking to another's
    // unfiltered request. Values are read-only lookups, never written
    // back to D1, so no further sanitization is needed beyond what
    // lib/companies/companies.js already parameterizes internally.
    const filters = {
      q: url.searchParams.get('q') || '',
      country: url.searchParams.get('country') || '',
      industry: url.searchParams.get('industry') || '',
      company_size: url.searchParams.get('company_size') || '',
      verified: url.searchParams.get('verified') || '',
      page: url.searchParams.get('page') || '',
    };
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderCompaniesIndex(env, base, null, filters), { allowedParams: Object.keys(filters) });
  }
  const companyMatch = url.pathname.match(/^\/companies\/([a-z0-9-]+)$/);
  if (companyMatch) {
    const detailFilterKeys = ['q', 'remote_type', 'employment_type', 'category', 'seniority', 'country', 'page'];
    const filters = Object.fromEntries(detailFilterKeys.map(key => [key, url.searchParams.get(key) || '']));
    return await withCache(ctx, request, CACHE_PRESETS.entity,
      async () => renderCompanyDetail(env, base, companyMatch[1], null, filters),
      { allowedParams: detailFilterKeys, onEmpty: public404 });
  }
  if (url.pathname === '/countries' || url.pathname.match(/^\/countries\/([a-z0-9-]+)$/)) {
    if (settings.feature_country_pages === '0') return public404();
  }
  if (url.pathname === '/countries') {
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderCountriesIndex(env, base), { allowedParams: [] });
  }
  const countryMatch = url.pathname.match(/^\/countries\/([a-z0-9-]+)$/);
  if (countryMatch) {
    return await withCache(ctx, request, CACHE_PRESETS.entity,
      async () => renderCountryDetail(env, base, countryMatch[1], null, { page: url.searchParams.get('page') || '' }),
      { allowedParams: ['page'], onEmpty: public404 });
  }
  if (url.pathname === '/skills' || url.pathname.match(/^\/skills\/([a-z0-9-]+)$/)) {
    if (settings.feature_skill_pages === '0') return public404();
  }
  if (url.pathname === '/skills') {
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderSkillsIndex(env, base), { allowedParams: [] });
  }
  const skillMatch = url.pathname.match(/^\/skills\/([a-z0-9-]+)$/);
  if (skillMatch) {
    return await withCache(ctx, request, CACHE_PRESETS.entity,
      async () => renderSkillDetail(env, base, skillMatch[1], null, { page: url.searchParams.get('page') || '' }),
      { allowedParams: ['page'], onEmpty: public404 });
  }
  const searchMatch = url.pathname.match(/^\/search\/([^/]+)$/);
  if (searchMatch) {
    // A malformed percent-escape (e.g. /search/%E0%A4%A) is a client error,
    // never a server crash.
    if (safeDecodeURIComponent(searchMatch[1]) === null) return public404();
    return await withCache(ctx, request, CACHE_PRESETS.search,
      async () => renderSearchPage(env, base, searchMatch[1]),
      { allowedParams: [], guard: searchRateGuard(env, request) });
  }

  return null;
}
