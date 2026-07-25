// src/routes/feed.router.js
// sitemap.xml (built from live D1 data via src/lib/sitemap.js) + feed.rss
// (jobs + blog articles combined).

import { buildSitemapXml } from '../lib/sitemap.js';
import { BLOG_POSTS } from '../data/blog-posts.js';
import { CATEGORY_ORDER } from '../config/constants.js';

export async function handleFeedRoute(url, env, base, ctx) {
  if (url.pathname === '/sitemap.xml') {
    // PERFORMANCE + RELIABILITY: cache the built XML at Cloudflare's edge
    // for 1 hour. Without this, EVERY request (including repeated crawler
    // retries) rebuilds the sitemap from scratch via several D1 queries —
    // slow, and directly responsible for crawlers timing out on this
    // endpoint. Cache API storage is per-datacenter and separate from the
    // Cache-Control header (which only advises browsers/CDNs downstream,
    // it doesn't make Cloudflare itself cache a dynamic Worker response).
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    let xml;
    try {
      xml = await buildSitemapXml(env, base, { blogPosts: BLOG_POSTS, categoryOrder: CATEGORY_ORDER });
    } catch (e) {
      // CRITICAL: never let a D1 hiccup (timeout, transient error) turn into
      // Cloudflare's generic HTML "Worker threw exception" page — that is
      // exactly what makes Google report "couldn't fetch sitemap" even
      // though the rest of the site (lighter pages) works fine. Log the
      // real reason to Cloudflare's live logs (Observability tab) so it can
      // be diagnosed, but still answer with a valid, if minimal, sitemap so
      // Google always gets parseable XML back with a 200 status.
      console.error('[sitemap.xml] build failed:', e && e.stack || e);
      xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url></urlset>`;
    }
    // Defensive: some SEO validators reject the XML declaration unless it
    // is the literal first character of the response body. A stray BOM or
    // whitespace character (easy to pick up invisibly through copy/paste
    // across many edits) breaks that even when the source looks clean —
    // strip it here so the served bytes are guaranteed correct regardless.
    xml = xml.replace(/^\uFEFF/, '').trim();
    const response = new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      }
    });
    if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
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
