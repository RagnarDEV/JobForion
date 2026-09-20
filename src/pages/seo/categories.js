// src/pages/seo/categories.js
// /categories index and /categories/:key detail.

import { baseLayout } from '../../layout/base-layout.js';
import { escapeHtml, MIN_JOBS_FOR_INDEXING } from '../../lib/directory/entities.js';
import { collectionPageSchema, itemListSchema, ldJsonTag } from '../../lib/seo/jsonld.js';
import { buildBreadcrumb } from '../../lib/seo/breadcrumbs.js';
import { truncateDescription } from '../../lib/seo/meta.js';
import { JOB_MANUAL_PIN_SORT_SQL, PUBLIC_JOB_STATUS_SQL, JOB_LISTING_COLUMNS } from '../../config/constants.js';
import { PUBLIC_PAGE_CSS, publicPageHeader, publicCard } from '../../components/public-page.js';
import { loadPageContext, jobsListHtml } from './shared.js';

import { iconInbox } from '../../assets/icons.js';
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
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'EXPLORE BY CATEGORY', title: 'Explore jobs by category', description: 'Browse real remote opportunities grouped by the disciplines and categories managed in JobForion.' })}<section class="public-card-grid" aria-label="Job categories">${cards || `<div class="empty"><div class="e-icon">${iconInbox({ size: 44 })}</div><h3>No categories available</h3><p>Categories will appear after they are configured.</p></div>`}</section><div class="public-callout"><div><h2>Ready to search?</h2><p>Use the complete Jobs directory to combine category, location, salary, and remote filters.</p></div><a class="public-primary-link" href="/jobs">Browse all jobs </a></div></div>`;
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
  let countRows, jobs;
  try {
    ({ results: countRows } = await env.DB.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE LOWER(title) LIKE ? AND ${PUBLIC_JOB_STATUS_SQL}`).bind(categoryLike).all());
  } catch (e) { countRows = [{ c: 0 }]; }
  const total = Number(countRows?.[0]?.c || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  try {
    ({ results: jobs } = await env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE LOWER(title) LIKE ? AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY ${JOB_MANUAL_PIN_SORT_SQL} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`).bind(categoryLike).all());
  } catch (e) { jobs = []; }
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Categories', path: '/categories' }, { name: meta.label, path: `/categories/${key}` }]);
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">${iconInbox({ size: 44 })}</div><h3>No jobs in this category yet</h3><p>Browse the full Jobs directory to explore other active roles.</p><a class="public-primary-link" href="/jobs?category=${encodeURIComponent(key)}">Browse all jobs </a></div>`);
  const pageLink = n => `/categories/${encodeURIComponent(key)}${n > 1 ? `?page=${n}` : ''}`;
  const pagination = totalPages > 1 ? `<nav class="jobs-directory-pagination" aria-label="Category jobs pagination">${page > 1 ? `<a class="page-btn" href="${pageLink(page - 1)}"> Previous</a>` : '<span class="page-btn disabled"> Previous</span>'}<span class="page-number-list">${Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.min(totalPages, page + 2)).map(n => `<a class="page-number${n === page ? ' active' : ''}"${n === page ? ' aria-current="page"' : ''} href="${pageLink(n)}">${n}</a>`).join('')}</span>${page < totalPages ? `<a class="page-btn" href="${pageLink(page + 1)}">Next </a>` : '<span class="page-btn disabled">Next </span>'}</nav>` : '';
  const related = categoryOrder.filter(other => other !== key).slice(0, 4).map(other => publicCard({ href: `/categories/${encodeURIComponent(other)}`, icon: categoryMap[other]?.emoji || '•', title: categoryMap[other]?.label || other, meta: 'Explore category' })).join('');
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'CATEGORY JOBS', title: `${meta.emoji || ''} ${meta.label} jobs`, description: `${total.toLocaleString()} active opportunities matched to this category.` })}<div class="public-callout"><div><h2>Refine your search</h2><p>Use the shared Jobs directory to filter this category by remote type, employment, salary, location, and seniority.</p></div><a class="public-primary-link" href="/jobs?category=${encodeURIComponent(key)}">Open job filters </a></div><section class="public-section" aria-labelledby="category-open-jobs"><div class="public-section-heading"><div><h2 id="category-open-jobs">Latest ${escapeHtml(meta.label)} roles</h2><p>${total.toLocaleString()} active listing${total === 1 ? '' : 's'} from the current backend.</p></div></div>${jobsHtml}${pagination}</section>${related ? `<section class="public-section" aria-labelledby="related-categories"><div class="public-section-heading"><h2 id="related-categories">Explore more categories</h2></div><div class="public-card-grid">${related}</div></section>` : ''}</div>`;
  const desc = truncateDescription(`Browse ${total} remote ${meta.label.toLowerCase()} jobs on ${settings.site_name}. Use the full Jobs directory to refine by salary, location, and seniority.`);
  const schema = ldJsonTag(itemListSchema((jobs || []).slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  const robots = total >= MIN_JOBS_FOR_INDEXING && page === 1 ? 'index, follow' : 'noindex, follow';
  return baseLayout(`${meta.label} Remote Jobs — ${settings.site_name}`, desc, `${base}/categories/${key}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}
