// src/routes/seo-pages.router.js
// Programmatic SEO directory + detail pages. Index pages are wrapped in the
// Cache API (src/lib/cache.js) since they're aggregate D1 queries that don't
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
import { withCache, CACHE_PRESETS } from '../lib/cache.js';
import { getSettings } from '../lib/settings.js';
import { getSessionUser } from '../lib/accounts/session.js';

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
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderRemoteJobsLanding(env, base, null, { page }));
  }

  if (url.pathname === '/jobs') {
    const filterKeys = ['q', 'search', 'category', 'remote_type', 'employment_type', 'seniority', 'country', 'skill', 'company', 'salary_min', 'salary_max', 'days', 'source_type', 'sort', 'page'];
    const filters = Object.fromEntries(filterKeys.map(key => [key, url.searchParams.get(key) || '']));
    const session = await getSessionUser(env, request);
    return new Response(await renderJobsIndex(env, base, session?.user || null, filters), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (url.pathname === '/categories') {
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderCategoriesIndex(env, base));
  }
  const catMatch = url.pathname.match(/^\/categories\/([a-z][a-z0-9]{1,19})$/);
  if (catMatch) {
    const html = await renderCategoryDetail(env, base, catMatch[1], null, { page: url.searchParams.get('page') || '' });
    if (!html) return public404();
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE_PRESETS.entity } });
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
    // lib/companies.js already parameterizes internally.
    const filters = {
      q: url.searchParams.get('q') || '',
      country: url.searchParams.get('country') || '',
      industry: url.searchParams.get('industry') || '',
      company_size: url.searchParams.get('company_size') || '',
      verified: url.searchParams.get('verified') || '',
      page: url.searchParams.get('page') || '',
    };
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderCompaniesIndex(env, base, null, filters));
  }
  const companyMatch = url.pathname.match(/^\/companies\/([a-z0-9-]+)$/);
  if (companyMatch) {
    const detailFilterKeys = ['q', 'remote_type', 'employment_type', 'category', 'seniority', 'country', 'page'];
    const filters = Object.fromEntries(detailFilterKeys.map(key => [key, url.searchParams.get(key) || '']));
    const html = await renderCompanyDetail(env, base, companyMatch[1], null, filters);
    if (!html) return public404();
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE_PRESETS.entity } });
  }
  if (url.pathname === '/countries' || url.pathname.match(/^\/countries\/([a-z0-9-]+)$/)) {
    if (settings.feature_country_pages === '0') return public404();
  }
  if (url.pathname === '/countries') {
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderCountriesIndex(env, base));
  }
  const countryMatch = url.pathname.match(/^\/countries\/([a-z0-9-]+)$/);
  if (countryMatch) {
    const html = await renderCountryDetail(env, base, countryMatch[1], null, { page: url.searchParams.get('page') || '' });
    if (!html) return public404();
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE_PRESETS.entity } });
  }
  if (url.pathname === '/skills' || url.pathname.match(/^\/skills\/([a-z0-9-]+)$/)) {
    if (settings.feature_skill_pages === '0') return public404();
  }
  if (url.pathname === '/skills') {
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderSkillsIndex(env, base));
  }
  const skillMatch = url.pathname.match(/^\/skills\/([a-z0-9-]+)$/);
  if (skillMatch) {
    const html = await renderSkillDetail(env, base, skillMatch[1], null, { page: url.searchParams.get('page') || '' });
    if (!html) return public404();
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE_PRESETS.entity } });
  }
  const searchMatch = url.pathname.match(/^\/search\/([^/]+)$/);
  if (searchMatch) {
    const html = await renderSearchPage(env, base, searchMatch[1]);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return null;
}
