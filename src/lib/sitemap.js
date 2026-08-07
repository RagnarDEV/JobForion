// src/lib/sitemap.js
// ════════════════════════════════════════════════════════════════
// Sitemap INDEX architecture — /sitemap.xml is now an index that lists
// child sitemap files (per Google's sitemap-index spec), rather than one
// giant file listing every URL directly. This replaces the old single-file
// approach, which silently capped job pages at a fixed LIMIT and was
// hiding the majority of the site's job listings from Google once job
// count grew past that cap.
//
// Structure:
//   /sitemap.xml              → the INDEX (lists every file below)
//   /sitemap-static.xml       → core pages, blog, categories (small, stable)
//   /sitemap-jobs-<n>.xml     → jobs, auto-chunked at JOBS_PER_SITEMAP each
//   /sitemap-companies.xml    → company directory pages
//   /sitemap-skills.xml       → skill directory pages
//   /sitemap-countries.xml    → country directory pages
//
// robots.txt and Google Search Console only ever need to reference the top
// level /sitemap.xml — Google follows the <sitemap> entries automatically.
// ════════════════════════════════════════════════════════════════

import { listCompanies, listSkills, listCountries } from './entities.js';
import { getPages } from './pages-cms.js';
import { getPosts } from './blog-cms.js';

// Google's sitemap protocol caps a single file at 50,000 URLs. 20,000 per
// job-chunk keeps meaningful headroom under that limit (a single chunk
// file could still absorb a burst of new jobs between cleanup runs without
// ever approaching the hard cap), while keeping each chunk's D1 query and
// XML payload comfortably small and fast to generate/cache.
export const JOBS_PER_SITEMAP = 20000;

function urlTag(loc, opts = {}) {
  return `<url><loc>${loc}</loc>${opts.changefreq ? `<changefreq>${opts.changefreq}</changefreq>` : ''}${opts.priority ? `<priority>${opts.priority}</priority>` : ''}${opts.lastmod ? `<lastmod>${opts.lastmod}</lastmod>` : ''}</url>`;
}

function urlsetXml(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('')}
</urlset>`.trim();
}

export async function getJobCount(env) {
  try {
    const { results } = await env.DB.prepare("SELECT COUNT(*) c FROM jobs").all();
    return results[0]?.c || 0;
  } catch (e) { return 0; }
}

// ── /sitemap.xml — the INDEX ──────────────────────────────────────
// Lists every child sitemap file. Never lists page URLs directly — that's
// what makes this infinitely scalable: adding more jobs just adds more
// /sitemap-jobs-N.xml entries here, automatically, with zero code changes.
export async function buildSitemapIndexXml(env, base) {
  const jobCount = await getJobCount(env);
  const jobChunks = Math.max(1, Math.ceil(jobCount / JOBS_PER_SITEMAP));
  const today = new Date().toISOString().split('T')[0];

  const entries = [];
  const add = (loc) => entries.push(`<sitemap><loc>${loc}</loc><lastmod>${today}</lastmod></sitemap>`);

  add(`${base}/sitemap-static.xml`);
  for (let i = 1; i <= jobChunks; i++) add(`${base}/sitemap-jobs-${i}.xml`);
  add(`${base}/sitemap-companies.xml`);
  add(`${base}/sitemap-skills.xml`);
  add(`${base}/sitemap-countries.xml`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('')}
</sitemapindex>`.trim();
}

// ── /sitemap-static.xml — core pages, blog, categories ─────────────
// `blogPosts` / `categoryOrder` are passed in since they're still defined
// as in-code constants in index.js (static content stays static).
export async function buildStaticSitemapXml(env, base, { categoryOrder = [] } = {}) {
  const urls = [];
  urls.push(urlTag(`${base}/`, { changefreq: 'hourly', priority: '1.0' }));
  urls.push(urlTag(`${base}/blog`, { changefreq: 'weekly', priority: '0.8' }));
  urls.push(urlTag(`${base}/companies`, { changefreq: 'daily', priority: '0.7' }));
  urls.push(urlTag(`${base}/categories`, { changefreq: 'daily', priority: '0.7' }));
  urls.push(urlTag(`${base}/skills`, { changefreq: 'daily', priority: '0.6' }));
  urls.push(urlTag(`${base}/countries`, { changefreq: 'daily', priority: '0.6' }));
  for (const key of categoryOrder) urls.push(urlTag(`${base}/categories/${key}`, { changefreq: 'daily', priority: '0.65' }));

  // CMS pages (Privacy/Terms/Disclaimer + anything created at
  // /admin/pages) and blog posts (lib/blog-cms.js) are now D1-backed —
  // pulled live here instead of the old hardcoded STATIC_PAGES/
  // BLOG_POSTS arrays, so a brand-new page or article is picked up on
  // the very next sitemap rebuild with zero code changes.
  try {
    const pages = await getPages(env);
    for (const p of pages) urls.push(urlTag(`${base}/${p.slug}`, { changefreq: 'yearly', priority: '0.3', lastmod: (p.updated_at || p.created_at || '').slice(0, 10) || undefined }));
  } catch (e) {}
  try {
    const posts = await getPosts(env, { limit: 500 });
    for (const p of posts) urls.push(urlTag(`${base}/blog/${p.slug || p.id}`, { changefreq: 'monthly', priority: '0.7', lastmod: (p.updated_at || p.published_at || '').slice(0, 10) || undefined }));
  } catch (e) {}

  return urlsetXml(urls);
}

// ── /sitemap-jobs-:n.xml — one page of job URLs, newest-first ──────
// page is 1-indexed to match the URLs the index builder generates above.
export async function buildJobsSitemapXml(env, base, page) {
  const offset = Math.max(0, (page - 1)) * JOBS_PER_SITEMAP;
  const urls = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, created_at FROM jobs ORDER BY id DESC LIMIT ? OFFSET ?"
    ).bind(JOBS_PER_SITEMAP, offset).all();
    for (const j of results || []) {
      urls.push(urlTag(`${base}/job/${j.id}`, {
        changefreq: 'weekly', priority: '0.6',
        lastmod: new Date(j.created_at || Date.now()).toISOString().split('T')[0],
      }));
    }
  } catch (e) {}
  return urlsetXml(urls);
}

// ── /sitemap-companies.xml ──────────────────────────────────────────
export async function buildCompaniesSitemapXml(env, base) {
  const urls = [];
  try {
    const companies = await listCompanies(env, { limit: 5000 });
    for (const c of companies) urls.push(urlTag(`${base}/companies/${c.slug}`, { changefreq: 'weekly', priority: '0.55' }));
  } catch (e) {}
  return urlsetXml(urls);
}

// ── /sitemap-skills.xml ──────────────────────────────────────────────
export async function buildSkillsSitemapXml(env, base) {
  const urls = [];
  try {
    const skills = await listSkills(env, { limit: 3000 });
    for (const s of skills) urls.push(urlTag(`${base}/skills/${s.slug}`, { changefreq: 'weekly', priority: '0.5' }));
  } catch (e) {}
  return urlsetXml(urls);
}

// ── /sitemap-countries.xml ───────────────────────────────────────────
export async function buildCountriesSitemapXml(env, base) {
  const urls = [];
  try {
    const countries = await listCountries(env, { limit: 1000 });
    for (const c of countries) urls.push(urlTag(`${base}/countries/${c.slug}`, { changefreq: 'weekly', priority: '0.5' }));
  } catch (e) {}
  return urlsetXml(urls);
}
