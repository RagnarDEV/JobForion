// src/pages/static-pages.js
// Renders any CMS-managed page (Privacy/Terms/Disclaimer, and any new
// page created at /admin/pages) — see lib/pages-cms.js for the data
// layer. `title` is admin-form-submitted text and is escaped here for
// defense in depth; `body` is intentionally raw HTML from the rich
// editor (see the security note in components/rich-editor.js).

import { baseLayout } from '../layout/base-layout.js';
import { getPageBySlug, getFooterPages, getMenuPages } from '../lib/pages-cms.js';
import { getNavButtons } from '../lib/nav-buttons.js';
import { PUBLIC_PAGE_CSS, publicPageHeader } from '../components/public-page.js';
import { buildBreadcrumb } from '../lib/breadcrumbs.js';
import { escapeHtml } from '../lib/entities.js';
import { getSettings } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';
import { pageCodeFrameHtml } from '../components/page-code-editor.js';

export async function renderStaticPage(slug, base, env, user = null) {
  const page = await getPageBySlug(env, slug);
  if (!page) return null;
  const settings = await getSettings(env);
  const cats = await getCategories(env);
  const categories = { order: cats.map(c => c.key), map: Object.fromEntries(cats.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }])) };
  const [footerPages, menuPages, navButtons] = await Promise.all([getFooterPages(env), getMenuPages(env), getNavButtons(env)]);
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: page.title, path: `/${slug}` }]);
  const updated = page.updated_at || page.created_at;
  const dateText = updated ? new Date(updated).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const customCode = page.custom_html || page.custom_css || page.custom_js
    ? `<section class="public-page-code" aria-label="Custom page content">${pageCodeFrameHtml({ html: page.custom_html, css: page.custom_css, js: page.custom_js, id: `page_code_${slug}`, title: page.title })}</section>`
    : '';
  const content = `<div class="page public-page legal-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'LEGAL & TRUST', title: page.title, description: page.meta_description || '' })}${dateText ? `<div class="legal-updated">Last updated ${escapeHtml(dateText)}</div>` : ''}<article class="public-prose static-body" aria-label="${escapeHtml(page.title)}">${page.body}</article>${customCode}<div class="public-callout"><div><h2>Keep exploring JobForion</h2><p>Return to the live job directory or learn more about the platform.</p></div><a class="public-primary-link" href="/jobs">Browse jobs</a></div></div>`;
  return baseLayout(`${page.title} — ${settings.site_name}`, page.meta_description || page.title, `${base}/${slug}`, '', content, bcSchema, 'index, follow', settings, categories, footerPages, menuPages, navButtons, user);
}

// ══════════════════════════════════════════════════════════════════
// PROGRAMMATIC SEO: /categories, /companies, /skills, /search
// Real D1-derived data, internal linking, breadcrumbs, JSON-LD.
// ══════════════════════════════════════════════════════════════════
