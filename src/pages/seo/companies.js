// src/pages/seo/companies.js
// /companies directory and /companies/:slug detail.

import { baseLayout } from '../../layout/base-layout.js';
import { logoImgHtml } from '../../components/job-card.js';
import { companyCardHtml, companyCardStyles, companyEmptyState } from '../../components/company-card.js';
import { logoProxyPath } from '../../lib/companies/logo-proxy.js';
import { listCompanies, findCompanyBySlug, escapeHtml, MIN_JOBS_FOR_INDEXING } from '../../lib/directory/entities.js';
import { collectionPageSchema, ldJsonTag } from '../../lib/seo/jsonld.js';
import { buildBreadcrumb } from '../../lib/seo/breadcrumbs.js';
import { truncateDescription } from '../../lib/seo/meta.js';
import { getLogoOverrides } from '../../lib/companies/company-logos.js';
import { listPublicCompanies, countPublicCompanies, getPublicCompanyBySlug, jobsForCompanyEntity, countJobsForCompanyEntity, listDistinctIndustries, listDistinctCompanyCountries } from '../../lib/companies/companies.js';
import { iconGlobe, iconLink, iconMapPin, iconUsers, iconBuilding, iconBriefcase, iconBadgeCheck } from '../../assets/icons.js';
import { loadPageContext, jobsListHtml } from './shared.js';

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
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return safeExternalUrl(raw);
}

function companyLogoUrl(company, logoOverride = null) {
  return safeImageUrl(logoOverride || company.logo_url || '') || logoProxyPath(company.name, company.website) || '';
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
.company-cover{height:168px;position:relative;overflow:hidden;background:linear-gradient(135deg,#182cbb,#3556ff 55%,#6c3fe0)}.company-cover img{width:100%;height:100%;display:block;object-fit:cover}.company-cover-fallback{width:100%;height:100%;display:grid;place-items:center;background:radial-gradient(circle at 75% 20%,rgba(255,255,255,.2),transparent 32%),linear-gradient(135deg,#182cbb,#3556ff 55%,#6c3fe0)}.company-cover-fallback span{font:800 64px var(--font-heading,sans-serif);color:rgba(255,255,255,.2)}
.company-profile-shell{max-width:1120px}.company-profile-hero{margin-bottom:20px;background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:var(--shadow-card)}.company-profile-body{padding:0 24px 22px;margin-top:-34px;position:relative}.company-profile-head{display:flex;align-items:flex-end;gap:16px;margin-bottom:14px}.company-profile-logo{width:82px;height:82px;border:4px solid var(--surface);border-radius:17px;background:#fff;box-shadow:var(--shadow);flex:0 0 82px}.company-profile-logo img{width:100%;height:100%;object-fit:contain;padding:8px}.company-profile-name-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:7px}.company-profile-name{font:800 25px/1.15 var(--font-heading,sans-serif);color:var(--ink)}.company-verified{color:var(--brand);display:inline-flex}.company-profile-facts{display:flex;flex-wrap:wrap;gap:10px 16px;color:var(--ink2);font-size:12px;margin-bottom:15px}.company-profile-facts span{display:inline-flex;align-items:center;gap:5px}.company-profile-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.company-link-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface2);color:var(--ink2);text-decoration:none;font-size:11px;font-weight:800;transition:all .18s}.company-link-btn:hover{border-color:var(--brand);color:var(--brand)}.company-primary-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:9px;background:var(--brand);color:#fff;text-decoration:none;font-size:11px;font-weight:800;box-shadow:0 6px 16px rgba(99,57,230,.2)}.company-primary-btn:hover{filter:brightness(1.05)}.company-section{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:16px}.company-section-title{margin:0 0 12px;color:var(--ink);font:800 15px var(--font-heading,sans-serif)}.company-about{color:var(--ink2);font-size:13px;line-height:1.75;white-space:pre-line}.company-tabs{display:flex;gap:22px;overflow-x:auto;border-bottom:1px solid var(--border);margin-bottom:16px;scrollbar-width:none}.company-tabs::-webkit-scrollbar{display:none}.company-tabs a{padding:0 0 11px;color:var(--ink3);font-size:12px;font-weight:800;text-decoration:none;white-space:nowrap;position:relative}.company-tabs a.active{color:var(--brand)}.company-tabs a.active:after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--brand)}.company-pagination{display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:20px}.company-pagination a,.company-pagination span{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:34px;padding:0 10px;border:1px solid var(--border2);border-radius:8px;color:var(--ink2);text-decoration:none;font-size:11px;font-weight:800}.company-pagination .active{background:var(--brand);border-color:var(--brand);color:#fff}.company-pagination .disabled{opacity:.45}.company-empty-state{margin:0}.company-error{padding:18px;border:1px solid rgba(220,70,70,.2);background:rgba(220,70,70,.04);border-radius:12px;color:var(--ink2)}
.company-directory-page{max-width:1180px}.company-directory-heading{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:20px}.company-directory-heading h1{margin:0 0 8px;color:var(--ink);font:800 clamp(26px,4vw,38px)/1.12 var(--font-heading,sans-serif);letter-spacing:-1px}.company-directory-heading p{margin:0;color:var(--ink2);font-size:13px}.company-directory-count{display:grid;justify-items:end;gap:3px;color:var(--ink3);font-size:10px;font-weight:800}.company-directory-count strong{color:var(--brand);font:800 28px var(--font-heading,sans-serif)}.company-filter-layout{display:grid;grid-template-columns:minmax(240px,1fr) auto auto;gap:9px;align-items:end;margin-bottom:14px}.company-search-field,.company-filter-panel label{display:grid;gap:6px}.company-search-field>span,.company-filter-panel label>span,.company-filter-panel-title{color:var(--ink3);font-size:10px;font-weight:800;letter-spacing:.45px;text-transform:uppercase}.company-search-field input,.company-filter-panel select{width:100%;min-height:42px;padding:0 11px;border:1px solid var(--border2);border-radius:9px;background:var(--surface);color:var(--ink);font:inherit;font-size:12px;outline:none}.company-search-field input:focus,.company-filter-panel select:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}.company-search-btn{min-height:42px;white-space:nowrap}.company-filter-toggle{display:none;min-height:38px;padding:0 12px;border:1px solid var(--border2);border-radius:9px;background:var(--surface);color:var(--ink2);font:800 11px inherit}.company-filter-panel{grid-column:1/-1;display:flex;align-items:end;gap:10px;flex-wrap:wrap;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface2)}.company-filter-panel label{min-width:160px}.company-filter-panel-title{width:100%;color:var(--ink)}.company-checkbox{display:flex!important;align-items:center;gap:7px;min-height:36px}.company-checkbox input{accent-color:var(--brand)}.company-filter-actions{display:flex;align-items:center;gap:10px;margin-left:auto}.company-filter-actions button{min-height:36px;padding:0 12px;border:0;border-radius:8px;background:var(--brand);color:#fff;font:800 11px inherit;cursor:pointer}.company-filter-actions a,.clear-company-filters{color:var(--brand);font-size:11px;font-weight:800}.active-company-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 15px}.active-company-filters>a:not(.clear-company-filters){display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid #cfc4fa;border-radius:99px;background:var(--brand-soft);color:var(--brand);font-size:10px;font-weight:800;text-decoration:none}.company-results-heading{display:flex;justify-content:space-between;gap:12px;margin-bottom:2px;color:var(--ink3);font-size:11px}.company-results-heading strong{color:var(--ink)}.company-page-numbers{display:inline-flex;gap:6px;margin:0 7px}.company-page-numbers .ellipsis{border:0!important}.company-page-numbers .active{background:var(--brand);border-color:var(--brand);color:#fff}.company-error h1{margin:0 0 7px;font:800 18px var(--font-heading,sans-serif);color:var(--ink)}.company-error p{margin:0 0 14px;font-size:13px}.company-directory-page .company-empty-state{margin-top:10px}.company-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:16px;align-items:start}.company-detail-aside{position:sticky;top:74px;display:grid;gap:0}.company-section-heading{display:flex;justify-content:space-between;gap:12px}.company-section-subtitle{margin:3px 0 13px;color:var(--ink3);font-size:11px}.company-job-filter{display:grid;grid-template-columns:minmax(150px,1.4fr) repeat(2,minmax(115px,1fr)) repeat(2,minmax(105px,1fr)) auto;gap:7px;align-items:end;margin:0 0 17px;padding:12px;border:1px solid var(--border);border-radius:11px;background:var(--surface2)}.company-job-filter label{display:grid;gap:5px;min-width:0}.company-job-filter label span{color:var(--ink3);font-size:9px;font-weight:800;letter-spacing:.35px;text-transform:uppercase}.company-job-filter input,.company-job-filter select{width:100%;min-height:34px;padding:0 8px;border:1px solid var(--border2);border-radius:7px;background:var(--surface);color:var(--ink);font:inherit;font-size:10px;outline:none}.company-job-filter input:focus,.company-job-filter select:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}.company-job-filter .company-primary-btn{min-height:34px;white-space:nowrap;padding:0 10px}.company-clear-link{align-self:center;color:var(--brand);font-size:10px;font-weight:800}.company-aside-facts{display:grid;gap:11px;margin:0}.company-aside-facts span{align-items:flex-start}.company-page-numbers .ellipsis{border:0!important;min-width:20px;padding:0}.company-page-numbers{align-items:center}
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
    const errorContent = `<div class="page company-directory-page"><div class="breadcrumb"><a href="/">Home</a><span>›</span><strong>Companies</strong></div>${COMPANY_PAGE_CSS}${companyCardStyles()}<div class="company-error"><h1>Unable to load company information</h1><p>We couldn't load the company directory right now. Please try again.</p><a class="company-primary-btn" href="${retry}">Try again</a></div></div>`;
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
  const pagination = totalPages > 1 ? `<nav class="company-pagination" aria-label="Companies pagination">${page > 1 ? `<a href="${queryForPage(page - 1)}"> Previous</a>` : '<span class="disabled"> Previous</span>'}<span class="company-page-numbers">${pageNumbers.map(number => number === '…' ? '<span class="ellipsis">…</span>' : `<a class="${number === page ? 'active' : ''}"${number === page ? ' aria-current="page"' : ''} href="${queryForPage(number)}">${number}</a>`).join('')}</span>${page < totalPages ? `<a href="${queryForPage(page + 1)}">Next </a>` : '<span class="disabled">Next </span>'}</nav>` : '';
  const filterForm = `<form method="GET" action="/companies" class="company-filter-layout" role="search">
    <label class="company-search-field"><span>Search company name</span><input type="search" name="q" value="${escapeHtml(q)}" placeholder="e.g. Acme or Shopify"></label>
    <button class="company-primary-btn company-search-btn" type="submit">Search companies</button>
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
// name match — see COMPANY_JOB_MATCH_SQL in lib/companies/companies.js).
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
  const pagination = totalPages > 1 ? `<nav class="company-pagination" aria-label="Open positions pagination">${page > 1 ? `<a href="${queryForPage(page - 1)}"> Previous</a>` : '<span class="disabled"> Previous</span>'}<span class="company-page-numbers">${pageNumbers.map(number => number === '…' ? '<span class="ellipsis">…</span>' : `<a class="${number === page ? 'active' : ''}"${number === page ? ' aria-current="page"' : ''} href="${queryForPage(number)}">${number}</a>`).join('')}</span>${page < totalPages ? `<a href="${queryForPage(page + 1)}">Next </a>` : '<span class="disabled">Next </span>'}</nav>` : '';
  const content = `<div class="page company-profile-shell">${bc}${COMPANY_PAGE_CSS}
    <section class="company-profile-hero">${companyCoverHtml(company)}<div class="company-profile-body"><div class="company-profile-head">${logoImgHtml(company.name, '82px', 'company-profile-logo', logoUrl)}<div class="company-profile-name-row"><h1 class="company-profile-name">${safeName}</h1>${company.verified ? '<span class="company-verified" title="Verified Company" aria-label="Verified Company">' + iconBadgeCheck({ size: 16 }) + '</span>' : ''}</div></div>${factsHtml ? `<div class="company-profile-facts">${factsHtml}</div>` : ''}<div class="company-profile-actions"><a class="company-primary-btn" href="#open-positions">View open jobs</a>${socialHtml}</div></div></section>
    <nav class="company-tabs" aria-label="Company sections">${hasAbout ? '<a class="active" href="#about">About</a>' : ''}<a class="${hasAbout ? '' : 'active'}" href="#open-positions">Open jobs</a></nav>
    <div class="company-detail-grid"><main>${hasAbout ? `<section id="about" class="company-section"><h2 class="company-section-title">About ${safeName}</h2><div class="company-about">${escapeHtml(company.description)}</div></section>` : ''}<section id="open-positions" class="company-section"><div class="company-section-heading"><div><h2 class="company-section-title">Open positions</h2><p class="company-section-subtitle">${jobTotal.toLocaleString()} active position${jobTotal === 1 ? '' : 's'} at ${safeName}</p></div></div>${jobFilterForm}${jobsHtml}${pagination}</section></main><aside class="company-detail-aside">${factsHtml ? `<div class="company-section"><h2 class="company-section-title">Company details</h2><div class="company-profile-facts company-aside-facts">${factsHtml}</div></div>` : ''}</aside></div>
  </div>`;
  const desc = truncateDescription(company.description || `${company.name} has ${jobTotal} open job${jobTotal === 1 ? '' : 's'} on ${settings.site_name}.${company.industry ? ` ${company.industry} company` : ''}${location ? ` based in ${location}` : ''}.`);
  const sameAs = [safeExternalUrl(company.website), safeExternalUrl(company.linkedin_url), safeExternalUrl(company.twitter_url), safeExternalUrl(company.facebook_url)].filter(Boolean);
  const schema = ldJsonTag({ '@context': 'https://schema.org', '@type': 'Organization', name: company.name, url: `${base}/companies/${company.slug}`, ...(logoUrl ? { logo: logoUrl.startsWith('http') ? logoUrl : `${base}${logoUrl}` } : {}), ...(company.description ? { description: company.description } : {}), ...(sameAs.length ? { sameAs } : {}), ...(company.founded_year ? { foundingDate: String(company.founded_year) } : {}), ...(location ? { address: { '@type': 'PostalAddress', addressLocality: location } } : {}) });
  const robots = jobTotal >= MIN_JOBS_FOR_INDEXING && !Object.values(filterValues).some(Boolean) && page === 1 ? 'index, follow' : 'noindex, follow';
  return baseLayout(`${company.verified ? '✓ ' : ''}${company.name} — Remote Jobs — ${settings.site_name}`, desc, `${base}/companies/${company.slug}`, logoUrl, content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}
