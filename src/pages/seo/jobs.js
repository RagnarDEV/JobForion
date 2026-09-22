// src/pages/seo/jobs.js
// /jobs (filterable listing) and /remote-jobs landing.

import { getSiteStats, readSiteCache } from '../../lib/platform/site-cache.js';
import { windowedJobs, cappedCount } from '../../lib/platform/job-window.js';
import { baseLayout } from '../../layout/base-layout.js';
import { escapeHtml, MIN_JOBS_FOR_INDEXING } from '../../lib/directory/entities.js';
import { collectionPageSchema, ldJsonTag } from '../../lib/seo/jsonld.js';
import { buildBreadcrumb } from '../../lib/seo/breadcrumbs.js';
import { keywordCondition, normalizeSearchTerm } from '../../lib/platform/search-utils.js';
import { JOB_MANUAL_PIN_SORT_SQL, PUBLIC_JOB_STATUS_SQL, JOB_LISTING_COLUMNS, JOB_SORT_OPTIONS } from '../../config/constants.js';
import { resolveRawNames } from '../../lib/directory/directory-overrides.js';
import { iconBuilding, iconFileText, iconGlobe, iconInbox, iconSearch } from '../../assets/icons.js';
import { PUBLIC_PAGE_CSS, publicPageHeader, publicCard } from '../../components/public-page.js';
import { loadPageContext, jobsListHtml } from './shared.js';

// ── /jobs — complete jobs directory ─────────────────────────────
// Homepage keeps one clear CTA and no visible pagination. This directory
// owns the full server-side job discovery experience and mirrors the same
// allow-lists used by /api/jobs, so filters and sorting never drift apart.
export async function renderJobsIndex(env, base, user = null, filters = {}) {
  const { settings, categories, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const q = normalizeSearchTerm(filters.q || filters.search || '');
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
    // Wildcard-escaped keyword match (see lib/platform/search-utils.js).
    const kw = keywordCondition(q);
    conditions.push(kw.sql);
    binds.push(...kw.binds);
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
  // ROW-READ BUDGET (D1 free tier: 5M rows/day, scanned rows count):
  //  • no filters       → index-driven `featured DESC, id DESC` (reads ~20 rows);
  //                       total comes from the precomputed stats row; deep pages capped.
  //  • company only     → company index.
  //  • any other filter → evaluated over the most recent JOBS_FILTER_WINDOW active
  //                       jobs, so cost stays bounded however large the catalogue is.
  const JOBS_FILTER_WINDOW = 2000;
  const onlyCompany = conditions.length === 2 && !!company;
  const unfiltered = conditions.length === 1;
  const fromSql = (unfiltered || onlyCompany) ? 'jobs' : windowedJobs(JOBS_FILTER_WINDOW);
  let countRows, jobs, windowPageRows = null;
  try {
    if (unfiltered) {
      const stats = await getSiteStats(env);
      countRows = [{ c: stats ? Math.min(Number(stats.totalActive || 0), 2000) : await cappedCount(env, 'jobs', PUBLIC_JOB_STATUS_SQL, [], 2000) }];
    } else if (onlyCompany) {
      countRows = [{ c: await cappedCount(env, 'jobs', conditions.join(' AND '), binds, 2000) }];
    } else {
      // ONE pass over the window: rows for the requested page + the total number of
      // matches (COUNT(*) OVER ()) — half the reads of separate COUNT + SELECT queries.
      const { results: pageRows } = await env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS}, COUNT(*) OVER () AS jf_total FROM ${fromSql}${where} ORDER BY ${orderBySql} LIMIT ${pageSize} OFFSET ${(requestedPage - 1) * pageSize}`).bind(...binds, ...orderParams).all();
      countRows = [{ c: pageRows?.[0]?.jf_total || 0 }];
      if (pageRows?.length) windowPageRows = pageRows.map(({ jf_total, ...row }) => row);
    }
  } catch (e) { countRows = [{ c: 0 }]; }
  const total = Number(countRows?.[0]?.c || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  if (windowPageRows && page === requestedPage) jobs = windowPageRows;
  else try {
    ({ results: jobs } = await env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS} FROM ${fromSql}${where} ORDER BY ${orderBySql} LIMIT ${pageSize} OFFSET ${offset}`).bind(...binds, ...orderParams).all());
  } catch (e) { jobs = []; }
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
    ${page > 1 ? `<a class="page-btn" href="${queryForPage(page - 1)}"> Previous</a>` : `<span class="page-btn disabled"> Previous</span>`}
    <div class="page-number-list">${pageNumbers.map(n => n === '…' ? '<span class="page-ellipsis">…</span>' : `<a class="page-number${n === page ? ' active' : ''}"${n === page ? ' aria-current="page"' : ''} href="${queryForPage(n)}">${n}</a>`).join('')}</div>
    ${page < totalPages ? `<a class="page-btn" href="${queryForPage(page + 1)}">Next </a>` : `<span class="page-btn disabled">Next </span>`}
  </nav>` : '';
  const option = (value, label, current) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`;
  const activeFilters = [
    q && ['q', `“${q}”`], category && ['category', category], remoteType && ['remote_type', remoteType.replace(/_/g, ' ')], employmentType && ['employment_type', employmentType.replace(/_/g, ' ')], seniority && ['seniority', seniority], country && ['country', country], skill && ['skill', skill], company && ['company', company], salaryMin && ['salary_min', `Min $${salaryMin}k`], salaryMax && ['salary_max', `Max $${salaryMax}k`], days && ['days', `Last ${days} days`], sourceType && ['source_type', sourceType]
  ].filter(Boolean);
  const chipUrl = key => { const next = { ...canonicalFilters }; delete next[key]; const params = new URLSearchParams(); for (const name of paramNames) if (next[name]) params.set(name, next[name]); const qs = params.toString(); return `/jobs${qs ? `?${qs}` : ''}`; };
  const categoryOptions = (categories || []).map(c => option(c.key, c.label, category)).join('');
  const clearHref = '/jobs';
  const content = `<div class="page jobs-directory-page"><style>
    .jobs-directory-page{max-width:1180px}.jobs-directory-page .breadcrumb{display:flex;align-items:center;gap:8px;margin-bottom:24px;font-size:12px;color:var(--ink3)}.jobs-directory-page .breadcrumb a{color:var(--brand);text-decoration:none}.directory-heading{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-bottom:22px}.directory-heading h1{font-family:var(--font-heading,sans-serif);font-size:clamp(26px,4vw,38px);line-height:1.12;letter-spacing:-1.2px;color:var(--ink);margin:0 0 8px}.directory-heading p{color:var(--ink2);font-size:14px;margin:0}.jobs-search-form{display:grid;grid-template-columns:minmax(240px,1.4fr) minmax(180px,1fr) auto;gap:10px;margin-bottom:12px}.jobs-search-form label{display:grid;gap:6px}.jobs-search-form label span,.jobs-filter-panel label span{font-size:10px;font-weight:800;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px}.jobs-search-form input,.jobs-filter-panel input,.jobs-filter-panel select,.jobs-sort-select{width:100%;min-height:42px;background:var(--surface);border:1px solid var(--border2);border-radius:9px;padding:0 11px;color:var(--ink);font:inherit;font-size:12px;outline:none}.jobs-search-form input:focus,.jobs-filter-panel input:focus,.jobs-filter-panel select:focus,.jobs-sort-select:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}.jobs-search-form .dash-btn{min-height:42px;white-space:nowrap}.jobs-discovery-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:22px;align-items:start}.jobs-filter-panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;box-shadow:var(--shadow);position:sticky;top:74px}.jobs-filter-panel h2{font:800 13px var(--font-heading,sans-serif);margin:0 0 12px;color:var(--ink)}.filter-field{display:grid;gap:6px;margin-top:11px}.filter-field input,.filter-field select{min-height:36px;font-size:11px}.filter-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:15px}.filter-actions button,.filter-actions a{font:800 11px inherit}.filter-actions button{border:0;background:var(--brand);color:#fff;border-radius:8px;padding:8px 11px;cursor:pointer}.filter-actions a{color:var(--brand);text-decoration:none}.mobile-filter-toggle{display:none}.jobs-results-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 12px}.jobs-results-summary{font-size:12px;color:var(--ink2)}.jobs-results-summary strong{color:var(--ink)}.jobs-sort{display:flex;align-items:center;gap:7px;color:var(--ink3);font-size:10px;font-weight:800}.jobs-sort-select{min-height:34px;width:auto;padding:0 28px 0 9px;font-size:11px}.active-filter-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:-2px 0 14px}.active-filter-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #cfc4fa;background:var(--brand-soft);color:var(--brand);border-radius:99px;padding:5px 8px;font-size:10px;font-weight:800;text-decoration:none}.active-filter-chip span{font-size:13px;line-height:1}.clear-filters-link{font-size:10px;color:var(--ink3);font-weight:800;text-decoration:underline;margin-left:3px}.page-number-list{display:flex;align-items:center;gap:5px}.page-number{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:34px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--ink2);text-decoration:none;font-size:11px;font-weight:800}.page-number.active,.page-number:hover{background:var(--brand);border-color:var(--brand);color:#fff}.page-ellipsis{color:var(--ink3);padding:0 2px}.jobs-directory-pagination{display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap;padding:26px 0 8px}.jobs-directory-pagination .page-btn{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 11px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--ink2);text-decoration:none;font-size:11px;font-weight:800}.jobs-directory-pagination .page-btn:hover{border-color:var(--brand);color:var(--brand)}.jobs-directory-pagination .page-btn.disabled{opacity:.45;pointer-events:none}
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
        ${await jobsListHtml(env, jobs || [], categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">${iconSearch({ size: 44 })}</div><h3>No jobs found</h3><p>Try changing your search or removing some filters.</p>${activeFilters.length ? `<a class="dash-btn dash-btn-primary" href="${clearHref}" style="display:inline-flex;margin-top:12px;text-decoration:none">Clear filters</a>` : ''}</div>`)}
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
  const pageSize = 12;
  const requestedPage = Math.max(1, Math.min(500, parseInt(filters.page || '1', 10) || 1));
  let countRows, companyRows, jobs;
  // ROW-READ BUDGET: precomputed remote total + top remote companies (1 row each);
  // the list itself is served from the most recent REMOTE_WINDOW active jobs.
  const REMOTE_WINDOW = 5000;
  try {
    const stats = await getSiteStats(env);
    countRows = [{ c: stats ? Math.min(Number(stats.remote || 0), REMOTE_WINDOW) : await cappedCount(env, windowedJobs(REMOTE_WINDOW), 'remote_type = ?', ['fully_remote'], REMOTE_WINDOW) }];
  } catch (e) { countRows = [{ c: 0 }]; }
  try {
    const cachedCompanies = await readSiteCache(env, 'dir:remote_companies');
    if (cachedCompanies) companyRows = cachedCompanies.slice(0, 6);
    else ({ results: companyRows } = await env.DB.prepare(`SELECT company, COUNT(*) AS c FROM ${windowedJobs(REMOTE_WINDOW)} WHERE remote_type = ? AND company IS NOT NULL AND company != '' GROUP BY company ORDER BY c DESC, company ASC LIMIT 6`).bind('fully_remote').all());
  } catch (e) { companyRows = []; }
  const total = Number(countRows?.[0]?.c || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  try {
    ({ results: jobs } = await env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS} FROM ${windowedJobs(REMOTE_WINDOW)} WHERE remote_type = ? ORDER BY ${JOB_MANUAL_PIN_SORT_SQL} LIMIT ? OFFSET ?`).bind('fully_remote', pageSize, (page - 1) * pageSize).all());
  } catch (e) { jobs = []; }
  const jobsHtml = await jobsListHtml(env, jobs || [], categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">${iconInbox({ size: 44 })}</div><h3>No fully remote jobs available</h3><p>Try the full Jobs directory to explore hybrid and on-site roles as well.</p><a class="public-primary-link" href="/jobs">Browse all jobs </a></div>`);
  const pageLink = n => `/remote-jobs${n > 1 ? `?page=${n}` : ''}`;
  const pagination = totalPages > 1 ? `<nav class="jobs-directory-pagination" aria-label="Remote jobs pagination">${page > 1 ? `<a class="page-btn" href="${pageLink(page - 1)}"> Previous</a>` : '<span class="page-btn disabled"> Previous</span>'}<span class="page-number-list">${Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.min(totalPages, page + 2)).map(n => `<a class="page-number${n === page ? ' active' : ''}"${n === page ? ' aria-current="page"' : ''} href="${pageLink(n)}">${n}</a>`).join('')}</span>${page < totalPages ? `<a class="page-btn" href="${pageLink(page + 1)}">Next </a>` : '<span class="page-btn disabled">Next </span>'}</nav>` : '';
  const categoryCards = (categories || []).slice(0, 6).map(category => publicCard({ href: `/jobs?remote_type=fully_remote&category=${encodeURIComponent(category.key)}`, icon: category.emoji || '•', title: category.label, meta: 'Remote roles' })).join('');
  const companyCards = (companyRows || []).map(row => publicCard({ href: `/jobs?remote_type=fully_remote&company=${encodeURIComponent(row.company)}`, icon: iconBuilding({ size: 18 }), title: row.company, meta: 'Fully remote roles', count: row.c })).join('');
  const resourceCards = [
    publicCard({ href: '/blog', icon: iconFileText({ size: 18 }), title: 'Career blog', description: 'Practical guidance for your remote search.', meta: 'Read resources' }),
    publicCard({ href: '/skills', icon: iconSearch({ size: 18 }), title: 'Browse by skill', description: 'See skills connected to live listings.', meta: 'Explore skills' }),
    publicCard({ href: '/countries', icon: iconGlobe({ size: 18 }), title: 'Browse locations', description: 'Discover where remote teams are hiring.', meta: 'Explore locations' }),
  ].join('');
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Remote Jobs', path: '/remote-jobs' }]);
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'REMOTE-FIRST SEARCH', title: 'Find your next remote opportunity', description: `${total.toLocaleString()} fully remote jobs are available in the current JobForion listings.` , actions: `<a class="public-primary-link" href="/jobs?remote_type=fully_remote">Search all remote jobs </a>` })}<section class="public-section" aria-labelledby="remote-latest"><div class="public-section-heading"><div><h2 id="remote-latest">Latest fully remote jobs</h2><p>Real active listings from the current backend.</p></div><a href="/jobs?remote_type=fully_remote">View all remote jobs </a></div>${jobsHtml}${pagination}</section>${categoryCards ? `<section class="public-section" aria-labelledby="remote-categories"><div class="public-section-heading"><div><h2 id="remote-categories">Popular remote categories</h2><p>Start with a discipline that matches your search.</p></div></div><div class="public-card-grid">${categoryCards}</div></section>` : ''}${companyCards ? `<section class="public-section" aria-labelledby="remote-companies"><div class="public-section-heading"><div><h2 id="remote-companies">Companies hiring remotely</h2><p>Based on active fully remote listings.</p></div></div><div class="public-card-grid">${companyCards}</div></section>` : ''}<section class="public-section" aria-labelledby="remote-resources"><div class="public-section-heading"><div><h2 id="remote-resources">Useful resources</h2><p>Keep your search focused and informed.</p></div></div><div class="public-card-grid resources-grid">${resourceCards}</div></section></div>`;
  const schema = ldJsonTag(collectionPageSchema(`Remote Jobs — ${settings.site_name}`, 'Discover active fully remote opportunities, categories, companies, and career resources.', `${base}/remote-jobs`));
  const robots = total >= MIN_JOBS_FOR_INDEXING && page === 1 ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote Jobs — ${settings.site_name}`, `Find ${total.toLocaleString()} active fully remote opportunities on ${settings.site_name}.`, `${base}/remote-jobs`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}
