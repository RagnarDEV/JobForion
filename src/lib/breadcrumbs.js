// src/lib/breadcrumbs.js
import { breadcrumbSchema, ldJsonTag } from './schema.js';
import { escapeHtml } from './entities.js';

// trail: [{name, url}, ...] — home first, current page last (current has no link)
// SECURITY: t.name can originate from DB-derived entity data (company,
// skill, country name) or directly from the URL (search query) — always
// escape before inserting into the visible HTML trail.
export function breadcrumbHtml(trail) {
  if (!trail || !trail.length) return '';
  const parts = trail.map((t, i) => {
    const isLast = i === trail.length - 1;
    const safeName = escapeHtml(t.name);
    return isLast
      ? `<span>${safeName}</span>`
      : `<a href="${t.href || t.url}">${safeName}</a>`;
  });
  return `<div class="breadcrumb">${parts.join('<span>›</span>')}</div>`;
}

export function breadcrumbJsonLd(trail) {
  // schema requires absolute URLs — ldJsonTag() itself now escapes "<" to
  // prevent a name containing "</script>" from breaking out of the tag.
  return ldJsonTag(breadcrumbSchema(trail.map(t => ({ name: t.name, url: t.url }))));
}

// Convenience: build both HTML + schema from a base + list of
// {name, path} where path is site-relative (e.g. "/companies/google")
export function buildBreadcrumb(base, segments) {
  const trail = [{ name: 'JobForion', href: '/', url: base }].concat(
    segments.map(s => ({ name: s.name, href: s.path, url: base + s.path }))
  );
  return { html: breadcrumbHtml(trail), jsonLd: breadcrumbJsonLd(trail) };
}
