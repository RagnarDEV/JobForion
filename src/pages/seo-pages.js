// src/pages/seo-pages.js
// Programmatic SEO directory + detail pages: categories, companies, skills,
// countries, and search. Job/company/skill/country data is derived live
// from D1 (see src/lib/entities.js). Categories are now ALSO fully dynamic
// (see src/lib/categories.js) — /admin/categories is the only place that
// creates/edits/reorders/removes them, no code edit required.

// SECURITY/CACHING NOTE: every render* function below accepts an
// optional trailing `user` param (added for nav auth-awareness, see
// components/nav.js) but routes/seo-pages.router.js deliberately never
// passes it. These pages are cached at the edge — the four index pages
// via the Cache API (lib/cache.js's withCache(), keyed on the request URL
// only, no Vary: Cookie) and the detail pages via a public,
// shared-cache-eligible Cache-Control header (CACHE_PRESETS.entity/
// .directory) — so a response built for one visitor's session can be
// served verbatim to a different visitor. Baking a signed-in user's
// "Dashboard" link into a cached response would leak across visitors.
// Leave `user` unset here; it only gets threaded through on pages that
// are rendered fresh per-request (see routes/pages.router.js).
import { baseLayout } from '../layout/base-layout.js';
import { logoImgHtml, jobCardSSR, directoryGridHtml } from '../components/job-card.js';
import {
  listCompanies, findCompanyBySlug, jobsByCompany,
  listSkills, findSkillBySlug, jobsBySkill,
  listCountries, findCountryBySlug, jobsByRegion,
  escapeHtml,
} from '../lib/entities.js';
import { countryFlag } from '../lib/country-flags.js';
import { MIN_JOBS_FOR_INDEXING } from '../lib/entities.js';
import { collectionPageSchema, itemListSchema, ldJsonTag } from '../lib/schema.js';
import { buildBreadcrumb } from '../lib/breadcrumbs.js';
import { truncateDescription } from '../lib/seo.js';
import { JOB_TYPE_SORT_SQL, PUBLIC_JOB_STATUS_SQL, JOB_LISTING_COLUMNS, JOB_SORT_OPTIONS } from '../config/constants.js';
import { resolveRawNames } from '../lib/directory-overrides.js';
import { getSettings } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';
import { getCardStyles } from '../lib/job-card-styles.js';
import { getLogoOverrides } from '../lib/company-logos.js';
import { getFooterPages, getMenuPages } from '../lib/pages-cms.js';
import { getNavButtons } from '../lib/nav-buttons.js';
import {
  listPublicCompanies, countPublicCompanies, getPublicCompanyBySlug, jobsForCompanyEntity,
  getVerifiedCompanyNameSet, listDistinctIndustries, listDistinctCompanyCountries,
} from '../lib/companies.js';
import { iconShieldCheck, iconGlobe, iconLink, iconMapPin, iconUsers, iconBuilding } from '../assets/icons.js';

// Shared by every function below: resolves site settings + the dynamic
// category list + card-style tiers (as both an ordered array and a
// {order, map} bundle ready to hand straight to baseLayout() for the
// "Post a Job" dropdown) — the exact same bundle home.js and job-page.js
// use, so job cards rendered here (via jobCardSSR) are pixel-identical to
// the homepage's, including any admin-customized card styles/colors.
// footerPages/menuPages/navButtons are likewise fetched once here and
// handed to every baseLayout() call below, so custom CMS pages and
// admin-added menu buttons appear consistently across every directory
// page, not just the homepage.
async function loadPageContext(env) {
  const [settings, categories, cardStyles, footerPages, menuPages, navButtons] = await Promise.all([
    getSettings(env), getCategories(env), getCardStyles(env),
    getFooterPages(env), getMenuPages(env), getNavButtons(env),
  ]);
  const categoryOrder = categories.map(c => c.key);
  const categoryMap = Object.fromEntries(categories.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }]));
  return { settings, categories, categoryOrder, categoryMap, cardStyles, footerPages, menuPages, navButtons, categoryBundle: { order: categoryOrder, map: categoryMap } };
}

// Renders a list of jobs as full homepage-style cards (jobCardSSR) inside
// a `.jobs-list` container — used by every directory detail page below
// (category/company/country/skill/search) so "Similar Jobs" and every
// listing page look identical to the homepage, not a stripped-down row.
async function jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, emptyHtml) {
  if (!jobs || !jobs.length) return emptyHtml;
  const [logoOverrides, settings, verifiedCompanySet] = await Promise.all([
    getLogoOverrides(env, jobs.map(j => j.company)),
    getSettings(env), // cheap: 60s-cached per isolate, see lib/settings.js
    getVerifiedCompanyNameSet(env), // same 60s-cache pattern, see lib/companies.js
  ]);
  const featuredEnabled = settings.feature_featured_jobs !== '0';
  return `<div class="jobs-list">${jobs.map((j, i) => jobCardSSR(j, i, categoryMap, categoryOrder, cardStyles, logoOverrides, featuredEnabled, verifiedCompanySet)).join('')}</div>`;
}

// ── /jobs — complete jobs directory ─────────────────────────────
// Homepage keeps one clear CTA and no visible pagination. This directory
// owns the full server-side job discovery experience and mirrors the same
// allow-lists used by /api/jobs, so filters and sorting never drift apart.
export async function renderJobsIndex(env, base, user = null, filters = {}) {
  const { settings, categories, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const q = String(filters.q || filters.search || '').trim().slice(0, 100);
  const category = String(filters.category || '').trim().slice(0, 60);
  const remoteType = String(filters.remote_type || '').trim();
  const employmentType = String(filters.employment_type || '').trim();
  const seniority = String(filters.seniority || '').trim();
  const country = String(filters.country || '').trim().slice(0, 100);
  const skill = String(filters.skill || '').trim().slice(0, 100);
  const company = String(filters.company || '').trim().slice(0, 120);
  const salaryMinRaw = parseInt(filters.salary_min || '', 10);
  const salaryMaxRaw = parseInt(filters.salary_max || '', 10);
  const salaryMin = Number.isFinite(salaryMinRaw) && salaryMinRaw > 0 ? Math.min(salaryMinRaw, 999999) : null;
  const salaryMax = Number.isFinite(salaryMaxRaw) && salaryMaxRaw > 0 ? Math.min(salaryMaxRaw, 999999) : null;
  const allowedDays = new Set([1, 3, 7, 14, 30]);
  const daysRaw = parseInt(filters.days || '', 10);
  const days = allowedDays.has(daysRaw) ? daysRaw : null;
  const allowedSources = new Set(['provider', 'employer', 'admin']);
  const sourceType = allowedSources.has(String(filters.source_type || '').toLowerCase()) ? String(filters.source_type).toLowerCase() : '';
  const sortKey = JOB_SORT_OPTIONS[filters.sort] ? filters.sort : 'relevance';
  const pageSize = 20;
  const requestedPage = Math.max(1, Math.min(500, parseInt(filters.page || '1', 10) || 1));
  const conditions = [PUBLIC_JOB_STATUS_SQL];
  const binds = [];
  if (category) { conditions.push('LOWER(title) LIKE ?'); binds.push(`%${category.toLowerCase()}%`); }
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    conditions.push(`(LOWER(title) LIKE ? OR LOWER(company) LIKE ? OR LOWER(location) LIKE ? OR LOWER(description) LIKE ? OR EXISTS (SELECT 1 FROM json_each(jobs.skills) je WHERE LOWER(je.value) LIKE ?))`);
    binds.push(like, like, like, like, like);
  }
  if (remoteType) { conditions.push('remote_type = ?'); binds.push(remoteType); }
  if (employmentType) { conditions.push('employment_type = ?'); binds.push(employmentType); }
  if (seniority) { conditions.push('LOWER(seniority) LIKE ?'); binds.push(`%${seniority.toLowerCase()}%`); }
  if (salaryMin) { conditions.push('salary_max_usd >= ?'); binds.push(salaryMin * 1000); }
  if (salaryMax) { conditions.push('salary_min_usd <= ?'); binds.push(salaryMax * 1000); }
  if (days) { conditions.push("created_at >= datetime('now', '-' || ? || ' days')"); binds.push(days); }
  if (sourceType) { conditions.push('source_type = ?'); binds.push(sourceType); }
  if (country) {
    const names = await resolveRawNames(env, 'country', country);
    if (names.length) { conditions.push(`(${names.map(() => '(location = ? OR location LIKE ?)').join(' OR ')})`); binds.push(...names.flatMap(n => [n, `%, ${n}`])); }
    else conditions.push('1 = 0');
  }
  if (skill) {
    const names = await resolveRawNames(env, 'skill', skill);
    if (names.length) { conditions.push(`EXISTS (SELECT 1 FROM json_each(jobs.skills) je WHERE je.value IN (${names.map(() => '?').join(',')}))`); binds.push(...names); }
    else conditions.push('1 = 0');
  }
  if (company) { conditions.push('company = ?'); binds.push(company); }
  const where = ` WHERE ${conditions.join(' AND ')}`;
  let orderBySql = JOB_SORT_OPTIONS[sortKey].sql;
  const orderParams = [];
  if (q && sortKey === 'relevance') {
    const like = `%${q.toLowerCase()}%`;
    orderBySql = `CASE WHEN LOWER(title) LIKE ? THEN 0 WHEN EXISTS (SELECT 1 FROM json_each(jobs.skills) je2 WHERE LOWER(je2.value) LIKE ?) THEN 1 WHEN LOWER(company) LIKE ? THEN 2 ELSE 3 END ASC, ${orderBySql}`;
    orderParams.push(like, like, like);
  }
  const { results: countRows } = await env.DB.prepare(`SELECT COUNT(*) AS c FROM jobs${where}`).bind(...binds).all();
  const total = Number(countRows?.[0]?.c || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const { results: jobs } = await env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS} FROM jobs${where} ORDER BY ${orderBySql} LIMIT ${pageSize} OFFSET ${offset}`).bind(...binds, ...orderParams).all();
  const safe = value => escapeHtml(String(value || ''));
  const paramNames = ['q','category','remote_type','employment_type','seniority','country','skill','company','salary_min','salary_max','days','source_type','sort'];
  const canonicalFilters = { q, category, remote_type: remoteType, employment_type: employmentType, seniority, country, skill, company, salary_min: salaryMin ? String(salaryMin) : '', salary_max: salaryMax ? String(salaryMax) : '', days: days ? String(days) : '', source_type: sourceType, sort: sortKey !== 'relevance' ? sortKey : '' };
  const queryForPage = nextPage => {
    const params = new URLSearchParams();
    for (const name of paramNames) if (canonicalFilters[name]) params.set(name, String(canonicalFilters[name]));
    if (nextPage > 1) params.set('page', String(nextPage));
    const qs = params.toString(); return `/jobs${qs ? `?${qs}` : ''}`;
  };
  const pageNumbers = [];
  if (totalPages <= 7) for (let n = 1; n <= totalPages; n++) pageNumbers.push(n);
  else { pageNumbers.push(1); if (page > 4) pageNumbers.push('…'); for (let n = Math.max(2, page - 1); n <= Math.min(totalPages - 1, page + 1); n++) pageNumbers.push(n); if (page < totalPages - 3) pageNumbers.push('…'); pageNumbers.push(totalPages); }
  const pagination = totalPages > 1 ? `<nav class="jobs-directory-pagination" aria-label="Jobs pagination">
    ${page > 1 ? `<a class="page-btn" href="${queryForPage(page - 1)}">← Previous</a>` : `<span class="page-btn disabled">← Previous</span>`}
    <div class="page-number-list">${pageNumbers.map(n => n === '…' ? '<span class="page-ellipsis">…</span>' : `<a class="page-number${n === page ? ' active' : ''}"${n === page ? ' aria-current="page"' : ''} href="${queryForPage(n)}">${n}</a>`).join('')}</div>
    ${page < totalPages ? `<a class="page-btn" href="${queryForPage(page + 1)}">Next →</a>` : `<span class="page-btn disabled">Next →</span>`}
  </nav>` : '';
  const option = (value, label, current) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`;
  const activeFilters = [
    q && ['q', `“${q}”`], category && ['category', category], remoteType && ['remote_type', remoteType.replace(/_/g, ' ')], employmentType && ['employment_type', employmentType.replace(/_/g, ' ')], seniority && ['seniority', seniority], country && ['country', country], skill && ['skill', skill], company && ['company', company], salaryMin && ['salary_min', `Min $${salaryMin}k`], salaryMax && ['salary_max', `Max $${salaryMax}k`], days && ['days', `Last ${days} days`], sourceType && ['source_type', sourceType]
  ].filter(Boolean);
  const chipUrl = key => { const next = { ...canonicalFilters }; delete next[key]; const params = new URLSearchParams(); for (const name of paramNames) if (next[name]) params.set(name, next[name]); const qs = params.toString(); return `/jobs${qs ? `?${qs}` : ''}`; };
  const categoryOptions = (categories || []).map(c => option(c.key, c.label, category)).join('');
  const clearHref = '/jobs';
  const content = `<div class="page jobs-directory-page"><style>
    .jobs-directory-page{max-width:1180px}.jobs-directory-page .breadcrumb{display:flex;align-items:center;gap:8px;margin-bottom:24px;font-size:12px;color:var(--ink3)}.jobs-directory-page .breadcrumb a{color:var(--brand);text-decoration:none}.directory-heading{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-bottom:22px}.directory-heading h1{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(26px,4vw,38px);line-height:1.12;letter-spacing:-1.2px;color:var(--ink);margin:0 0 8px}.directory-heading p{color:var(--ink2);font-size:14px;margin:0}.jobs-search-form{display:grid;grid-template-columns:minmax(240px,1.4fr) minmax(180px,1fr) auto;gap:10px;margin-bottom:12px}.jobs-search-form label{display:grid;gap:6px}.jobs-search-form label span,.jobs-filter-panel label span{font-size:10px;font-weight:800;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px}.jobs-search-form input,.jobs-filter-panel input,.jobs-filter-panel select,.jobs-sort-select{width:100%;min-height:42px;background:var(--surface);border:1px solid var(--border2);border-radius:9px;padding:0 11px;color:var(--ink);font:inherit;font-size:12px;outline:none}.jobs-search-form input:focus,.jobs-filter-panel input:focus,.jobs-filter-panel select:focus,.jobs-sort-select:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}.jobs-search-form .dash-btn{min-height:42px;white-space:nowrap}.jobs-discovery-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:22px;align-items:start}.jobs-filter-panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;box-shadow:var(--shadow);position:sticky;top:74px}.jobs-filter-panel h2{font:800 13px 'Plus Jakarta Sans',sans-serif;margin:0 0 12px;color:var(--ink)}.filter-field{display:grid;gap:6px;margin-top:11px}.filter-field input,.filter-field select{min-height:36px;font-size:11px}.filter-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:15px}.filter-actions button,.filter-actions a{font:800 11px inherit}.filter-actions button{border:0;background:var(--brand);color:#fff;border-radius:8px;padding:8px 11px;cursor:pointer}.filter-actions a{color:var(--brand);text-decoration:none}.mobile-filter-toggle{display:none}.jobs-results-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 12px}.jobs-results-summary{font-size:12px;color:var(--ink2)}.jobs-results-summary strong{color:var(--ink)}.jobs-sort{display:flex;align-items:center;gap:7px;color:var(--ink3);font-size:10px;font-weight:800}.jobs-sort-select{min-height:34px;width:auto;padding:0 28px 0 9px;font-size:11px}.active-filter-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:-2px 0 14px}.active-filter-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #cfc4fa;background:var(--brand-soft);color:var(--brand);border-radius:99px;padding:5px 8px;font-size:10px;font-weight:800;text-decoration:none}.active-filter-chip span{font-size:13px;line-height:1}.clear-filters-link{font-size:10px;color:var(--ink3);font-weight:800;text-decoration:underline;margin-left:3px}.page-number-list{display:flex;align-items:center;gap:5px}.page-number{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:34px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--ink2);text-decoration:none;font-size:11px;font-weight:800}.page-number.active,.page-number:hover{background:var(--brand);border-color:var(--brand);color:#fff}.page-ellipsis{color:var(--ink3);padding:0 2px}.jobs-directory-pagination{display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap;padding:26px 0 8px}.jobs-directory-pagination .page-btn{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 11px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--ink2);text-decoration:none;font-size:11px;font-weight:800}.jobs-directory-pagination .page-btn:hover{border-color:var(--brand);color:var(--brand)}.jobs-directory-pagination .page-btn.disabled{opacity:.45;pointer-events:none}
    @media(max-width:900px){.jobs-discovery-layout{grid-template-columns:1fr}.jobs-filter-panel{position:static}.jobs-filter-panel:not(.open){display:none}.mobile-filter-toggle{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;border:1px solid var(--border2);border-radius:9px;background:var(--surface);color:var(--ink2);font:800 11px inherit;cursor:pointer;margin-bottom:12px}.mobile-filter-toggle[aria-expanded="true"]{color:var(--brand);border-color:var(--brand)}}
    @media(max-width:620px){.jobs-directory-page{padding-left:14px;padding-right:14px}.directory-heading{align-items:start;flex-direction:column;gap:6px}.jobs-search-form{grid-template-columns:1fr;gap:8px}.jobs-search-form .dash-btn{width:100%}.jobs-results-head{align-items:flex-start;flex-direction:column}.jobs-sort{width:100%;justify-content:space-between}.jobs-sort-select{flex:1;max-width:190px}.jobs-directory-pagination{gap:5px}.jobs-directory-pagination .page-btn{padding:0 8px}.page-number{min-width:29px}}
  </style><div class="breadcrumb"><a href="/">Home</a><span>›</span><strong>Jobs</strong></div>
    <div class="directory-heading"><div><p class="eyebrow">OPEN ROLES</p><h1>Find your next opportunity</h1><p>${q || activeFilters.length ? `${total.toLocaleString()} active job${total === 1 ? '' : 's'} match your current filters.` : `Browse ${total.toLocaleString()} active job${total === 1 ? '' : 's'} available now.`}</p></div></div>
    <form method="GET" action="/jobs" class="jobs-search-form" role="search">
      <label><span>Job title, keyword, or company</span><input type="search" name="q" value="${safe(q)}" placeholder="e.g. Product Designer"></label>
      <label><span>Location</span><input type="search" name="country" value="${safe(country)}" placeholder="Anywhere"></label>
      <button type="submit" class="dash-btn dash-btn-primary">Search jobs</button>
      <input type="hidden" name="remote_type" value="${safe(remoteType)}"><input type="hidden" name="employment_type" value="${safe(employmentType)}"><input type="hidden" name="category" value="${safe(category)}"><input type="hidden" name="seniority" value="${safe(seniority)}"><input type="hidden" name="skill" value="${safe(skill)}"><input type="hidden" name="company" value="${safe(company)}"><input type="hidden" name="salary_min" value="${salaryMin || ''}"><input type="hidden" name="salary_max" value="${salaryMax || ''}"><input type="hidden" name="days" value="${days || ''}"><input type="hidden" name="source_type" value="${safe(sourceType)}"><input type="hidden" name="sort" value="${sortKey !== 'relevance' ? safe(sortKey) : ''}">
    </form>
    <button type="button" class="mobile-filter-toggle" aria-expanded="false" aria-controls="jobsFilterPanel" onclick="var p=document.getElementById('jobsFilterPanel');var open=p.classList.toggle('open');this.setAttribute('aria-expanded',open);this.innerHTML=(open?'Hide':'Show')+' filters';">Show filters</button>
    <div class="jobs-discovery-layout">
      <form method="GET" action="/jobs" class="jobs-filter-panel" id="jobsFilterPanel">
        <h2>Filter jobs</h2>
        <div class="filter-field"><label><span>Remote type</span><select name="remote_type"><option value="">Any remote type</option>${option('fully_remote','Fully remote',remoteType)}${option('hybrid','Hybrid',remoteType)}${option('on_site','On-site',remoteType)}</select></label></div>
        <div class="filter-field"><label><span>Employment type</span><select name="employment_type"><option value="">Any employment</option>${option('full_time','Full-time',employmentType)}${option('part_time','Part-time',employmentType)}${option('contract','Contract',employmentType)}</select></label></div>
        <div class="filter-field"><label><span>Category</span><select name="category"><option value="">All categories</option>${categoryOptions}</select></label></div>
        <div class="filter-field"><label><span>Seniority</span><select name="seniority"><option value="">Any level</option>${option('junior','Junior',seniority)}${option('mid','Mid-level',seniority)}${option('senior','Senior',seniority)}${option('lead','Lead',seniority)}</select></label></div>
        <div class="filter-field"><label><span>Minimum salary (USD k/yr)</span><input type="number" min="1" name="salary_min" value="${salaryMin || ''}" placeholder="e.g. 80"></label></div>
        <div class="filter-field"><label><span>Maximum salary (USD k/yr)</span><input type="number" min="1" name="salary_max" value="${salaryMax || ''}" placeholder="e.g. 180"></label></div>
        <div class="filter-field"><label><span>Posted within</span><select name="days"><option value="">Any time</option>${option('1','Last 24 hours',String(days || ''))}${option('3','Last 3 days',String(days || ''))}${option('7','Last 7 days',String(days || ''))}${option('14','Last 14 days',String(days || ''))}${option('30','Last 30 days',String(days || ''))}</select></label></div>
        <div class="filter-field"><label><span>Source</span><select name="source_type"><option value="">Any source</option>${option('provider','Provider',sourceType)}${option('employer','Employer',sourceType)}${option('admin','Admin',sourceType)}</select></label></div>
        <input type="hidden" name="q" value="${safe(q)}"><input type="hidden" name="country" value="${safe(country)}"><input type="hidden" name="skill" value="${safe(skill)}"><input type="hidden" name="company" value="${safe(company)}"><input type="hidden" name="sort" value="${sortKey !== 'relevance' ? safe(sortKey) : ''}">
        <div class="filter-actions"><button type="submit">Apply filters</button><a href="${clearHref}">Clear all</a></div>
      </form>
      <section aria-label="Job results">
        <div class="jobs-results-head"><div class="jobs-results-summary"><strong>${total.toLocaleString()}</strong> result${total === 1 ? '' : 's'}${q ? ` for <strong>“${safe(q)}”</strong>` : ''}</div><label class="jobs-sort"><span>Sort by</span><select class="jobs-sort-select" name="sort" aria-label="Sort jobs" onchange="var p=new URLSearchParams(location.search);this.value==='relevance'?p.delete('sort'):p.set('sort',this.value);p.delete('page');location='/jobs'+(p.toString()?'?'+p.toString():'')">${Object.entries(JOB_SORT_OPTIONS).map(([key, meta]) => `<option value="${key}"${sortKey === key ? ' selected' : ''}>${meta.label}</option>`).join('')}</select></label></div>
        ${activeFilters.length ? `<div class="active-filter-chips" aria-label="Active filters">${activeFilters.map(([key,label]) => `<a class="active-filter-chip" href="${chipUrl(key)}">${safe(label)} <span aria-hidden="true">×</span><span class="sr-only">Remove ${safe(label)}</span></a>`).join('')}<a class="clear-filters-link" href="${clearHref}">Clear all</a></div>` : ''}
        ${await jobsListHtml(env, jobs || [], categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">🔍</div><h3>No jobs found</h3><p>Try changing your search or removing some filters.</p>${activeFilters.length ? `<a class="dash-btn dash-btn-primary" href="${clearHref}" style="display:inline-flex;margin-top:12px;text-decoration:none">Clear filters</a>` : ''}</div>`)}
        ${pagination}
      </section>
    </div>
  </div><script>document.getElementById('jobsFilterPanel')?.addEventListener('submit',function(){this.querySelectorAll('input,select').forEach(function(el){if(!el.value)el.disabled=true;});});</script>`;
  const description = `Browse ${total.toLocaleString()} active job opportunities on ${settings.site_name}. Search and filter by title, company, location, skills, remote type, employment type, salary, date, and source.`;
  return baseLayout(`Browse Remote Jobs — ${settings.site_name}`, description, `${base}/jobs`, '', content, '', 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

// ── /categories ──
export async function renderCategoriesIndex(env, base, user = null) {
  const { settings, categoryOrder, categoryMap, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Categories', path: '/categories' }]);
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">Browse Jobs by Category</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">Explore remote roles grouped by discipline.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
      ${categoryOrder.map(k => `<a href="/categories/${k}" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;text-decoration:none;display:flex;align-items:center;gap:10px;transition:all .2s" onmouseover="this.style.borderColor='var(--brand)'" onmouseout="this.style.borderColor='var(--border)'">
        <span style="font-size:22px">${categoryMap[k].emoji}</span><span style="font-size:14px;font-weight:700;color:var(--ink)">${escapeHtml(categoryMap[k].label)}</span>
      </a>`).join('')}
    </div>
  </div>`;
  const schema = ldJsonTag(collectionPageSchema(`Job Categories — ${settings.site_name}`, 'Browse remote jobs by category.', `${base}/categories`));
  return baseLayout(`Browse Remote Jobs by Category — ${settings.site_name}`, 'Explore curated remote job listings grouped by discipline: development, design, marketing, data, DevOps, management and writing.', `${base}/categories`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

export async function renderCategoryDetail(env, base, key, user = null) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const meta = categoryMap[key];
  if (!meta) return null;
  const { results } = await env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE LOWER(title) LIKE ? AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT 60`).bind(`%${key}%`).all();
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Categories', path: '/categories' }, { name: meta.label, path: `/categories/${key}` }]);
  const jobsHtml = await jobsListHtml(env, results, categoryMap, categoryOrder, cardStyles, '<div class="empty"><div class="e-icon">📭</div><h3>No jobs in this category yet</h3></div>');
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">${meta.emoji} ${escapeHtml(meta.label)} Remote Jobs</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${(results || []).length} open remote ${escapeHtml(meta.label.toLowerCase())} positions, updated hourly.</p>
    ${jobsHtml}
  </div>`;
  const desc = truncateDescription(`Browse ${(results || []).length} remote ${meta.label.toLowerCase()} jobs updated hourly. Filter by seniority, salary, and location on ${settings.site_name}.`);
  const schema = ldJsonTag(itemListSchema((results || []).slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  return baseLayout(`${meta.label} Remote Jobs — ${settings.site_name}`, desc, `${base}/categories/${key}`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

// ── /companies ──
// Small inline badge used everywhere a real, admin-verified company name
// is shown (directory cards, the profile header, job cards/search results
// via components/job-card.js — plan §4/§8). Intentionally tiny/inline
// rather than a full component: it's three usages of one span, not worth
// a new file.
function verifiedBadgeHtml(size = 13) {
  return `<span class="verified-co-badge" title="Verified Company">${iconShieldCheck({ size })}</span>`;
}

// Professional card for a REAL company entity (has an owner account,
// possibly verified, possibly featured) — richer than the plain
// name+count pill directoryGridHtml() renders for legacy provider-only
// companies, since we actually have logo/industry/location/verification
// data to show here.
function realCompanyCardHtml(c) {
  const safeName = escapeHtml(c.name);
  const locationBits = [c.city, c.country].filter(Boolean).map(escapeHtml).join(', ');
  return `<a href="/companies/${escapeHtml(c.slug)}" class="rc-card">
    ${logoImgHtml(c.name, '48px', 'job-logo', c.logo_url || null)}
    <div class="rc-card-body">
      <div class="rc-card-name">${safeName}${c.verified ? verifiedBadgeHtml(12) : ''}</div>
      <div class="rc-card-meta">${[c.industry ? escapeHtml(c.industry) : '', locationBits].filter(Boolean).join(' · ') || 'Remote-friendly'}</div>
    </div>
    <span class="rc-card-count">${c.job_count || 0}</span>
  </a>`;
}

const REAL_COMPANY_CARD_CSS = `<style>
.rc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:28px}
.rc-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;align-items:center;gap:12px;text-decoration:none;transition:all .2s}
.rc-card:hover{border-color:var(--brand);transform:translateY(-1px);box-shadow:var(--shadow)}
.rc-card-body{flex:1;min-width:0}
.rc-card-name{font-size:13.5px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rc-card-meta{font-size:11.5px;color:var(--ink3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rc-card-count{font-size:11px;font-weight:700;color:var(--brand);background:var(--brand-soft);padding:3px 9px;border-radius:20px;flex-shrink:0}
.verified-co-badge{color:var(--brand);display:inline-flex;flex-shrink:0}
.company-filter-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
.company-filter-bar select,.company-filter-bar input{background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:8px 12px;font-size:12.5px;color:var(--ink2);font-family:inherit}
.cp-hero{background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:20px;box-shadow:var(--shadow)}
.cp-cover{height:140px;background:linear-gradient(135deg,#1830C4,#3556FF 55%,#6C3FE0);background-size:cover;background-position:center}
.cp-body{padding:0 24px 22px;margin-top:-32px}
.cp-logo-row{display:flex;align-items:flex-end;gap:16px;margin-bottom:14px}
.cp-logo{width:76px;height:76px;border-radius:16px;border:4px solid var(--surface);background:var(--surface);box-shadow:var(--shadow)}
.cp-name-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:6px}
.cp-name{font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:700;color:var(--ink)}
.cp-facts{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:16px;font-size:12.5px;color:var(--ink2)}
.cp-fact{display:flex;align-items:center;gap:5px}
.cp-links{display:flex;gap:8px;flex-wrap:wrap}
.cp-link-btn{display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border2);color:var(--ink2);padding:7px 13px;border-radius:9px;font-size:12px;font-weight:700;text-decoration:none;transition:all .2s}
.cp-link-btn:hover{border-color:var(--brand);color:var(--brand)}
.cp-desc{font-size:13.5px;color:var(--ink2);line-height:1.75;margin:16px 24px 4px;white-space:pre-line}
</style>`;

export async function renderCompaniesIndex(env, base, user = null, filters = {}) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const { q = '', country = '', industry = '', company_size = '', verified = '' } = filters;
  const verifiedOnly = verified === '1';

  const [realCompanies, realTotal, industries, countries, legacyCompanies] = await Promise.all([
    listPublicCompanies(env, { q, country, industry, company_size, verifiedOnly, limit: 60 }),
    countPublicCompanies(env, { q, country, industry, company_size, verifiedOnly }),
    listDistinctIndustries(env),
    listDistinctCompanyCountries(env),
    listCompanies(env, { limit: 200 }),
  ]);

  // A real, claimed company profile lives at the same slug the legacy
  // text-directory would have generated for that name (both use
  // slugify() from lib/entities.js) — exclude those from the legacy grid
  // below so the same company never appears twice with two different
  // (conflicting) card styles.
  const realSlugs = new Set(realCompanies.map(c => c.slug));
  const legacyFiltered = legacyCompanies.filter(c => !realSlugs.has(c.slug) && (!q || c.name.toLowerCase().includes(q.toLowerCase())));

  const anyFilterActive = q || country || industry || company_size || verifiedOnly;
  const totalShown = realTotal + (anyFilterActive ? 0 : legacyFiltered.length);

  const filterBar = `<form method="GET" action="/companies" class="company-filter-bar">
    <input type="text" name="q" value="${escapeHtml(q)}" placeholder="Search company name…" style="flex:1;min-width:180px">
    <select name="country" onchange="this.form.submit()"><option value="">All countries</option>${countries.map(c => `<option value="${escapeHtml(c)}" ${c === country ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
    <select name="industry" onchange="this.form.submit()"><option value="">All industries</option>${industries.map(i => `<option value="${escapeHtml(i)}" ${i === industry ? 'selected' : ''}>${escapeHtml(i)}</option>`).join('')}</select>
    <select name="company_size" onchange="this.form.submit()"><option value="">Any size</option>${['1-10', '11-50', '51-200', '201-1000', '1000+'].map(s => `<option value="${s}" ${s === company_size ? 'selected' : ''}>${s} employees</option>`).join('')}</select>
    <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink2)"><input type="checkbox" name="verified" value="1" ${verifiedOnly ? 'checked' : ''} onchange="this.form.submit()"> Verified only</label>
    <button type="submit" class="dash-btn dash-btn-primary" style="padding:8px 16px;font-size:12.5px">Filter</button>
    ${anyFilterActive ? `<a href="/companies" class="dash-btn" style="padding:8px 16px;font-size:12.5px">Clear</a>` : ''}
  </form>`;

  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Companies', path: '/companies' }]);
  const content = `<div class="page">${bc}${REAL_COMPANY_CARD_CSS}
    <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">Companies Hiring Remotely</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:20px">${totalShown.toLocaleString()} companies with active remote listings on ${escapeHtml(settings.site_name)}.</p>
    ${filterBar}
    ${realCompanies.length ? `<div class="rc-grid">${realCompanies.map(realCompanyCardHtml).join('')}</div>` : (anyFilterActive ? `<div class="empty"><div class="e-icon">🔍</div><h3>No companies match these filters</h3></div>` : '')}
    ${!anyFilterActive && legacyFiltered.length ? directoryGridHtml(legacyFiltered, '/companies') : ''}
  </div>`;
  const schema = ldJsonTag(collectionPageSchema(`Companies Hiring Remotely — ${settings.site_name}`, 'Directory of companies with active remote job listings.', `${base}/companies`));
  // Filtered/search views are variant listings of the same canonical
  // directory content — index only the canonical, unfiltered page to
  // avoid thin/duplicate-content variants competing with it in search.
  const robots = anyFilterActive ? 'noindex, follow' : 'index, follow';
  return baseLayout(`Companies Hiring Remotely — ${settings.site_name}`, `Browse ${totalShown.toLocaleString()} companies with active remote job openings, updated hourly on ${settings.site_name}.`, `${base}/companies`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

export async function renderCompanyDetail(env, base, slug, user = null) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);

  // Real, claimed company profile takes priority over the legacy
  // text-directory page at the same slug (see renderCompaniesIndex above
  // for why the two can never both render for the same slug in practice).
  const realCompany = await getPublicCompanyBySlug(env, slug);
  if (realCompany) return renderRealCompanyDetail(env, base, realCompany, { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons, user });

  const company = await findCompanyBySlug(env, slug);
  if (!company) return null;
  const jobs = await jobsByCompany(env, company.name, { limit: 60 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Companies', path: '/companies' }, { name: company.name, path: `/companies/${slug}` }]);
  // SECURITY: company.name is DB-derived (external providers / "Post a
  // Job" submissions) — always escape before inserting into HTML, even
  // though logoImgHtml() escapes its own internal alt text separately.
  const safeName = escapeHtml(company.name);
  const companyLogoOverride = (await getLogoOverrides(env, [company.name]))[company.name.toLowerCase()] || null;
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, '<div class="empty"><div class="e-icon">📭</div><h3>No open jobs right now</h3></div>');
  const content = `<div class="page">${bc}
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
      ${logoImgHtml(company.name, '56px', 'job-logo', companyLogoOverride)}
      <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:700;color:var(--ink)">${safeName}</h1>
    </div>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${jobs.length} open remote position${jobs.length === 1 ? '' : 's'} at ${safeName}, sourced from verified listings.</p>
    ${jobsHtml}
  </div>`;
  const desc = truncateDescription(`${company.name} has ${jobs.length} open remote job${jobs.length === 1 ? '' : 's'} on ${settings.site_name}. Browse roles and apply directly with the employer.`);
  const schema = ldJsonTag({ "@context": "https://schema.org", "@type": "Organization", "name": company.name, "url": `${base}/companies/${slug}` });
  // THIN CONTENT: a company page with only 1 job is low-value, near-
  // duplicate content at scale — exactly the pattern that gets a young
  // domain's pages mass-flagged "Discovered — currently not indexed" in
  // Search Console. noindex it (still crawlable/linked, just excluded from
  // the index) until it has enough real content to be worth ranking.
  const robots = jobs.length >= MIN_JOBS_FOR_INDEXING ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote Jobs at ${company.name} — ${settings.site_name}`, desc, `${base}/companies/${slug}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

// The professional profile for a real, account-owning company (plan §4):
// cover image, logo, verified badge, industry/size/founding/HQ facts,
// social links, and every job linked to it (company_id match OR legacy
// name match — see COMPANY_JOB_MATCH_SQL in lib/companies.js).
async function renderRealCompanyDetail(env, base, company, ctx) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons, user } = ctx;
  const safeName = escapeHtml(company.name);
  const jobs = await jobsForCompanyEntity(env, company, { limit: 60 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Companies', path: '/companies' }, { name: company.name, path: `/companies/${company.slug}` }]);
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, '<div class="empty"><div class="e-icon">📭</div><h3>No open jobs right now</h3></div>');

  const facts = [];
  if (company.industry) facts.push(`<span class="cp-fact">${iconBuilding({ size: 13 })} ${escapeHtml(company.industry)}</span>`);
  if (company.company_size) facts.push(`<span class="cp-fact">${iconUsers({ size: 13 })} ${escapeHtml(company.company_size)} employees</span>`);
  if (company.founded_year) facts.push(`<span class="cp-fact">Founded ${company.founded_year}</span>`);
  const location = company.headquarters || [company.city, company.country].filter(Boolean).join(', ');
  if (location) facts.push(`<span class="cp-fact">${iconMapPin({ size: 13 })} ${escapeHtml(location)}</span>`);

  const links = [];
  if (company.website) links.push(`<a href="${escapeHtml(company.website)}" target="_blank" rel="noopener noreferrer" class="cp-link-btn">${iconGlobe({ size: 13 })} Website</a>`);
  if (company.linkedin_url) links.push(`<a href="${escapeHtml(company.linkedin_url)}" target="_blank" rel="noopener noreferrer" class="cp-link-btn">${iconLink({ size: 13 })} LinkedIn</a>`);
  if (company.twitter_url) links.push(`<a href="${escapeHtml(company.twitter_url)}" target="_blank" rel="noopener noreferrer" class="cp-link-btn">${iconLink({ size: 13 })} Twitter/X</a>`);
  if (company.facebook_url) links.push(`<a href="${escapeHtml(company.facebook_url)}" target="_blank" rel="noopener noreferrer" class="cp-link-btn">${iconLink({ size: 13 })} Facebook</a>`);

  const content = `<div class="page">${bc}${REAL_COMPANY_CARD_CSS}
    <div class="cp-hero">
      <div class="cp-cover" style="${company.cover_image_url ? `background-image:url('${escapeHtml(company.cover_image_url)}')` : ''}"></div>
      <div class="cp-body">
        <div class="cp-logo-row">
          ${logoImgHtml(company.name, '76px', 'cp-logo', company.logo_url || null)}
          <div class="cp-name-row"><span class="cp-name">${safeName}</span>${company.verified ? verifiedBadgeHtml(16) : ''}</div>
        </div>
        ${facts.length ? `<div class="cp-facts">${facts.join('')}</div>` : ''}
        ${links.length ? `<div class="cp-links">${links.join('')}</div>` : ''}
      </div>
    </div>
    ${company.description ? `<div class="cp-desc" style="margin:0 0 20px">${escapeHtml(company.description)}</div>` : ''}
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${jobs.length} open remote position${jobs.length === 1 ? '' : 's'} at ${safeName}.</p>
    ${jobsHtml}
  </div>`;

  const desc = truncateDescription(company.description || `${company.name} has ${jobs.length} open remote job${jobs.length === 1 ? '' : 's'} on ${settings.site_name}. ${company.industry || ''} company${location ? ' based in ' + location : ''}.`);
  const sameAs = [company.linkedin_url, company.twitter_url, company.facebook_url].filter(Boolean);
  const schema = ldJsonTag({
    "@context": "https://schema.org", "@type": "Organization",
    "name": company.name, "url": `${base}/companies/${company.slug}`,
    ...(company.logo_url ? { logo: company.logo_url } : {}),
    ...(company.description ? { description: company.description } : {}),
    ...(company.website ? { sameAs: [company.website, ...sameAs] } : (sameAs.length ? { sameAs } : {})),
    ...(company.founded_year ? { foundingDate: String(company.founded_year) } : {}),
    ...(location ? { address: { "@type": "PostalAddress", addressLocality: location } } : {}),
  });
  const robots = jobs.length >= MIN_JOBS_FOR_INDEXING ? 'index, follow' : 'noindex, follow';
  return baseLayout(`${company.verified ? '✓ ' : ''}${company.name} — Remote Jobs — ${settings.site_name}`, desc, `${base}/companies/${company.slug}`, company.logo_url || '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

// ── /countries ──
// Mirrors the /companies pattern exactly: listCountries()/findCountryBySlug()
// derive country/region names from the existing jobs.location column (see
// splitLocation() in lib/entities.js) — no new table, no schema migration.
// Every country name is prefixed with a flag emoji via countryFlag()
// (lib/country-flags.js), both in the directory grid and the detail heading.
export async function renderCountriesIndex(env, base, user = null) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const countries = await listCountries(env, { limit: 200 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Countries', path: '/countries' }]);
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">Browse Remote Jobs by Country</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${countries.length} countries and regions with active remote listings on ${escapeHtml(settings.site_name)}.</p>
    ${directoryGridHtml(countries, '/countries', (c) => `<span aria-hidden="true">${countryFlag(c.name)}</span> `)}
  </div>`;
  const schema = ldJsonTag(collectionPageSchema(`Countries — ${settings.site_name}`, 'Browse remote jobs by country or region.', `${base}/countries`));
  return baseLayout(`Browse Remote Jobs by Country — ${settings.site_name}`, `Explore remote job listings across ${countries.length} countries and regions, updated hourly on ${settings.site_name}.`, `${base}/countries`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

export async function renderCountryDetail(env, base, slug, user = null) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const country = await findCountryBySlug(env, slug);
  if (!country) return null;
  const jobs = await jobsByRegion(env, country.rawNames || country.name, { limit: 60 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Countries', path: '/countries' }, { name: country.name, path: `/countries/${slug}` }]);
  // SECURITY: country.name is derived from jobs.location, which ultimately
  // traces back to external provider data — escape before rendering.
  const safeName = escapeHtml(country.name);
  const flag = countryFlag(country.name);
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, '<div class="empty"><div class="e-icon">📭</div><h3>No open jobs in this location yet</h3></div>');
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">${flag} Remote Jobs in ${safeName}</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${jobs.length} open remote position${jobs.length === 1 ? '' : 's'} located in or hiring from ${safeName}.</p>
    ${jobsHtml}
  </div>`;
  const desc = truncateDescription(`Browse ${jobs.length} remote jobs in ${country.name}. Updated hourly on ${settings.site_name}.`);
  const schema = ldJsonTag(itemListSchema(jobs.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  // THIN CONTENT: see the identical note on renderCompanyDetail above.
  const robots = jobs.length >= MIN_JOBS_FOR_INDEXING ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote Jobs in ${country.name} — ${settings.site_name}`, desc, `${base}/countries/${slug}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

// ── /skills ──
export async function renderSkillsIndex(env, base, user = null) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const skills = await listSkills(env, { limit: 200 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Skills', path: '/skills' }]);
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">Browse Remote Jobs by Skill</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${skills.length} in-demand skills across current listings.</p>
    ${directoryGridHtml(skills, '/skills')}
  </div>`;
  const schema = ldJsonTag(collectionPageSchema(`Skills — ${settings.site_name}`, 'Browse remote jobs by required skill.', `${base}/skills`));
  return baseLayout(`Browse Remote Jobs by Skill — ${settings.site_name}`, `Explore ${skills.length} in-demand skills across current remote job listings on ${settings.site_name}.`, `${base}/skills`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

export async function renderSkillDetail(env, base, slug, user = null) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const skill = await findSkillBySlug(env, slug);
  if (!skill) return null;
  const jobs = await jobsBySkill(env, skill.rawNames || skill.name, { limit: 60 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Skills', path: '/skills' }, { name: skill.name, path: `/skills/${slug}` }]);
  // SECURITY: skill.name is parsed from the jobs.skills JSON column,
  // itself sourced from external providers — escape before rendering.
  const safeName = escapeHtml(skill.name);
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, '<div class="empty"><div class="e-icon">📭</div><h3>No jobs currently require this skill</h3></div>');
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">Remote Jobs Requiring ${safeName}</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${jobs.length} open remote positions listing ${safeName} as a required skill.</p>
    ${jobsHtml}
  </div>`;
  const desc = truncateDescription(`Browse ${jobs.length} remote jobs requiring ${skill.name}. Updated hourly on ${settings.site_name}.`);
  const schema = ldJsonTag(itemListSchema(jobs.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  // THIN CONTENT: see the identical note on renderCompanyDetail above.
  const robots = jobs.length >= MIN_JOBS_FOR_INDEXING ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote ${skill.name} Jobs — ${settings.site_name}`, desc, `${base}/skills/${slug}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

// ── /search/:query — indexable only when it returns real content ──
export async function renderSearchPage(env, base, query, user = null) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const q = decodeURIComponent(query || '').trim();
  const qLower = q.toLowerCase();
  // Same field coverage as /api/jobs' keyword search (Stage 8) — a
  // search term that only appears in a job's skills list or description
  // (not literally in the title/company/location) used to return zero
  // results here even though a genuinely relevant job existed.
  const { results } = await env.DB.prepare(
    `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE (LOWER(title) LIKE ? OR LOWER(company) LIKE ? OR LOWER(location) LIKE ? OR LOWER(description) LIKE ? OR EXISTS (SELECT 1 FROM json_each(jobs.skills) je WHERE LOWER(je.value) LIKE ?)) AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT 50`
  ).bind(`%${qLower}%`, `%${qLower}%`, `%${qLower}%`, `%${qLower}%`, `%${qLower}%`).all();
  const hasResults = (results || []).length > 0;
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: `Search: ${q}`, path: `/search/${query}` }]);
  // SECURITY: q comes directly from the URL path (decodeURIComponent), so
  // it's fully attacker-controlled — e.g. /search/<script>...</script>
  // would previously render raw into the page body. Always escape before
  // inserting into HTML, even though baseLayout() already escapes the
  // <title>/<meta description> tags separately (this `content` string is
  // inserted as-is, unescaped, by baseLayout).
  const safeQ = escapeHtml(q);
  const jobsHtml = await jobsListHtml(env, results, categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">🔍</div><h3>No matches for "${safeQ}"</h3><p>Try browsing <a href="/categories" style="color:var(--brand)">categories</a> instead.</p></div>`);
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:700;margin-bottom:8px;color:var(--ink)">Remote "${safeQ}" Jobs</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${(results || []).length} results for "${safeQ}"</p>
    ${jobsHtml}
  </div>`;
  const desc = hasResults
    ? truncateDescription(`${results.length} remote "${q}" jobs available now. Browse and apply directly on ${settings.site_name}.`)
    : `No current openings match "${q}" — browse all remote job categories on ${settings.site_name}.`;
  const schema = hasResults ? ldJsonTag(itemListSchema(results.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` })))) : '';
  // thin/empty search pages are noindexed to avoid low-quality-page SEO penalties
  const robots = hasResults ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote "${q}" Jobs — ${settings.site_name}`, desc, `${base}/search/${encodeURIComponent(q)}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}
