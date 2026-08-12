// src/pages/seo-pages.js
// Programmatic SEO directory + detail pages: categories, companies, skills,
// countries, and search. Job/company/skill/country data is derived live
// from D1 (see src/lib/entities.js). Categories are now ALSO fully dynamic
// (see src/lib/categories.js) — /admin/categories is the only place that
// creates/edits/reorders/removes them, no code edit required.

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
import { JOB_TYPE_SORT_SQL } from '../config/constants.js';
import { getSettings } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';
import { getCardStyles } from '../lib/job-card-styles.js';
import { getLogoOverrides } from '../lib/company-logos.js';
import { getFooterPages, getMenuPages } from '../lib/pages-cms.js';
import { getNavButtons } from '../lib/nav-buttons.js';

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
  const logoOverrides = await getLogoOverrides(env, jobs.map(j => j.company));
  return `<div class="jobs-list">${jobs.map((j, i) => jobCardSSR(j, i, categoryMap, categoryOrder, cardStyles, logoOverrides)).join('')}</div>`;
}

// ── /categories ──
export async function renderCategoriesIndex(env, base) {
  const { settings, categoryOrder, categoryMap, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Categories', path: '/categories' }]);
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">Browse Jobs by Category</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">Explore remote roles grouped by discipline.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
      ${categoryOrder.map(k => `<a href="/categories/${k}" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;text-decoration:none;display:flex;align-items:center;gap:10px;transition:all .2s" onmouseover="this.style.borderColor='var(--brand)'" onmouseout="this.style.borderColor='var(--border)'">
        <span style="font-size:22px">${categoryMap[k].emoji}</span><span style="font-size:14px;font-weight:700;color:var(--ink)">${escapeHtml(categoryMap[k].label)}</span>
      </a>`).join('')}
    </div>
  </div>`;
  const schema = ldJsonTag(collectionPageSchema(`Job Categories — ${settings.site_name}`, 'Browse remote jobs by category.', `${base}/categories`));
  return baseLayout(`Browse Remote Jobs by Category — ${settings.site_name}`, 'Explore curated remote job listings grouped by discipline: development, design, marketing, data, DevOps, management and writing.', `${base}/categories`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons);
}

export async function renderCategoryDetail(env, base, key) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const meta = categoryMap[key];
  if (!meta) return null;
  const { results } = await env.DB.prepare(`SELECT * FROM jobs WHERE LOWER(title) LIKE ? ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT 60`).bind(`%${key}%`).all();
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Categories', path: '/categories' }, { name: meta.label, path: `/categories/${key}` }]);
  const jobsHtml = await jobsListHtml(env, results, categoryMap, categoryOrder, cardStyles, '<div class="empty"><div class="e-icon">📭</div><h3>No jobs in this category yet</h3></div>');
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">${meta.emoji} ${escapeHtml(meta.label)} Remote Jobs</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${(results || []).length} open remote ${escapeHtml(meta.label.toLowerCase())} positions, updated hourly.</p>
    ${jobsHtml}
  </div>`;
  const desc = truncateDescription(`Browse ${(results || []).length} remote ${meta.label.toLowerCase()} jobs updated hourly. Filter by seniority, salary, and location on ${settings.site_name}.`);
  const schema = ldJsonTag(itemListSchema((results || []).slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  return baseLayout(`${meta.label} Remote Jobs — ${settings.site_name}`, desc, `${base}/categories/${key}`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons);
}

// ── /companies ──
export async function renderCompaniesIndex(env, base) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const companies = await listCompanies(env, { limit: 200 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Companies', path: '/companies' }]);
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">Companies Hiring Remotely</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${companies.length} companies with active remote listings on ${escapeHtml(settings.site_name)}.</p>
    ${directoryGridHtml(companies, '/companies')}
  </div>`;
  const schema = ldJsonTag(collectionPageSchema(`Companies Hiring Remotely — ${settings.site_name}`, 'Directory of companies with active remote job listings.', `${base}/companies`));
  return baseLayout(`Companies Hiring Remotely — ${settings.site_name}`, `Browse ${companies.length} companies with active remote job openings, updated hourly on ${settings.site_name}.`, `${base}/companies`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons);
}

export async function renderCompanyDetail(env, base, slug) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
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
      <h1 style="font-family:'Space Grotesk',sans-serif;font-size:24px;font-weight:700;color:var(--ink)">${safeName}</h1>
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
  return baseLayout(`Remote Jobs at ${company.name} — ${settings.site_name}`, desc, `${base}/companies/${slug}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons);
}

// ── /countries ──
// Mirrors the /companies pattern exactly: listCountries()/findCountryBySlug()
// derive country/region names from the existing jobs.location column (see
// splitLocation() in lib/entities.js) — no new table, no schema migration.
// Every country name is prefixed with a flag emoji via countryFlag()
// (lib/country-flags.js), both in the directory grid and the detail heading.
export async function renderCountriesIndex(env, base) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const countries = await listCountries(env, { limit: 200 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Countries', path: '/countries' }]);
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">Browse Remote Jobs by Country</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${countries.length} countries and regions with active remote listings on ${escapeHtml(settings.site_name)}.</p>
    ${directoryGridHtml(countries, '/countries', (c) => `<span aria-hidden="true">${countryFlag(c.name)}</span> `)}
  </div>`;
  const schema = ldJsonTag(collectionPageSchema(`Countries — ${settings.site_name}`, 'Browse remote jobs by country or region.', `${base}/countries`));
  return baseLayout(`Browse Remote Jobs by Country — ${settings.site_name}`, `Explore remote job listings across ${countries.length} countries and regions, updated hourly on ${settings.site_name}.`, `${base}/countries`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons);
}

export async function renderCountryDetail(env, base, slug) {
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
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">${flag} Remote Jobs in ${safeName}</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${jobs.length} open remote position${jobs.length === 1 ? '' : 's'} located in or hiring from ${safeName}.</p>
    ${jobsHtml}
  </div>`;
  const desc = truncateDescription(`Browse ${jobs.length} remote jobs in ${country.name}. Updated hourly on ${settings.site_name}.`);
  const schema = ldJsonTag(itemListSchema(jobs.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  // THIN CONTENT: see the identical note on renderCompanyDetail above.
  const robots = jobs.length >= MIN_JOBS_FOR_INDEXING ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote Jobs in ${country.name} — ${settings.site_name}`, desc, `${base}/countries/${slug}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons);
}

// ── /skills ──
export async function renderSkillsIndex(env, base) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const skills = await listSkills(env, { limit: 200 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Skills', path: '/skills' }]);
  const content = `<div class="page">${bc}
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">Browse Remote Jobs by Skill</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${skills.length} in-demand skills across current listings.</p>
    ${directoryGridHtml(skills, '/skills')}
  </div>`;
  const schema = ldJsonTag(collectionPageSchema(`Skills — ${settings.site_name}`, 'Browse remote jobs by required skill.', `${base}/skills`));
  return baseLayout(`Browse Remote Jobs by Skill — ${settings.site_name}`, `Explore ${skills.length} in-demand skills across current remote job listings on ${settings.site_name}.`, `${base}/skills`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons);
}

export async function renderSkillDetail(env, base, slug) {
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
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)">Remote Jobs Requiring ${safeName}</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${jobs.length} open remote positions listing ${safeName} as a required skill.</p>
    ${jobsHtml}
  </div>`;
  const desc = truncateDescription(`Browse ${jobs.length} remote jobs requiring ${skill.name}. Updated hourly on ${settings.site_name}.`);
  const schema = ldJsonTag(itemListSchema(jobs.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  // THIN CONTENT: see the identical note on renderCompanyDetail above.
  const robots = jobs.length >= MIN_JOBS_FOR_INDEXING ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote ${skill.name} Jobs — ${settings.site_name}`, desc, `${base}/skills/${slug}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons);
}

// ── /search/:query — indexable only when it returns real content ──
export async function renderSearchPage(env, base, query) {
  const { settings, categoryMap, categoryOrder, cardStyles, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const q = decodeURIComponent(query || '').trim();
  const { results } = await env.DB.prepare(
    `SELECT * FROM jobs WHERE LOWER(title) LIKE ? OR LOWER(company) LIKE ? OR LOWER(location) LIKE ? ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT 50`
  ).bind(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`).all();
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
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:24px;font-weight:700;margin-bottom:8px;color:var(--ink)">Remote "${safeQ}" Jobs</h1>
    <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">${(results || []).length} results for "${safeQ}"</p>
    ${jobsHtml}
  </div>`;
  const desc = hasResults
    ? truncateDescription(`${results.length} remote "${q}" jobs available now. Browse and apply directly on ${settings.site_name}.`)
    : `No current openings match "${q}" — browse all remote job categories on ${settings.site_name}.`;
  const schema = hasResults ? ldJsonTag(itemListSchema(results.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` })))) : '';
  // thin/empty search pages are noindexed to avoid low-quality-page SEO penalties
  const robots = hasResults ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote "${q}" Jobs — ${settings.site_name}`, desc, `${base}/search/${encodeURIComponent(q)}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons);
}
