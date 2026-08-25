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
import { companyCardHtml, companyCardStyles, companyEmptyState } from '../components/company-card.js';
import {
  listCompanies, findCompanyBySlug,
  listSkills, findSkillBySlug, jobsBySkill, countJobsBySkill,
  listCountries, findCountryBySlug, jobsByRegion, countJobsByRegion,
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
import { getLogoOverrides, attachCompanyLogos } from '../lib/company-logos.js';
import { hydrateHotPay } from '../lib/hot-pay.js';
import { getFooterPages, getMenuPages } from '../lib/pages-cms.js';
import { getNavButtons } from '../lib/nav-buttons.js';
import {
  listPublicCompanies, countPublicCompanies, getPublicCompanyBySlug, jobsForCompanyEntity, countJobsForCompanyEntity,
  getVerifiedCompanyNameSet, listDistinctIndustries, listDistinctCompanyCountries,
} from '../lib/companies.js';
import { iconGlobe, iconLink, iconMapPin, iconUsers, iconBuilding, iconArrowRight, iconBriefcase, iconBadgeCheck, iconSearch, iconFolder, iconFileText } from '../assets/icons.js';
import { PUBLIC_PAGE_CSS, publicPageHeader, publicCard } from '../components/public-page.js';

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
  const [hydratedJobs, logoOverrides, settings, verifiedCompanySet] = await Promise.all([
    attachCompanyLogos(env, jobs),
    getLogoOverrides(env, jobs.map(j => j.company)),
    getSettings(env), // cheap: 60s-cached per isolate, see lib/settings.js
    getVerifiedCompanyNameSet(env), // same 60s-cache pattern, see lib/companies.js
  ]);
  const featuredEnabled = settings.feature_featured_jobs !== '0';
  const classifiedJobs = await hydrateHotPay(env, hydratedJobs, settings);
  return `<div class="jobs-list">${classifiedJobs.map((j, i) => jobCardSSR(j, i, categoryMap, categoryOrder, cardStyles, logoOverrides, featuredEnabled, verifiedCompanySet, settings)).join('')}</div>`;
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

// ── /remote-jobs ──
export async function renderRemoteJobsLanding(env, base, user = null, filters = {}) {
  const { settings, categories, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const remoteWhere = `${PUBLIC_JOB_STATUS_SQL} AND remote_type = ?`;
  const pageSize = 12;
  const requestedPage = Math.max(1, Math.min(500, parseInt(filters.page || '1', 10) || 1));
  const [{ results: countRows }, { results: companyRows }] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${remoteWhere}`).bind('fully_remote').all(),
    env.DB.prepare(`SELECT company, COUNT(*) AS c FROM jobs WHERE ${remoteWhere} AND company IS NOT NULL AND company != '' GROUP BY company ORDER BY c DESC, company ASC LIMIT 6`).bind('fully_remote').all(),
  ]);
  const total = Number(countRows?.[0]?.c || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const { results: jobs } = await env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE ${remoteWhere} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT ? OFFSET ?`).bind('fully_remote', pageSize, (page - 1) * pageSize).all();
  const jobsHtml = await jobsListHtml(env, jobs || [], categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">📭</div><h3>No fully remote jobs available</h3><p>Try the full Jobs directory to explore hybrid and on-site roles as well.</p><a class="public-primary-link" href="/jobs">Browse all jobs →</a></div>`);
  const pageLink = n => `/remote-jobs${n > 1 ? `?page=${n}` : ''}`;
  const pagination = totalPages > 1 ? `<nav class="jobs-directory-pagination" aria-label="Remote jobs pagination">${page > 1 ? `<a class="page-btn" href="${pageLink(page - 1)}">← Previous</a>` : '<span class="page-btn disabled">← Previous</span>'}<span class="page-number-list">${Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.min(totalPages, page + 2)).map(n => `<a class="page-number${n === page ? ' active' : ''}"${n === page ? ' aria-current="page"' : ''} href="${pageLink(n)}">${n}</a>`).join('')}</span>${page < totalPages ? `<a class="page-btn" href="${pageLink(page + 1)}">Next →</a>` : '<span class="page-btn disabled">Next →</span>'}</nav>` : '';
  const categoryCards = (categories || []).slice(0, 6).map(category => publicCard({ href: `/jobs?remote_type=fully_remote&category=${encodeURIComponent(category.key)}`, icon: category.emoji || '•', title: category.label, meta: 'Remote roles' })).join('');
  const companyCards = (companyRows || []).map(row => publicCard({ href: `/jobs?remote_type=fully_remote&company=${encodeURIComponent(row.company)}`, icon: iconBuilding({ size: 18 }), title: row.company, meta: 'Fully remote roles', count: row.c })).join('');
  const resourceCards = [
    publicCard({ href: '/blog', icon: iconFileText({ size: 18 }), title: 'Career blog', description: 'Practical guidance for your remote search.', meta: 'Read resources' }),
    publicCard({ href: '/skills', icon: iconSearch({ size: 18 }), title: 'Browse by skill', description: 'See skills connected to live listings.', meta: 'Explore skills' }),
    publicCard({ href: '/countries', icon: iconGlobe({ size: 18 }), title: 'Browse locations', description: 'Discover where remote teams are hiring.', meta: 'Explore locations' }),
  ].join('');
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Remote Jobs', path: '/remote-jobs' }]);
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'REMOTE-FIRST SEARCH', title: 'Find your next remote opportunity', description: `${total.toLocaleString()} fully remote jobs are available in the current JobForion listings.` , actions: `<a class="public-primary-link" href="/jobs?remote_type=fully_remote">Search all remote jobs →</a>` })}<section class="public-section" aria-labelledby="remote-latest"><div class="public-section-heading"><div><h2 id="remote-latest">Latest fully remote jobs</h2><p>Real active listings from the current backend.</p></div><a href="/jobs?remote_type=fully_remote">View all remote jobs →</a></div>${jobsHtml}${pagination}</section>${categoryCards ? `<section class="public-section" aria-labelledby="remote-categories"><div class="public-section-heading"><div><h2 id="remote-categories">Popular remote categories</h2><p>Start with a discipline that matches your search.</p></div></div><div class="public-card-grid">${categoryCards}</div></section>` : ''}${companyCards ? `<section class="public-section" aria-labelledby="remote-companies"><div class="public-section-heading"><div><h2 id="remote-companies">Companies hiring remotely</h2><p>Based on active fully remote listings.</p></div></div><div class="public-card-grid">${companyCards}</div></section>` : ''}<section class="public-section" aria-labelledby="remote-resources"><div class="public-section-heading"><div><h2 id="remote-resources">Useful resources</h2><p>Keep your search focused and informed.</p></div></div><div class="public-card-grid resources-grid">${resourceCards}</div></section></div>`;
  const schema = ldJsonTag(collectionPageSchema(`Remote Jobs — ${settings.site_name}`, 'Discover active fully remote opportunities, categories, companies, and career resources.', `${base}/remote-jobs`));
  const robots = total >= MIN_JOBS_FOR_INDEXING && page === 1 ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote Jobs — ${settings.site_name}`, `Find ${total.toLocaleString()} active fully remote opportunities on ${settings.site_name}.`, `${base}/remote-jobs`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

// ── /categories ──
export async function renderCategoriesIndex(env, base, user = null) {
  const { settings, categoryOrder, categoryMap, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Categories', path: '/categories' }]);
  const cards = categoryOrder.map(key => publicCard({
    href: `/categories/${encodeURIComponent(key)}`,
    icon: categoryMap[key]?.emoji || '•',
    title: categoryMap[key]?.label || key,
    description: `Explore open remote roles in ${String(categoryMap[key]?.label || key).toLowerCase()}.`,
    meta: 'View open jobs',
  })).join('');
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'EXPLORE BY CATEGORY', title: 'Explore jobs by category', description: 'Browse real remote opportunities grouped by the disciplines and categories managed in JobForion.' })}<section class="public-card-grid" aria-label="Job categories">${cards || `<div class="empty"><div class="e-icon">📭</div><h3>No categories available</h3><p>Categories will appear after they are configured.</p></div>`}</section><div class="public-callout"><div><h2>Ready to search?</h2><p>Use the complete Jobs directory to combine category, location, salary, and remote filters.</p></div><a class="public-primary-link" href="/jobs">Browse all jobs →</a></div></div>`;
  const schema = ldJsonTag(collectionPageSchema(`Job Categories — ${settings.site_name}`, 'Browse remote jobs by category.', `${base}/categories`));
  return baseLayout(`Browse Remote Jobs by Category — ${settings.site_name}`, 'Explore remote job listings grouped by the live categories configured in JobForion.', `${base}/categories`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

export async function renderCategoryDetail(env, base, key, user = null, filters = {}) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const meta = categoryMap[key];
  if (!meta) return null;
  const pageSize = 20;
  const requestedPage = Math.max(1, Math.min(500, parseInt(filters.page || '1', 10) || 1));
  const categoryLike = `%${key.toLowerCase()}%`;
  const { results: countRows } = await env.DB.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE LOWER(title) LIKE ? AND ${PUBLIC_JOB_STATUS_SQL}`).bind(categoryLike).all();
  const total = Number(countRows?.[0]?.c || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const { results: jobs } = await env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE LOWER(title) LIKE ? AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`).bind(categoryLike).all();
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Categories', path: '/categories' }, { name: meta.label, path: `/categories/${key}` }]);
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">📭</div><h3>No jobs in this category yet</h3><p>Browse the full Jobs directory to explore other active roles.</p><a class="public-primary-link" href="/jobs?category=${encodeURIComponent(key)}">Browse all jobs →</a></div>`);
  const pageLink = n => `/categories/${encodeURIComponent(key)}${n > 1 ? `?page=${n}` : ''}`;
  const pagination = totalPages > 1 ? `<nav class="jobs-directory-pagination" aria-label="Category jobs pagination">${page > 1 ? `<a class="page-btn" href="${pageLink(page - 1)}">← Previous</a>` : '<span class="page-btn disabled">← Previous</span>'}<span class="page-number-list">${Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.min(totalPages, page + 2)).map(n => `<a class="page-number${n === page ? ' active' : ''}"${n === page ? ' aria-current="page"' : ''} href="${pageLink(n)}">${n}</a>`).join('')}</span>${page < totalPages ? `<a class="page-btn" href="${pageLink(page + 1)}">Next →</a>` : '<span class="page-btn disabled">Next →</span>'}</nav>` : '';
  const related = categoryOrder.filter(other => other !== key).slice(0, 4).map(other => publicCard({ href: `/categories/${encodeURIComponent(other)}`, icon: categoryMap[other]?.emoji || '•', title: categoryMap[other]?.label || other, meta: 'Explore category' })).join('');
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'CATEGORY JOBS', title: `${meta.emoji || ''} ${meta.label} jobs`, description: `${total.toLocaleString()} active opportunities matched to this category.` })}<div class="public-callout"><div><h2>Refine your search</h2><p>Use the shared Jobs directory to filter this category by remote type, employment, salary, location, and seniority.</p></div><a class="public-primary-link" href="/jobs?category=${encodeURIComponent(key)}">Open job filters →</a></div><section class="public-section" aria-labelledby="category-open-jobs"><div class="public-section-heading"><div><h2 id="category-open-jobs">Latest ${escapeHtml(meta.label)} roles</h2><p>${total.toLocaleString()} active listing${total === 1 ? '' : 's'} from the current backend.</p></div></div>${jobsHtml}${pagination}</section>${related ? `<section class="public-section" aria-labelledby="related-categories"><div class="public-section-heading"><h2 id="related-categories">Explore more categories</h2></div><div class="public-card-grid">${related}</div></section>` : ''}</div>`;
  const desc = truncateDescription(`Browse ${total} remote ${meta.label.toLowerCase()} jobs on ${settings.site_name}. Use the full Jobs directory to refine by salary, location, and seniority.`);
  const schema = ldJsonTag(itemListSchema((jobs || []).slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  const robots = total >= MIN_JOBS_FOR_INDEXING && page === 1 ? 'index, follow' : 'noindex, follow';
  return baseLayout(`${meta.label} Remote Jobs — ${settings.site_name}`, desc, `${base}/categories/${key}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

// ── /companies ──
function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch (e) { return ''; }
}

function safeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  return safeExternalUrl(raw);
}

function companyLogoUrl(company, logoOverride = null) {
  return safeImageUrl(logoOverride || company.logo_url || '');
}

function companyCoverHtml(company) {
  const cover = safeImageUrl(company.cover_image_url);
  return `<div class="company-cover">${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(company.name || '')} cover image" loading="eager">` : `<div class="company-cover-fallback" aria-hidden="true"><span>${escapeHtml((company.name || 'JobForion').slice(0, 1).toUpperCase())}</span></div>`}</div>`;
}

function companyFactsHtml(company, jobsCount) {
  const facts = [];
  if (company.industry) facts.push(`<span>${iconBuilding({ size: 14 })}${escapeHtml(company.industry)}</span>`);
  if (company.company_size) facts.push(`<span>${iconUsers({ size: 14 })}${escapeHtml(company.company_size)} employees</span>`);
  const location = company.headquarters || [company.city, company.country].filter(Boolean).join(', ');
  if (location) facts.push(`<span>${iconMapPin({ size: 14 })}${escapeHtml(location)}</span>`);
  if (jobsCount !== null && jobsCount !== undefined) facts.push(`<span>${iconBriefcase({ size: 14 })}${jobsCount.toLocaleString()} open job${jobsCount === 1 ? '' : 's'}</span>`);
  return facts.join('');
}

function companySocialLinksHtml(company) {
  const links = [
    ['website', company.website, 'Visit website', iconGlobe],
    ['linkedin', company.linkedin_url, 'LinkedIn', iconLink],
    ['twitter', company.twitter_url, 'Twitter / X', iconLink],
    ['facebook', company.facebook_url, 'Facebook', iconLink],
  ];
  return links.map(([, raw, label, icon]) => {
    const href = safeExternalUrl(raw);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="company-link-btn" aria-label="${label}">${icon({ size: 14 })}${label}</a>` : '';
  }).join('');
}

const COMPANY_PAGE_CSS = `<style>
.company-cover{height:168px;position:relative;overflow:hidden;background:linear-gradient(135deg,#182cbb,#3556ff 55%,#6c3fe0)}.company-cover img{width:100%;height:100%;display:block;object-fit:cover}.company-cover-fallback{width:100%;height:100%;display:grid;place-items:center;background:radial-gradient(circle at 75% 20%,rgba(255,255,255,.2),transparent 32%),linear-gradient(135deg,#182cbb,#3556ff 55%,#6c3fe0)}.company-cover-fallback span{font:800 64px 'Plus Jakarta Sans',sans-serif;color:rgba(255,255,255,.2)}
.company-profile-shell{max-width:1120px}.company-profile-hero{margin-bottom:20px;background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:var(--shadow-card)}.company-profile-body{padding:0 24px 22px;margin-top:-34px;position:relative}.company-profile-head{display:flex;align-items:flex-end;gap:16px;margin-bottom:14px}.company-profile-logo{width:82px;height:82px;border:4px solid var(--surface);border-radius:17px;background:var(--surface);box-shadow:var(--shadow);flex:0 0 82px}.company-profile-logo img{width:100%;height:100%;object-fit:contain;padding:8px}.company-profile-name-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:7px}.company-profile-name{font:800 25px/1.15 'Plus Jakarta Sans',sans-serif;color:var(--ink)}.company-verified{color:var(--brand);display:inline-flex}.company-profile-facts{display:flex;flex-wrap:wrap;gap:10px 16px;color:var(--ink2);font-size:12px;margin-bottom:15px}.company-profile-facts span{display:inline-flex;align-items:center;gap:5px}.company-profile-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.company-link-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface2);color:var(--ink2);text-decoration:none;font-size:11px;font-weight:800;transition:all .18s}.company-link-btn:hover{border-color:var(--brand);color:var(--brand)}.company-primary-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:9px;background:var(--brand);color:#fff;text-decoration:none;font-size:11px;font-weight:800;box-shadow:0 6px 16px rgba(99,57,230,.2)}.company-primary-btn:hover{filter:brightness(1.05)}.company-section{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:16px}.company-section-title{margin:0 0 12px;color:var(--ink);font:800 15px 'Plus Jakarta Sans',sans-serif}.company-about{color:var(--ink2);font-size:13px;line-height:1.75;white-space:pre-line}.company-tabs{display:flex;gap:22px;overflow-x:auto;border-bottom:1px solid var(--border);margin-bottom:16px;scrollbar-width:none}.company-tabs::-webkit-scrollbar{display:none}.company-tabs a{padding:0 0 11px;color:var(--ink3);font-size:12px;font-weight:800;text-decoration:none;white-space:nowrap;position:relative}.company-tabs a.active{color:var(--brand)}.company-tabs a.active:after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--brand)}.company-pagination{display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:20px}.company-pagination a,.company-pagination span{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:34px;padding:0 10px;border:1px solid var(--border2);border-radius:8px;color:var(--ink2);text-decoration:none;font-size:11px;font-weight:800}.company-pagination .active{background:var(--brand);border-color:var(--brand);color:#fff}.company-pagination .disabled{opacity:.45}.company-empty-state{margin:0}.company-error{padding:18px;border:1px solid rgba(220,70,70,.2);background:rgba(220,70,70,.04);border-radius:12px;color:var(--ink2)}
.company-directory-page{max-width:1180px}.company-directory-heading{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:20px}.company-directory-heading h1{margin:0 0 8px;color:var(--ink);font:800 clamp(26px,4vw,38px)/1.12 'Plus Jakarta Sans',sans-serif;letter-spacing:-1px}.company-directory-heading p{margin:0;color:var(--ink2);font-size:13px}.company-directory-count{display:grid;justify-items:end;gap:3px;color:var(--ink3);font-size:10px;font-weight:800}.company-directory-count strong{color:var(--brand);font:800 28px 'Plus Jakarta Sans',sans-serif}.company-filter-layout{display:grid;grid-template-columns:minmax(240px,1fr) auto auto;gap:9px;align-items:end;margin-bottom:14px}.company-search-field,.company-filter-panel label{display:grid;gap:6px}.company-search-field>span,.company-filter-panel label>span,.company-filter-panel-title{color:var(--ink3);font-size:10px;font-weight:800;letter-spacing:.45px;text-transform:uppercase}.company-search-field input,.company-filter-panel select{width:100%;min-height:42px;padding:0 11px;border:1px solid var(--border2);border-radius:9px;background:var(--surface);color:var(--ink);font:inherit;font-size:12px;outline:none}.company-search-field input:focus,.company-filter-panel select:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}.company-search-btn{min-height:42px;white-space:nowrap}.company-filter-toggle{display:none;min-height:38px;padding:0 12px;border:1px solid var(--border2);border-radius:9px;background:var(--surface);color:var(--ink2);font:800 11px inherit}.company-filter-panel{grid-column:1/-1;display:flex;align-items:end;gap:10px;flex-wrap:wrap;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface2)}.company-filter-panel label{min-width:160px}.company-filter-panel-title{width:100%;color:var(--ink)}.company-checkbox{display:flex!important;align-items:center;gap:7px;min-height:36px}.company-checkbox input{accent-color:var(--brand)}.company-filter-actions{display:flex;align-items:center;gap:10px;margin-left:auto}.company-filter-actions button{min-height:36px;padding:0 12px;border:0;border-radius:8px;background:var(--brand);color:#fff;font:800 11px inherit;cursor:pointer}.company-filter-actions a,.clear-company-filters{color:var(--brand);font-size:11px;font-weight:800}.active-company-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 15px}.active-company-filters>a:not(.clear-company-filters){display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid #cfc4fa;border-radius:99px;background:var(--brand-soft);color:var(--brand);font-size:10px;font-weight:800;text-decoration:none}.company-results-heading{display:flex;justify-content:space-between;gap:12px;margin-bottom:2px;color:var(--ink3);font-size:11px}.company-results-heading strong{color:var(--ink)}.company-page-numbers{display:inline-flex;gap:6px;margin:0 7px}.company-page-numbers .ellipsis{border:0!important}.company-page-numbers .active{background:var(--brand);border-color:var(--brand);color:#fff}.company-error h1{margin:0 0 7px;font:800 18px 'Plus Jakarta Sans',sans-serif;color:var(--ink)}.company-error p{margin:0 0 14px;font-size:13px}.company-directory-page .company-empty-state{margin-top:10px}.company-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:16px;align-items:start}.company-detail-aside{position:sticky;top:74px;display:grid;gap:0}.company-section-heading{display:flex;justify-content:space-between;gap:12px}.company-section-subtitle{margin:3px 0 13px;color:var(--ink3);font-size:11px}.company-job-filter{display:grid;grid-template-columns:minmax(150px,1.4fr) repeat(2,minmax(115px,1fr)) repeat(2,minmax(105px,1fr)) auto;gap:7px;align-items:end;margin:0 0 17px;padding:12px;border:1px solid var(--border);border-radius:11px;background:var(--surface2)}.company-job-filter label{display:grid;gap:5px;min-width:0}.company-job-filter label span{color:var(--ink3);font-size:9px;font-weight:800;letter-spacing:.35px;text-transform:uppercase}.company-job-filter input,.company-job-filter select{width:100%;min-height:34px;padding:0 8px;border:1px solid var(--border2);border-radius:7px;background:var(--surface);color:var(--ink);font:inherit;font-size:10px;outline:none}.company-job-filter input:focus,.company-job-filter select:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}.company-job-filter .company-primary-btn{min-height:34px;white-space:nowrap;padding:0 10px}.company-clear-link{align-self:center;color:var(--brand);font-size:10px;font-weight:800}.company-aside-facts{display:grid;gap:11px;margin:0}.company-aside-facts span{align-items:flex-start}.company-page-numbers .ellipsis{border:0!important;min-width:20px;padding:0}.company-page-numbers{align-items:center}
@media(max-width:900px){.company-filter-layout{grid-template-columns:minmax(0,1fr) auto}.company-search-btn{width:auto}.company-filter-toggle{display:inline-flex;align-items:center;justify-content:center}.company-filter-panel{display:none;grid-column:1/-1}.company-filter-panel.open{display:flex}}
@media(max-width:620px){.company-cover{height:124px}.company-directory-heading{align-items:flex-start;flex-direction:column;gap:8px}.company-directory-count{justify-items:start}.company-filter-layout{grid-template-columns:minmax(0,1fr) auto}.company-filter-panel{align-items:stretch;flex-direction:column}.company-filter-panel label{min-width:0}.company-filter-actions{margin-left:0}.company-filter-panel.open{display:flex}.company-search-btn{padding-left:10px;padding-right:10px}.company-results-heading{font-size:10px}.company-detail-grid{display:block}.company-detail-aside{display:none}.company-job-filter{grid-template-columns:1fr 1fr}.company-job-filter label:first-child{grid-column:1/-1}.company-job-filter .company-primary-btn{width:100%}.company-clear-link{text-align:center}.company-profile-body{padding:0 15px 17px;margin-top:-28px}.company-profile-head{gap:11px}.company-profile-logo{width:66px;height:66px;flex-basis:66px;border-width:3px}.company-profile-name{font-size:20px}.company-profile-facts{gap:8px 12px;font-size:10.5px}.company-profile-actions .company-primary-btn{width:100%;justify-content:center}.company-section{padding:15px}.company-tabs{gap:18px;margin-left:-1px;margin-right:-1px}}
</style>`;

export async function renderCompaniesIndex(env, base, user = null, filters = {}) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const q = String(filters.q || '').trim().slice(0, 100);
  const country = String(filters.country || '').trim().slice(0, 100);
  const industry = String(filters.industry || '').trim().slice(0, 100);
  const company_size = String(filters.company_size || '').trim().slice(0, 40);
  const verifiedOnly = String(filters.verified || '') === '1';
  const requestedPage = Math.max(1, Math.min(500, parseInt(filters.page || '1', 10) || 1));
  const pageSize = 18;
  const anyFilterActive = Boolean(q || country || industry || company_size || verifiedOnly);
  const filterValues = { q, country, industry, company_size, verified: verifiedOnly ? '1' : '' };
  const queryForPage = nextPage => {
    const params = new URLSearchParams();
    Object.entries(filterValues).forEach(([key, value]) => { if (value) params.set(key, value); });
    if (nextPage > 1) params.set('page', String(nextPage));
    const qs = params.toString();
    return `/companies${qs ? `?${qs}` : ''}`;
  };

  let realCompanies = [], realTotal = 0, industries = [], countries = [], legacyCompanies = [];
  try {
    [realCompanies, realTotal, industries, countries, legacyCompanies] = await Promise.all([
      listPublicCompanies(env, { q, country, industry, company_size, verifiedOnly, limit: 2000 }),
      countPublicCompanies(env, { q, country, industry, company_size, verifiedOnly }),
      listDistinctIndustries(env),
      listDistinctCompanyCountries(env),
      anyFilterActive ? Promise.resolve([]) : listCompanies(env, { limit: 2000 }),
    ]);
  } catch (e) {
    const retry = `/companies${new URLSearchParams(Object.entries(filterValues).filter(([, value]) => value)).toString() ? '?' + new URLSearchParams(Object.entries(filterValues).filter(([, value]) => value)).toString() : ''}`;
    const errorContent = `<div class="page company-directory-page"><div class="breadcrumb"><a href="/">Home</a><span>›</span><strong>Companies</strong></div>${COMPANY_PAGE_CSS}${companyCardStyles()}<div class="company-error"><h1>Unable to load company information</h1><p>We couldn't load the company directory right now. Please try again.</p><a class="company-primary-btn" href="${retry}">Try again ${iconArrowRight({ size: 14 })}</a></div></div>`;
    return baseLayout(`Companies — ${settings.site_name}`, `Browse companies hiring remotely on ${settings.site_name}.`, `${base}/companies`, '', errorContent, '', 'noindex, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
  }

  const realSlugs = new Set(realCompanies.map(company => company.slug));
  const legacyFiltered = legacyCompanies.filter(company => !realSlugs.has(company.slug) && (!q || String(company.name || '').toLowerCase().includes(q.toLowerCase())));
  const combined = [...realCompanies.map(company => ({ ...company, profile: true })), ...legacyFiltered.map(company => ({ ...company, profile: false }))];
  const totalShown = anyFilterActive ? realTotal : combined.length;
  const totalPages = Math.max(1, Math.ceil(totalShown / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const pageCompanies = combined.slice((page - 1) * pageSize, page * pageSize);
  const logoOverrides = await getLogoOverrides(env, pageCompanies.map(company => company.name));
  const companyCards = pageCompanies.map(company => companyCardHtml(company, { logoOverride: logoOverrides[(company.name || '').toLowerCase()] || null })).join('');
  const filterQuery = params => {
    const query = new URLSearchParams();
    Object.entries({ ...filterValues, ...params }).forEach(([key, value]) => { if (value) query.set(key, value); });
    const qs = query.toString();
    return `/companies${qs ? `?${qs}` : ''}`;
  };
  const activeFilters = [
    q && ['q', `“${q}”`], country && ['country', country], industry && ['industry', industry], company_size && ['company_size', `${company_size} employees`], verifiedOnly && ['verified', 'Verified only'],
  ].filter(Boolean);
  const chipUrl = key => filterQuery({ [key]: '' });
  const filterOption = (value, label, current) => `<option value="${escapeHtml(value)}"${current === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const pageNumbers = [];
  if (totalPages <= 7) for (let n = 1; n <= totalPages; n++) pageNumbers.push(n);
  else { pageNumbers.push(1); if (page > 4) pageNumbers.push('…'); for (let n = Math.max(2, page - 1); n <= Math.min(totalPages - 1, page + 1); n++) pageNumbers.push(n); if (page < totalPages - 3) pageNumbers.push('…'); pageNumbers.push(totalPages); }
  const pagination = totalPages > 1 ? `<nav class="company-pagination" aria-label="Companies pagination">${page > 1 ? `<a href="${queryForPage(page - 1)}">← Previous</a>` : '<span class="disabled">← Previous</span>'}<span class="company-page-numbers">${pageNumbers.map(number => number === '…' ? '<span class="ellipsis">…</span>' : `<a class="${number === page ? 'active' : ''}"${number === page ? ' aria-current="page"' : ''} href="${queryForPage(number)}">${number}</a>`).join('')}</span>${page < totalPages ? `<a href="${queryForPage(page + 1)}">Next →</a>` : '<span class="disabled">Next →</span>'}</nav>` : '';
  const filterForm = `<form method="GET" action="/companies" class="company-filter-layout" role="search">
    <label class="company-search-field"><span>Search company name</span><input type="search" name="q" value="${escapeHtml(q)}" placeholder="e.g. Acme or Shopify"></label>
    <button class="company-primary-btn company-search-btn" type="submit">Search companies ${iconArrowRight({ size: 14 })}</button>
    <button type="button" class="company-filter-toggle" aria-expanded="false" aria-controls="companyFilterPanel" onclick="var p=document.getElementById('companyFilterPanel');var open=p.classList.toggle('open');this.setAttribute('aria-expanded',open);this.innerHTML=(open?'Hide':'Show')+' filters';">Show filters</button>
    <div id="companyFilterPanel" class="company-filter-panel">
      <div class="company-filter-panel-title">Filter companies</div>
      <label><span>Country</span><select name="country"><option value="">All countries</option>${countries.map(value => filterOption(value, value, country)).join('')}</select></label>
      <label><span>Industry</span><select name="industry"><option value="">All industries</option>${industries.map(value => filterOption(value, value, industry)).join('')}</select></label>
      <label><span>Company size</span><select name="company_size"><option value="">Any size</option>${['1-10', '11-50', '51-200', '201-1000', '1000+'].map(value => filterOption(value, `${value} employees`, company_size)).join('')}</select></label>
      <label class="company-checkbox"><input type="checkbox" name="verified" value="1"${verifiedOnly ? ' checked' : ''}><span>Verified companies only</span></label>
      <div class="company-filter-actions"><button type="submit">Apply filters</button>${anyFilterActive ? `<a href="/companies">Clear filters</a>` : ''}</div>
    </div>
  </form>`;
  const filterChips = activeFilters.length ? `<div class="active-company-filters" aria-label="Active filters">${activeFilters.map(([key, label]) => `<a href="${chipUrl(key)}">${escapeHtml(label)} <span aria-hidden="true">×</span><span class="sr-only">Remove ${escapeHtml(label)}</span></a>`).join('')}<a class="clear-company-filters" href="/companies">Clear filters</a></div>` : '';
  const empty = companyEmptyState(anyFilterActive ? 'No companies found' : 'No companies available', anyFilterActive ? 'Try changing your search or clearing a filter.' : 'Check back when more companies create public profiles.');
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Companies', path: '/companies' }]);
  const content = `<div class="page company-directory-page">${bc}${COMPANY_PAGE_CSS}${companyCardStyles()}
    <div class="company-directory-heading"><div><p class="eyebrow">COMPANIES</p><h1>Discover companies hiring remotely</h1><p>Explore real company profiles and the teams behind remote opportunities.</p></div><div class="company-directory-count"><strong>${totalShown.toLocaleString()}</strong><span>public company profiles</span></div></div>
    ${filterForm}${filterChips}
    <div class="company-results-heading"><span><strong>${totalShown.toLocaleString()}</strong> result${totalShown === 1 ? '' : 's'}</span>${totalPages > 1 ? `<span>Page ${page} of ${totalPages}</span>` : ''}</div>
    ${companyCards ? `<div class="company-grid">${companyCards}</div>` : empty}${pagination}
  </div>`;
  const schema = ldJsonTag(collectionPageSchema(`Companies Hiring Remotely — ${settings.site_name}`, 'Discover public company profiles and remote job opportunities.', `${base}/companies`));
  const robots = anyFilterActive || page > 1 ? 'noindex, follow' : 'index, follow';
  return baseLayout(`Discover Companies Hiring Remotely — ${settings.site_name}`, `Explore ${totalShown.toLocaleString()} public company profiles and remote opportunities on ${settings.site_name}.`, `${base}/companies`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

export async function renderCompanyDetail(env, base, slug, user = null, filters = {}) {
  const { settings, categories, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const realCompany = await getPublicCompanyBySlug(env, slug);
  const company = realCompany || await findCompanyBySlug(env, slug);
  if (!company) return null;
  const detailCompany = realCompany ? company : { ...company, id: -1, slug, profile: false };
  return renderRealCompanyDetail(env, base, detailCompany, { settings, categories, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons, user }, filters);
}

// The professional profile for a real, account-owning company (plan §4):
// cover image, logo, verified badge, industry/size/founding/HQ facts,
// social links, and every job linked to it (company_id match OR legacy
// name match — see COMPANY_JOB_MATCH_SQL in lib/companies.js).
async function renderRealCompanyDetail(env, base, company, ctx, filters = {}) {
  const { settings, categories, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons, user } = ctx;
  const safeName = escapeHtml(company.name);
  const allowedRemote = new Set(['fully_remote', 'hybrid', 'on_site']);
  const allowedEmployment = new Set(['full_time', 'part_time', 'contract', 'internship']);
  const remote_type = allowedRemote.has(filters.remote_type) ? filters.remote_type : '';
  const employment_type = allowedEmployment.has(filters.employment_type) ? filters.employment_type : '';
  const category = String(filters.category || '').trim().slice(0, 60);
  const seniority = String(filters.seniority || '').trim().slice(0, 40);
  const country = String(filters.country || '').trim().slice(0, 100);
  const q = String(filters.q || '').trim().slice(0, 100);
  const requestedPage = Math.max(1, Math.min(500, parseInt(filters.page || '1', 10) || 1));
  const pageSize = 12;
  const jobFilters = { remote_type, employment_type, category, seniority, country, q };
  let jobs = [], jobTotal = 0;
  try {
    [jobs, jobTotal] = await Promise.all([
      jobsForCompanyEntity(env, company, { ...jobFilters, limit: pageSize, offset: (requestedPage - 1) * pageSize }),
      countJobsForCompanyEntity(env, company, jobFilters),
    ]);
  } catch (e) {
    jobs = []; jobTotal = 0;
  }
  const totalPages = Math.max(1, Math.ceil(jobTotal / pageSize));
  const page = Math.min(requestedPage, totalPages);
  if (page !== requestedPage) {
    jobs = await jobsForCompanyEntity(env, company, { ...jobFilters, limit: pageSize, offset: (page - 1) * pageSize });
  }
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Companies', path: '/companies' }, { name: company.name, path: `/companies/${company.slug}` }]);
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, companyEmptyState('No open positions', 'This company does not have active jobs matching these filters.'));
  const logoOverrides = await getLogoOverrides(env, [company.name]);
  const logoUrl = companyLogoUrl(company, logoOverrides[(company.name || '').toLowerCase()] || null);
  const location = company.headquarters || [company.city, company.country].filter(Boolean).join(', ');
  const factsHtml = companyFactsHtml(company, jobTotal);
  const socialHtml = companySocialLinksHtml(company);
  const hasAbout = Boolean(company.description);
  const filterValues = { q, remote_type, employment_type, category, seniority, country };
  const queryForPage = nextPage => { const params = new URLSearchParams(); Object.entries(filterValues).forEach(([key, value]) => { if (value) params.set(key, value); }); if (nextPage > 1) params.set('page', String(nextPage)); const qs = params.toString(); return `/companies/${encodeURIComponent(company.slug)}${qs ? `?${qs}` : ''}`; };
  const filterOption = (value, label, current) => `<option value="${escapeHtml(value)}"${current === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const jobFilterForm = `<form method="GET" action="/companies/${escapeHtml(company.slug)}" class="company-job-filter" role="search"><label><span>Search jobs</span><input type="search" name="q" value="${escapeHtml(q)}" placeholder="Title or skill"></label><label><span>Remote type</span><select name="remote_type"><option value="">Any remote type</option>${filterOption('fully_remote', 'Fully remote', remote_type)}${filterOption('hybrid', 'Hybrid', remote_type)}${filterOption('on_site', 'On-site', remote_type)}</select></label><label><span>Employment</span><select name="employment_type"><option value="">Any employment</option>${filterOption('full_time', 'Full-time', employment_type)}${filterOption('part_time', 'Part-time', employment_type)}${filterOption('contract', 'Contract', employment_type)}${filterOption('internship', 'Internship', employment_type)}</select></label><label><span>Category</span><select name="category"><option value="">All categories</option>${(categories || []).map(item => filterOption(item.key, item.label, category)).join('')}</select></label><label><span>Experience</span><select name="seniority"><option value="">Any level</option>${filterOption('junior', 'Junior', seniority)}${filterOption('mid', 'Mid-level', seniority)}${filterOption('senior', 'Senior', seniority)}${filterOption('lead', 'Lead', seniority)}</select></label><button type="submit" class="company-primary-btn">Apply filters</button>${Object.values(filterValues).some(Boolean) ? '<a href="' + `/companies/${escapeHtml(company.slug)}` + '" class="company-clear-link">Clear</a>' : ''}</form>`;
  const pageNumbers = []; if (totalPages <= 7) for (let n = 1; n <= totalPages; n++) pageNumbers.push(n); else { pageNumbers.push(1); if (page > 4) pageNumbers.push('…'); for (let n = Math.max(2, page - 1); n <= Math.min(totalPages - 1, page + 1); n++) pageNumbers.push(n); if (page < totalPages - 3) pageNumbers.push('…'); pageNumbers.push(totalPages); }
  const pagination = totalPages > 1 ? `<nav class="company-pagination" aria-label="Open positions pagination">${page > 1 ? `<a href="${queryForPage(page - 1)}">← Previous</a>` : '<span class="disabled">← Previous</span>'}<span class="company-page-numbers">${pageNumbers.map(number => number === '…' ? '<span class="ellipsis">…</span>' : `<a class="${number === page ? 'active' : ''}"${number === page ? ' aria-current="page"' : ''} href="${queryForPage(number)}">${number}</a>`).join('')}</span>${page < totalPages ? `<a href="${queryForPage(page + 1)}">Next →</a>` : '<span class="disabled">Next →</span>'}</nav>` : '';
  const content = `<div class="page company-profile-shell">${bc}${COMPANY_PAGE_CSS}
    <section class="company-profile-hero">${companyCoverHtml(company)}<div class="company-profile-body"><div class="company-profile-head">${logoImgHtml(company.name, '82px', 'company-profile-logo', logoUrl)}<div class="company-profile-name-row"><h1 class="company-profile-name">${safeName}</h1>${company.verified ? '<span class="company-verified" title="Verified Company" aria-label="Verified Company">' + iconBadgeCheck({ size: 16 }) + '</span>' : ''}</div></div>${factsHtml ? `<div class="company-profile-facts">${factsHtml}</div>` : ''}<div class="company-profile-actions"><a class="company-primary-btn" href="#open-positions">View open jobs ${iconArrowRight({ size: 14 })}</a>${socialHtml}</div></div></section>
    <nav class="company-tabs" aria-label="Company sections">${hasAbout ? '<a class="active" href="#about">About</a>' : ''}<a class="${hasAbout ? '' : 'active'}" href="#open-positions">Open jobs</a></nav>
    <div class="company-detail-grid"><main>${hasAbout ? `<section id="about" class="company-section"><h2 class="company-section-title">About ${safeName}</h2><div class="company-about">${escapeHtml(company.description)}</div></section>` : ''}<section id="open-positions" class="company-section"><div class="company-section-heading"><div><h2 class="company-section-title">Open positions</h2><p class="company-section-subtitle">${jobTotal.toLocaleString()} active position${jobTotal === 1 ? '' : 's'} at ${safeName}</p></div></div>${jobFilterForm}${jobsHtml}${pagination}</section></main><aside class="company-detail-aside">${factsHtml ? `<div class="company-section"><h2 class="company-section-title">Company details</h2><div class="company-profile-facts company-aside-facts">${factsHtml}</div></div>` : ''}</aside></div>
  </div>`;
  const desc = truncateDescription(company.description || `${company.name} has ${jobTotal} open job${jobTotal === 1 ? '' : 's'} on ${settings.site_name}.${company.industry ? ` ${company.industry} company` : ''}${location ? ` based in ${location}` : ''}.`);
  const sameAs = [safeExternalUrl(company.website), safeExternalUrl(company.linkedin_url), safeExternalUrl(company.twitter_url), safeExternalUrl(company.facebook_url)].filter(Boolean);
  const schema = ldJsonTag({ '@context': 'https://schema.org', '@type': 'Organization', name: company.name, url: `${base}/companies/${company.slug}`, ...(logoUrl ? { logo: logoUrl.startsWith('http') ? logoUrl : `${base}${logoUrl}` } : {}), ...(company.description ? { description: company.description } : {}), ...(sameAs.length ? { sameAs } : {}), ...(company.founded_year ? { foundingDate: String(company.founded_year) } : {}), ...(location ? { address: { '@type': 'PostalAddress', addressLocality: location } } : {}) });
  const robots = jobTotal >= MIN_JOBS_FOR_INDEXING && !Object.values(filterValues).some(Boolean) && page === 1 ? 'index, follow' : 'noindex, follow';
  return baseLayout(`${company.verified ? '✓ ' : ''}${company.name} — Remote Jobs — ${settings.site_name}`, desc, `${base}/companies/${company.slug}`, logoUrl, content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
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
  const cards = countries.map(country => publicCard({ href: `/countries/${encodeURIComponent(country.slug)}`, icon: countryFlag(country.name), title: country.name, description: 'Explore active remote opportunities in this location.', meta: 'Open roles', count: country.count })).join('');
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'BROWSE LOCATIONS', title: 'Discover remote jobs around the world', description: `${countries.length} countries and regions represented by active listings in the current JobForion data.` })}<section class="public-card-grid" aria-label="Countries and regions">${cards || `<div class="empty"><div class="e-icon">📭</div><h3>No locations available</h3><p>Locations will appear after the next job sync.</p></div>`}</section></div>`;
  const schema = ldJsonTag(collectionPageSchema(`Countries — ${settings.site_name}`, 'Browse remote jobs by country or region.', `${base}/countries`));
  return baseLayout(`Browse Remote Jobs by Country — ${settings.site_name}`, `Explore the ${countries.length} countries and regions represented in current remote listings on ${settings.site_name}.`, `${base}/countries`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

export async function renderCountryDetail(env, base, slug, user = null, filters = {}) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const country = await findCountryBySlug(env, slug);
  if (!country) return null;
  const pageSize = 20;
  const requestedPage = Math.max(1, Math.min(500, parseInt(filters.page || '1', 10) || 1));
  const rawNames = country.rawNames || country.name;
  const total = await countJobsByRegion(env, rawNames);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const jobs = await jobsByRegion(env, rawNames, { limit: pageSize, offset: (page - 1) * pageSize });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Countries', path: '/countries' }, { name: country.name, path: `/countries/${slug}` }]);
  const safeName = escapeHtml(country.name);
  const flag = countryFlag(country.name);
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">📭</div><h3>No open jobs in this location yet</h3><p>Browse the full Jobs directory to explore other active roles.</p><a class="public-primary-link" href="/jobs?country=${encodeURIComponent(country.name)}">Browse all jobs →</a></div>`);
  const pageLink = n => `/countries/${encodeURIComponent(slug)}${n > 1 ? `?page=${n}` : ''}`;
  const pagination = totalPages > 1 ? `<nav class="jobs-directory-pagination" aria-label="Location jobs pagination">${page > 1 ? `<a class="page-btn" href="${pageLink(page - 1)}">← Previous</a>` : '<span class="page-btn disabled">← Previous</span>'}<span class="page-number-list">${Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.min(totalPages, page + 2)).map(n => `<a class="page-number${n === page ? ' active' : ''}"${n === page ? ' aria-current="page"' : ''} href="${pageLink(n)}">${n}</a>`).join('')}</span>${page < totalPages ? `<a class="page-btn" href="${pageLink(page + 1)}">Next →</a>` : '<span class="page-btn disabled">Next →</span>'}</nav>` : '';
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'LOCATION JOBS', title: `${flag} Remote jobs in ${country.name}`, description: `${total.toLocaleString()} active opportunities located in or hiring from this region.` })}<div class="public-callout"><div><h2>Refine by more signals</h2><p>Use the shared Jobs search to combine this location with role, salary, employment, and remote filters.</p></div><a class="public-primary-link" href="/jobs?country=${encodeURIComponent(country.name)}">Open job filters →</a></div><section class="public-section" aria-labelledby="location-open-jobs"><div class="public-section-heading"><div><h2 id="location-open-jobs">Latest roles in ${safeName}</h2><p>${total.toLocaleString()} active listing${total === 1 ? '' : 's'} from the current backend.</p></div></div>${jobsHtml}${pagination}</section></div>`;
  const desc = truncateDescription(`Browse ${total} remote jobs in ${country.name} on ${settings.site_name}. Filter the full directory by role, salary, and employment type.`);
  const schema = ldJsonTag(itemListSchema(jobs.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  const robots = total >= MIN_JOBS_FOR_INDEXING && page === 1 ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote Jobs in ${country.name} — ${settings.site_name}`, desc, `${base}/countries/${slug}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

// ── /skills ──
export async function renderSkillsIndex(env, base, user = null) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const skills = await listSkills(env, { limit: 200 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Skills', path: '/skills' }]);
  const cards = skills.map(skill => publicCard({ href: `/skills/${encodeURIComponent(skill.slug)}`, icon: iconSearch({ size: 18 }), title: skill.name, description: 'Find current roles that mention this skill.', meta: 'Related jobs', count: skill.count })).join('');
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'BROWSE BY SKILL', title: 'Find opportunities by skill', description: 'Explore skills found in live job listings and follow each one to its related opportunities.' })}<section class="public-card-grid" aria-label="Skills">${cards || `<div class="empty"><div class="e-icon">📭</div><h3>No skills available</h3><p>Skills will appear after jobs with structured skill data are synced.</p></div>`}</section></div>`;
  const schema = ldJsonTag(collectionPageSchema(`Skills — ${settings.site_name}`, 'Browse remote jobs by required skill.', `${base}/skills`));
  return baseLayout(`Browse Remote Jobs by Skill — ${settings.site_name}`, `Explore skills found in current remote job listings on ${settings.site_name}.`, `${base}/skills`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

export async function renderSkillDetail(env, base, slug, user = null, filters = {}) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const skill = await findSkillBySlug(env, slug);
  if (!skill) return null;
  const pageSize = 20;
  const requestedPage = Math.max(1, Math.min(500, parseInt(filters.page || '1', 10) || 1));
  const rawNames = skill.rawNames || skill.name;
  const total = await countJobsBySkill(env, rawNames);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const jobs = await jobsBySkill(env, rawNames, { limit: pageSize, offset: (page - 1) * pageSize });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Skills', path: '/skills' }, { name: skill.name, path: `/skills/${slug}` }]);
  const safeName = escapeHtml(skill.name);
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">📭</div><h3>No jobs currently require this skill</h3><p>Browse the full Jobs directory to explore other active roles.</p><a class="public-primary-link" href="/jobs?skill=${encodeURIComponent(skill.name)}">Browse all jobs →</a></div>`);
  const pageLink = n => `/skills/${encodeURIComponent(slug)}${n > 1 ? `?page=${n}` : ''}`;
  const pagination = totalPages > 1 ? `<nav class="jobs-directory-pagination" aria-label="Skill jobs pagination">${page > 1 ? `<a class="page-btn" href="${pageLink(page - 1)}">← Previous</a>` : '<span class="page-btn disabled">← Previous</span>'}<span class="page-number-list">${Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.min(totalPages, page + 2)).map(n => `<a class="page-number${n === page ? ' active' : ''}"${n === page ? ' aria-current="page"' : ''} href="${pageLink(n)}">${n}</a>`).join('')}</span>${page < totalPages ? `<a class="page-btn" href="${pageLink(page + 1)}">Next →</a>` : '<span class="page-btn disabled">Next →</span>'}</nav>` : '';
  const relatedCategories = categoryOrder.slice(0, 4).map(key => publicCard({ href: `/categories/${encodeURIComponent(key)}`, icon: categoryMap[key]?.emoji || '•', title: categoryMap[key]?.label || key, meta: 'Explore category' })).join('');
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'SKILL JOBS', title: `Remote jobs requiring ${skill.name}`, description: `${total.toLocaleString()} active positions currently mention this skill.` })}<div class="public-callout"><div><h2>Search beyond this skill</h2><p>Combine skill, role, location, salary, and remote filters in the shared Jobs directory.</p></div><a class="public-primary-link" href="/jobs?skill=${encodeURIComponent(skill.name)}">Open job filters →</a></div><section class="public-section" aria-labelledby="skill-open-jobs"><div class="public-section-heading"><div><h2 id="skill-open-jobs">Latest ${safeName} roles</h2><p>${total.toLocaleString()} active listing${total === 1 ? '' : 's'} from the current backend.</p></div></div>${jobsHtml}${pagination}</section><section class="public-section" aria-labelledby="related-skill-categories"><div class="public-section-heading"><h2 id="related-skill-categories">Explore categories</h2></div><div class="public-card-grid">${relatedCategories}</div></section></div>`;
  const desc = truncateDescription(`Browse ${total} remote jobs requiring ${skill.name} on ${settings.site_name}. Explore current opportunities and refine the full directory.`);
  const schema = ldJsonTag(itemListSchema(jobs.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  const robots = total >= MIN_JOBS_FOR_INDEXING && page === 1 ? 'index, follow' : 'noindex, follow';
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
