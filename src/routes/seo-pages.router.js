// src/routes/seo-pages.router.js
// Programmatic SEO directory + detail pages. Index pages are wrapped in the
// Cache API (src/lib/cache.js) since they're aggregate D1 queries that don't
// change per-request; detail pages set a shorter Cache-Control instead.

import {
  renderCategoriesIndex, renderCategoryDetail,
  renderCompaniesIndex, renderCompanyDetail,
  renderSkillsIndex, renderSkillDetail,
  renderCountriesIndex, renderCountryDetail,
  renderSearchPage,
} from '../pages/seo-pages.js';
import { withCache, CACHE_PRESETS } from '../lib/cache.js';

export async function handleSeoPagesRoute(url, request, env, ctx, base) {
  if (url.pathname === '/categories') {
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderCategoriesIndex(base));
  }
  const catMatch = url.pathname.match(/^\/categories\/([a-z]+)$/);
  if (catMatch) {
    const html = await renderCategoryDetail(env, base, catMatch[1]);
    if (!html) return new Response('Not found', { status: 404 });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE_PRESETS.entity } });
  }
  if (url.pathname === '/companies') {
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderCompaniesIndex(env, base));
  }
  const companyMatch = url.pathname.match(/^\/companies\/([a-z0-9-]+)$/);
  if (companyMatch) {
    const html = await renderCompanyDetail(env, base, companyMatch[1]);
    if (!html) return new Response('Company not found', { status: 404 });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE_PRESETS.entity } });
  }
  if (url.pathname === '/countries') {
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderCountriesIndex(env, base));
  }
  const countryMatch = url.pathname.match(/^\/countries\/([a-z0-9-]+)$/);
  if (countryMatch) {
    const html = await renderCountryDetail(env, base, countryMatch[1]);
    if (!html) return new Response('Country not found', { status: 404 });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE_PRESETS.entity } });
  }
  if (url.pathname === '/skills') {
    return await withCache(ctx, request, CACHE_PRESETS.directory, async () => renderSkillsIndex(env, base));
  }
  const skillMatch = url.pathname.match(/^\/skills\/([a-z0-9-]+)$/);
  if (skillMatch) {
    const html = await renderSkillDetail(env, base, skillMatch[1]);
    if (!html) return new Response('Skill not found', { status: 404 });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE_PRESETS.entity } });
  }
  const searchMatch = url.pathname.match(/^\/search\/([^/]+)$/);
  if (searchMatch) {
    const html = await renderSearchPage(env, base, searchMatch[1]);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return null;
}
