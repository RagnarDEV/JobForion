// src/routes/feed.router.js
// sitemap INDEX + its child sitemaps (built from live D1 data via
// src/lib/sitemap.js) + feed.rss (jobs + blog articles combined).

import {
  buildSitemapIndexXml, buildStaticSitemapXml, buildJobsSitemapXml,
  buildCompaniesSitemapXml, buildSkillsSitemapXml, buildCountriesSitemapXml,
} from '../lib/sitemap.js';
import { BLOG_POSTS } from '../data/blog-posts.js';
import { CATEGORY_ORDER } from '../config/constants.js';

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
    console.error(`[${url.pathname}] build failed:`, e && e.stack || e);
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

export async function handleFeedRoute(url, env, base, ctx) {
  if (url.pathname === '/sitemap.xml') {
    return cachedXmlResponse(url, ctx, 'sitemapindex', () => buildSitemapIndexXml(env, base));
  }

  if (url.pathname === '/sitemap-static.xml') {
    return cachedXmlResponse(url, ctx, 'urlset', () =>
      buildStaticSitemapXml(base, { blogPosts: BLOG_POSTS, categoryOrder: CATEGORY_ORDER })
    );
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
    const { results } = await env.DB.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT 50").all();
    const jobItems = results.map(j => `<item>
        <title><![CDATA[${j.title} at ${j.company}]]></title>
        <link>${base}/job/${j.id}</link>
        <guid>${base}/job/${j.id}</guid>
        <description><![CDATA[${j.company} — ${j.location || 'Remote'}${j.salary ? ' — ' + j.salary : ''}]]></description>
        <pubDate>${new Date(j.created_at || Date.now()).toUTCString()}</pubDate>
        <category>Job</category>
      </item>`).join('');
    const articleItems = BLOG_POSTS.map(p => `<item>
        <title><![CDATA[${p.title}]]></title>
        <link>${base}/blog/${p.id}</link>
        <guid>${base}/blog/${p.id}</guid>
        <description><![CDATA[${p.excerpt}]]></description>
        <pubDate>${new Date(p.date).toUTCString()}</pubDate>
        <category>Article</category>
      </item>`).join('');
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel><title>JobForion — Remote Jobs &amp; Career Advice</title><link>${base}</link>
<description>Latest remote job listings and career articles from JobForion</description>
<atom:link href="${base}/feed.rss" rel="self" type="application/rss+xml"/>
${jobItems}${articleItems}</channel></rss>`, { headers: { "Content-Type": "application/rss+xml" } });
  }

  return null;
}
