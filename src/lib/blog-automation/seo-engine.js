// src/lib/blog-automation/seo-engine.js
// Builds SEO title / meta description / slug / canonical URL for a
// generated article from REAL content the template already produced
// (seoTitleHint/seoDescriptionHint/excerpt) — never invents copy. Kept as
// its own module so SEO conventions (length limits, slug shape) live in
// exactly one place, matching the pattern lib/seo.js already sets for the
// rest of the site (truncateDescription, buildMeta).

import { slugify } from '../entities.js';

const SEO_TITLE_MAX = 65;
const SEO_DESC_MAX = 160;

export function buildSeoMeta({ title, base, slugBase, seoTitleHint, seoDescriptionHint, excerpt }) {
  const seoTitle = (seoTitleHint || title || '').slice(0, SEO_TITLE_MAX);
  const seoDescription = (seoDescriptionHint || excerpt || '').slice(0, SEO_DESC_MAX);
  const slug = slugify(slugBase || title);
  const canonicalUrl = `${base}/blog/${slug}`;
  return { seoTitle, seoDescription, slug, canonicalUrl };
}
