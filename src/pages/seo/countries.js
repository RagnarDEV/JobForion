// src/pages/seo/countries.js
// /countries directory and /countries/:slug detail.

import { baseLayout } from '../../layout/base-layout.js';
import { listCountries, findCountryBySlug, jobsByRegion, countJobsByRegion, escapeHtml, MIN_JOBS_FOR_INDEXING } from '../../lib/directory/entities.js';
import { countryFlag } from '../../lib/directory/country-flags.js';
import { collectionPageSchema, itemListSchema, ldJsonTag } from '../../lib/seo/jsonld.js';
import { buildBreadcrumb } from '../../lib/seo/breadcrumbs.js';
import { truncateDescription } from '../../lib/seo/meta.js';
import { PUBLIC_PAGE_CSS, publicPageHeader, publicCard } from '../../components/public-page.js';
import { loadPageContext, jobsListHtml } from './shared.js';

import { iconInbox } from '../../assets/icons.js';
// ── /countries ──
// Mirrors the /companies pattern exactly: listCountries()/findCountryBySlug()
// derive country/region names from the existing jobs.location column (see
// splitLocation() in lib/directory/entities.js) — no new table, no schema migration.
// Every country name is prefixed with a flag emoji via countryFlag()
// (lib/directory/country-flags.js), both in the directory grid and the detail heading.
export async function renderCountriesIndex(env, base, user = null) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const countries = await listCountries(env, { limit: 200 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Countries', path: '/countries' }]);
  const cards = countries.map(country => publicCard({ href: `/countries/${encodeURIComponent(country.slug)}`, icon: countryFlag(country.name), title: country.name, description: 'Explore active remote opportunities in this location.', meta: 'Open roles', count: country.count })).join('');
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'BROWSE LOCATIONS', title: 'Discover remote jobs around the world', description: `${countries.length} countries and regions represented by active listings in the current JobForion data.` })}<section class="public-card-grid" aria-label="Countries and regions">${cards || `<div class="empty"><div class="e-icon">${iconInbox({ size: 44 })}</div><h3>No locations available</h3><p>Locations will appear after the next job sync.</p></div>`}</section></div>`;
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
  // Only the most recent DIRECTORY_WINDOW jobs are browsable here (D1 row-read budget), so paginate
  // over at most 200 results; the header still shows the exact precomputed total.
  const totalPages = Math.max(1, Math.ceil(Math.min(total, 200) / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const jobs = await jobsByRegion(env, rawNames, { limit: pageSize, offset: (page - 1) * pageSize });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Countries', path: '/countries' }, { name: country.name, path: `/countries/${slug}` }]);
  const safeName = escapeHtml(country.name);
  const flag = countryFlag(country.name);
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">${iconInbox({ size: 44 })}</div><h3>No open jobs in this location yet</h3><p>Browse the full Jobs directory to explore other active roles.</p><a class="public-primary-link" href="/jobs?country=${encodeURIComponent(country.name)}">Browse all jobs </a></div>`);
  const pageLink = n => `/countries/${encodeURIComponent(slug)}${n > 1 ? `?page=${n}` : ''}`;
  const pagination = totalPages > 1 ? `<nav class="jobs-directory-pagination" aria-label="Location jobs pagination">${page > 1 ? `<a class="page-btn" href="${pageLink(page - 1)}"> Previous</a>` : '<span class="page-btn disabled"> Previous</span>'}<span class="page-number-list">${Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.min(totalPages, page + 2)).map(n => `<a class="page-number${n === page ? ' active' : ''}"${n === page ? ' aria-current="page"' : ''} href="${pageLink(n)}">${n}</a>`).join('')}</span>${page < totalPages ? `<a class="page-btn" href="${pageLink(page + 1)}">Next </a>` : '<span class="page-btn disabled">Next </span>'}</nav>` : '';
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'LOCATION JOBS', title: `${flag} Remote jobs in ${country.name}`, description: `${total.toLocaleString()} active opportunities located in or hiring from this region.` })}<div class="public-callout"><div><h2>Refine by more signals</h2><p>Use the shared Jobs search to combine this location with role, salary, employment, and remote filters.</p></div><a class="public-primary-link" href="/jobs?country=${encodeURIComponent(country.name)}">Open job filters </a></div><section class="public-section" aria-labelledby="location-open-jobs"><div class="public-section-heading"><div><h2 id="location-open-jobs">Latest roles in ${safeName}</h2><p>${total.toLocaleString()} active listing${total === 1 ? '' : 's'} from the current backend.</p></div></div>${jobsHtml}${pagination}</section></div>`;
  const desc = truncateDescription(`Browse ${total} remote jobs in ${country.name} on ${settings.site_name}. Filter the full directory by role, salary, and employment type.`);
  const schema = ldJsonTag(itemListSchema(jobs.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  const robots = total >= MIN_JOBS_FOR_INDEXING && page === 1 ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote Jobs in ${country.name} — ${settings.site_name}`, desc, `${base}/countries/${slug}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}
