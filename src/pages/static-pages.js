// src/pages/static-pages.js
// Renders any CMS-managed page (Privacy/Terms/Disclaimer, and any new
// page created at /admin/pages) — see lib/pages-cms.js for the data
// layer. `title` is admin-form-submitted text and is escaped here for
// defense in depth; `body` is intentionally raw HTML from the rich
// editor (see the security note in components/rich-editor.js).

import { baseLayout } from '../layout/base-layout.js';
import { getPageBySlug, getFooterPages } from '../lib/pages-cms.js';
import { escapeHtml } from '../lib/entities.js';
import { getSettings } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';

export async function renderStaticPage(slug, base, env, user = null) {
  const page = await getPageBySlug(env, slug);
  if (!page) return null;
  const settings = await getSettings(env);
  const cats = await getCategories(env);
  const categories = { order: cats.map(c => c.key), map: Object.fromEntries(cats.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }])) };
  const footerPages = await getFooterPages(env);
  const content = `
<div class="page-sm">
  <a href="/" class="back-link">← Back to Jobs</a>
  <h1 class="static-title">${escapeHtml(page.title)}</h1>
  <div class="static-date">Last updated: ${new Date(page.updated_at || page.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
  <div class="static-body">${page.body}</div>
  <div style="margin-top:32px"><a href="/" class="back-link" style="margin-bottom:0">← Back to Jobs</a></div>
</div>`;
  return baseLayout(`${page.title} — ${settings.site_name}`, page.meta_description || page.title, `${base}/${slug}`, '', content, '', 'index, follow', settings, categories, footerPages, null, null, user);
}

// ══════════════════════════════════════════════════════════════════
// PROGRAMMATIC SEO: /categories, /companies, /skills, /search
// Real D1-derived data, internal linking, breadcrumbs, JSON-LD.
// ══════════════════════════════════════════════════════════════════
