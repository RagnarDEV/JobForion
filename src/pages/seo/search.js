// src/pages/seo/search.js
// /search/:q results (always noindex).

import { windowedJobs } from '../../lib/platform/job-window.js';
import { baseLayout } from '../../layout/base-layout.js';
import { escapeHtml } from '../../lib/directory/entities.js';
import { itemListSchema, ldJsonTag } from '../../lib/seo/jsonld.js';
import { buildBreadcrumb } from '../../lib/seo/breadcrumbs.js';
import { truncateDescription } from '../../lib/seo/meta.js';
import { keywordCondition, normalizeSearchTerm, safeDecodeURIComponent } from '../../lib/platform/search-utils.js';
import { JOB_MANUAL_PIN_SORT_SQL, JOB_LISTING_COLUMNS } from '../../config/constants.js';
import { loadPageContext, jobsListHtml } from './shared.js';

import { iconSearch } from '../../assets/icons.js';
// ── /search/:query — indexable only when it returns real content ──
export async function renderSearchPage(env, base, query, user = null) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  // SECURITY: a malformed percent-escape must never crash the request.
  const q = normalizeSearchTerm(safeDecodeURIComponent(query || '') ?? '');
  // Same field coverage as /api/jobs' keyword search (Stage 8) — a
  // search term that only appears in a job's skills list or description
  // (not literally in the title/company/location) used to return zero
  // results here even though a genuinely relevant job existed.
  let results = [];
  if (q.length >= 2) {
    const kw = keywordCondition(q);
    try {
      ({ results } = await env.DB.prepare(
        `SELECT ${JOB_LISTING_COLUMNS} FROM ${windowedJobs()} WHERE ${kw.sql} ORDER BY ${JOB_MANUAL_PIN_SORT_SQL} LIMIT 50`
      ).bind(...kw.binds).all());
    } catch (e) { results = []; }
  }
  const hasResults = (results || []).length > 0;
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: `Search: ${q}`, path: `/search/${encodeURIComponent(q)}` }]);
  // SECURITY: q comes directly from the URL path (decodeURIComponent), so
  // it's fully attacker-controlled — e.g. /search/<script>...</script>
  // would previously render raw into the page body. Always escape before
  // inserting into HTML, even though baseLayout() already escapes the
  // <title>/<meta description> tags separately (this `content` string is
  // inserted as-is, unescaped, by baseLayout).
  const safeQ = escapeHtml(q);
  const jobsHtml = await jobsListHtml(env, results, categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">${iconSearch({ size: 44 })}</div><h3>No matches for "${safeQ}"</h3><p>Try browsing <a href="/categories" style="color:var(--brand)">categories</a> instead.</p></div>`);
  const content = `<div class="page">${bc}
    <h1 style="font-family:var(--font-heading,sans-serif);font-size:24px;font-weight:700;margin-bottom:8px;color:var(--ink)">Remote "${safeQ}" Jobs</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${(results || []).length} results for "${safeQ}"</p>
    ${jobsHtml}
  </div>`;
  const desc = hasResults
    ? truncateDescription(`${results.length} remote "${q}" jobs available now. Browse and apply directly on ${settings.site_name}.`)
    : `No current openings match "${q}" — browse all remote job categories on ${settings.site_name}.`;
  const schema = hasResults ? ldJsonTag(itemListSchema(results.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` })))) : '';
  // SEO SECURITY: /search/* is ALWAYS noindex. Otherwise anyone can mint an
  // indexable page reflecting arbitrary text on this domain (index bloat /
  // reputation spam). Real landing pages are /categories, /skills, /companies.
  const robots = 'noindex, follow';
  return baseLayout(`Remote "${q}" Jobs — ${settings.site_name}`, desc, `${base}/search/${encodeURIComponent(q)}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}
