// src/pages/static-pages.js

import { baseLayout } from '../layout/base-layout.js';
import { STATIC_PAGES } from '../data/static-content.js';

export function renderStaticPage(key, base) {
  const page = STATIC_PAGES[key];
  if (!page) return null;
  const content = `
<div class="page-sm">
  <a href="/" class="back-link">← Back to Jobs</a>
  <h1 class="static-title">${page.title}</h1>
  <div class="static-date">${page.date}</div>
  <div class="static-body">${page.body}</div>
  <div style="margin-top:32px"><a href="/" class="back-link" style="margin-bottom:0">← Back to Jobs</a></div>
</div>`;
  return baseLayout(`${page.title} — JobForion`, page.description, `${base}/${key}`, '', content);
}

// ══════════════════════════════════════════════════════════════════
// PROGRAMMATIC SEO: /categories, /companies, /skills, /search
// Real D1-derived data, internal linking, breadcrumbs, JSON-LD.
// ══════════════════════════════════════════════════════════════════
