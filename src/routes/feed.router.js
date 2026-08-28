// src/routes/feed.router.js
// sitemap INDEX + its child sitemaps (built from live D1 data via
// src/lib/sitemap.js) + feed.rss (jobs + blog articles combined).

import {
  buildSitemapIndexXml, buildStaticSitemapXml, buildJobsSitemapXml,
  buildCompaniesSitemapXml, buildSkillsSitemapXml, buildCountriesSitemapXml,
} from '../lib/sitemap.js';
import { getPosts } from '../lib/blog-cms.js';
import { getCategoryOrder } from '../lib/categories.js';
import { getSettings, SETTINGS_DEFAULTS } from '../lib/settings.js';
import { PUBLIC_JOB_STATUS_SQL, JOB_LISTING_COLUMNS } from '../config/constants.js';
import { reportOperationalError } from '../lib/observability.js';

// PERFORMANCE + RELIABILITY: cache every sitemap variant at Cloudflare's
// edge for 1 hour. Without this, EVERY request (including repeated crawler
// retries) rebuilds the file from scratch via D1 queries — slow, and
// directly responsible for crawlers timing out. Cache API storage is
// per-datacenter and separate from the Cache-Control header (which only
// advises browsers/CDNs downstream; it doesn't make Cloudflare itself
// cache a dynamic Worker response).
//
// CRITICAL: never let a D1 hiccup (timeout, transient error) turn into
// Cloudflare's generic HTML "Worker threw exception" page — that is
// exactly what makes Google report "couldn't fetch sitemap" even though
// the rest of the site works fine. Log the real reason to Cloudflare's
// live logs (Observability tab) so it can be diagnosed, but still answer
// with valid, if minimal/empty, XML so Google always gets a parseable
// response with a 200 status.
async function cachedXmlResponse(url, ctx, rootTag, generate) {
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let xml;
  try {
    xml = await generate();
  } catch (e) {
    reportOperationalError('feed.build', e, { path: url.pathname });
    xml = `<?xml version="1.0" encoding="UTF-8"?><${rootTag} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></${rootTag}>`;
  }
  // Defensive: some SEO validators reject the XML declaration unless it is
  // the literal first character of the response body. A stray BOM or
  // whitespace character (easy to pick up invisibly through copy/paste
  // across many edits) breaks that even when the source looks clean —
  // strip it here so the served bytes are guaranteed correct regardless.
  xml = xml.replace(/^\uFEFF/, '').trim();
  const response = new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
  if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function xmlEscape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function cdata(value) {
  return `<![CDATA[${String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

async function cachedRssResponse(url, ctx, generate) {
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  let rss;
  try {
    rss = await generate();
  } catch (e) {
    reportOperationalError('feed.build', e, { path: url.pathname });
    rss = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>JobForion</title></channel></rss>';
  }
  const response = new Response(rss.replace(/^\uFEFF/, '').trim(), { headers: {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": "public, max-age=900, s-maxage=1800",
    "X-Content-Type-Options": "nosniff",
  }});
  if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function buildRssXml(env, base) {
  let settings = SETTINGS_DEFAULTS;
  try { settings = await getSettings(env); } catch (e) {}
  let jobs = [];
  try {
    const result = await env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE ${PUBLIC_JOB_STATUS_SQL} ORDER BY id DESC LIMIT 50`).all();
    jobs = result.results || [];
  } catch (e) {}
  const jobItems = jobs.map(j => {
    const jobUrl = `${base}/job/${encodeURIComponent(String(j.id || ''))}`;
    return `<item>
        <title>${cdata(`${j.title || ''} at ${j.company || ''}`)}</title>
        <link>${xmlEscape(jobUrl)}</link>
        <guid>${xmlEscape(jobUrl)}</guid>
        <description>${cdata(`${j.company || ''} — ${j.location || 'Remote'}${j.salary ? ' — ' + j.salary : ''}`)}</description>
        <pubDate>${xmlEscape(new Date(j.created_at || Date.now()).toUTCString())}</pubDate>
        <category>Job</category>
      </item>`;
  }).join('');
  let posts = [];
  try { posts = await getPosts(env, { limit: 50 }); } catch (e) {}
  const articleItems = posts.map(p => {
    const articleUrl = `${base}/blog/${encodeURIComponent(String(p.slug || p.id || ''))}`;
    return `<item>
        <title>${cdata(p.title || '')}</title>
        <link>${xmlEscape(articleUrl)}</link>
        <guid>${xmlEscape(articleUrl)}</guid>
        <description>${cdata(p.excerpt || '')}</description>
        <pubDate>${xmlEscape(new Date(p.published_at || Date.now()).toUTCString())}</pubDate>
        <category>Article</category>
      </item>`;
  }).join('');
  const siteName = String(settings.site_name || SETTINGS_DEFAULTS.site_name);
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel><title>${cdata(`${siteName} — Remote Jobs & Career Advice`)}</title><link>${xmlEscape(base)}</link>
<description>${cdata(`Latest remote job listings and career articles from ${siteName}`)}</description>
<atom:link href="${xmlEscape(`${base}/feed.rss`)}" rel="self" type="application/rss+xml"/>
${jobItems}${articleItems}</channel></rss>`;
}

export async function handleFeedRoute(url, env, base, ctx) {
  if (url.pathname === '/sitemap.xml') {
    return cachedXmlResponse(url, ctx, 'sitemapindex', () => buildSitemapIndexXml(env, base));
  }

  if (url.pathname === '/sitemap-static.xml') {
    return cachedXmlResponse(url, ctx, 'urlset', async () => {
      const categoryOrder = await getCategoryOrder(env);
      return buildStaticSitemapXml(env, base, { categoryOrder });
    });
  }

  const jobsSitemapMatch = url.pathname.match(/^\/sitemap-jobs-(\d+)\.xml$/);
  if (jobsSitemapMatch) {
    const page = parseInt(jobsSitemapMatch[1], 10) || 1;
    return cachedXmlResponse(url, ctx, 'urlset', () => buildJobsSitemapXml(env, base, page));
  }

  if (url.pathname === '/sitemap-companies.xml') {
    return cachedXmlResponse(url, ctx, 'urlset', () => buildCompaniesSitemapXml(env, base));
  }

  if (url.pathname === '/sitemap-skills.xml') {
    return cachedXmlResponse(url, ctx, 'urlset', () => buildSkillsSitemapXml(env, base));
  }

  if (url.pathname === '/sitemap-countries.xml') {
    return cachedXmlResponse(url, ctx, 'urlset', () => buildCountriesSitemapXml(env, base));
  }

  if (url.pathname === '/feed.rss') {
    return cachedRssResponse(url, ctx, () => buildRssXml(env, base));
  }

  return null;
}
