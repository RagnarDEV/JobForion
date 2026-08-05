// src/pages/static-pages.js

import { baseLayout } from '../layout/base-layout.js';
import { STATIC_PAGES } from '../data/static-content.js';
import { getSettings, SETTINGS_DEFAULTS } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';

// `env` optional — see blog.js for the same pattern/rationale.
export async function renderStaticPage(key, base, env) {
  const page = STATIC_PAGES[key];
  if (!page) return null;
  const settings = env ? await getSettings(env) : SETTINGS_DEFAULTS;
  let categories = null;
  if (env) {
    const cats = await getCategories(env);
    categories = { order: cats.map(c => c.key), map: Object.fromEntries(cats.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }])) };
  }
  const content = `
<div class="page-sm">
  <a href="/" class="back-link">← Back to Jobs</a>
  <h1 class="static-title">${page.title}</h1>
  <div class="static-date">${page.date}</div>
  <div class="static-body">${page.body}</div>
  <div style="margin-top:32px"><a href="/" class="back-link" style="margin-bottom:0">← Back to Jobs</a></div>
</div>`;
  return baseLayout(`${page.title} — ${settings.site_name}`, page.description, `${base}/${key}`, '', content, '', 'index, follow', settings, categories);
}

// ══════════════════════════════════════════════════════════════════
// PROGRAMMATIC SEO: /categories, /companies, /skills, /search
// Real D1-derived data, internal linking, breadcrumbs, JSON-LD.
// ══════════════════════════════════════════════════════════════════
