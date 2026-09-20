// src/pages/seo/skills.js
// /skills directory and /skills/:slug detail.

import { baseLayout } from '../../layout/base-layout.js';
import { listSkills, findSkillBySlug, jobsBySkill, countJobsBySkill, escapeHtml, MIN_JOBS_FOR_INDEXING } from '../../lib/directory/entities.js';
import { collectionPageSchema, itemListSchema, ldJsonTag } from '../../lib/seo/jsonld.js';
import { buildBreadcrumb } from '../../lib/seo/breadcrumbs.js';
import { truncateDescription } from '../../lib/seo/meta.js';
import { iconInbox, iconSearch } from '../../assets/icons.js';
import { PUBLIC_PAGE_CSS, publicPageHeader, publicCard } from '../../components/public-page.js';
import { loadPageContext, jobsListHtml } from './shared.js';

// ── /skills ──
export async function renderSkillsIndex(env, base, user = null) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await loadPageContext(env);
  const skills = await listSkills(env, { limit: 200 });
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Skills', path: '/skills' }]);
  const cards = skills.map(skill => publicCard({ href: `/skills/${encodeURIComponent(skill.slug)}`, icon: iconSearch({ size: 18 }), title: skill.name, description: 'Find current roles that mention this skill.', meta: 'Related jobs', count: skill.count })).join('');
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'BROWSE BY SKILL', title: 'Find opportunities by skill', description: 'Explore skills found in live job listings and follow each one to its related opportunities.' })}<section class="public-card-grid" aria-label="Skills">${cards || `<div class="empty"><div class="e-icon">${iconInbox({ size: 44 })}</div><h3>No skills available</h3><p>Skills will appear after jobs with structured skill data are synced.</p></div>`}</section></div>`;
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
  const jobsHtml = await jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, `<div class="empty"><div class="e-icon">${iconInbox({ size: 44 })}</div><h3>No jobs currently require this skill</h3><p>Browse the full Jobs directory to explore other active roles.</p><a class="public-primary-link" href="/jobs?skill=${encodeURIComponent(skill.name)}">Browse all jobs </a></div>`);
  const pageLink = n => `/skills/${encodeURIComponent(slug)}${n > 1 ? `?page=${n}` : ''}`;
  const pagination = totalPages > 1 ? `<nav class="jobs-directory-pagination" aria-label="Skill jobs pagination">${page > 1 ? `<a class="page-btn" href="${pageLink(page - 1)}"> Previous</a>` : '<span class="page-btn disabled"> Previous</span>'}<span class="page-number-list">${Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.min(totalPages, page + 2)).map(n => `<a class="page-number${n === page ? ' active' : ''}"${n === page ? ' aria-current="page"' : ''} href="${pageLink(n)}">${n}</a>`).join('')}</span>${page < totalPages ? `<a class="page-btn" href="${pageLink(page + 1)}">Next </a>` : '<span class="page-btn disabled">Next </span>'}</nav>` : '';
  const relatedCategories = categoryOrder.slice(0, 4).map(key => publicCard({ href: `/categories/${encodeURIComponent(key)}`, icon: categoryMap[key]?.emoji || '•', title: categoryMap[key]?.label || key, meta: 'Explore category' })).join('');
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'SKILL JOBS', title: `Remote jobs requiring ${skill.name}`, description: `${total.toLocaleString()} active positions currently mention this skill.` })}<div class="public-callout"><div><h2>Search beyond this skill</h2><p>Combine skill, role, location, salary, and remote filters in the shared Jobs directory.</p></div><a class="public-primary-link" href="/jobs?skill=${encodeURIComponent(skill.name)}">Open job filters </a></div><section class="public-section" aria-labelledby="skill-open-jobs"><div class="public-section-heading"><div><h2 id="skill-open-jobs">Latest ${safeName} roles</h2><p>${total.toLocaleString()} active listing${total === 1 ? '' : 's'} from the current backend.</p></div></div>${jobsHtml}${pagination}</section><section class="public-section" aria-labelledby="related-skill-categories"><div class="public-section-heading"><h2 id="related-skill-categories">Explore categories</h2></div><div class="public-card-grid">${relatedCategories}</div></section></div>`;
  const desc = truncateDescription(`Browse ${total} remote jobs requiring ${skill.name} on ${settings.site_name}. Explore current opportunities and refine the full directory.`);
  const schema = ldJsonTag(itemListSchema(jobs.slice(0, 20).map(j => ({ url: `${base}/job/${j.id}` }))));
  const robots = total >= MIN_JOBS_FOR_INDEXING && page === 1 ? 'index, follow' : 'noindex, follow';
  return baseLayout(`Remote ${skill.name} Jobs — ${settings.site_name}`, desc, `${base}/skills/${slug}`, '', content, schema + bcSchema, robots, settings, categoryBundle, footerPages, menuPages, navButtons, user);
}
