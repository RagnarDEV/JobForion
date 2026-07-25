// src/lib/cache.js
// ════════════════════════════════════════════════════════════════
// Thin wrapper around the Workers Cache API for GET-only, publicly
// cacheable pages (directory/listing pages built from aggregate D1
// queries). Never used for /admin, /api/*, or anything personalized.
// ════════════════════════════════════════════════════════════════

export const CACHE_PRESETS = {
  directory: "public, max-age=300, s-maxage=1800",   // companies/countries/cities/skills lists
  entity: "public, max-age=600, s-maxage=3600",       // a single company/city/skill page
  feed: "public, max-age=900, s-maxage=1800",         // sitemap.xml / feed.rss
  static: "public, max-age=86400, s-maxage=604800",   // favicons, manifest
};

async function weakEtag(text) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', enc);
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `W/"${hex.slice(0, 16)}"`;
}

// Wraps an expensive HTML-generating function with Cache API + ETag.
// `keyRequest` should be the incoming Request (its URL is the cache key).
export async function withCache(cacheCtx, keyRequest, cacheControl, generate) {
  const hasCacheApi = typeof caches !== 'undefined' && caches?.default;
  if (!hasCacheApi) {
    // Cache API unavailable in this runtime — degrade gracefully to a
    // plain (uncached) response instead of throwing. Cloudflare Workers
    // always provides `caches.default` in production.
    const html = await generate();
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cacheControl } });
  }
  const cache = caches.default;
  const cached = await cache.match(keyRequest);
  if (cached) return cached;

  const html = await generate();
  const etag = await weakEtag(html);
  const response = new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
      "ETag": etag,
    }
  });
  if (cacheCtx?.waitUntil) {
    cacheCtx.waitUntil(cache.put(keyRequest, response.clone()));
  }
  return response;
}

// For conditional GETs on non-cached-by-Cache-API responses (e.g. sitemap).
export function withEtagHeaders(body, request, contentType, cacheControl) {
  return weakEtag(body).then(etag => {
    const ifNoneMatch = request.headers.get('If-None-Match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: { "ETag": etag, "Cache-Control": cacheControl } });
    }
    return new Response(body, {
      headers: { "Content-Type": contentType, "Cache-Control": cacheControl, "ETag": etag }
    });
  });
}
