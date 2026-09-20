// src/lib/platform/cache.js
// ════════════════════════════════════════════════════════════════
// Thin wrapper around the Workers Cache API for GET-only, publicly
// cacheable pages (directory/listing pages built from aggregate D1
// queries). Never used for /admin, /api/*, or anything personalized.
// ════════════════════════════════════════════════════════════════

export const CACHE_PRESETS = {
  directory: "public, max-age=300, s-maxage=1800",   // companies/countries/cities/skills lists
  entity: "public, max-age=120, s-maxage=600",        // a single company/country/skill/category page
  job: "public, max-age=60, s-maxage=300",            // a single job page (anonymous visitors only)
  search: "public, max-age=60, s-maxage=300",         // /search/:q and /jobs listings (anonymous visitors only)
  feed: "public, max-age=900, s-maxage=1800",         // sitemap.xml / feed.rss
  static: "public, max-age=86400, s-maxage=604800",   // favicons, manifest
};

async function weakEtag(text) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', enc);
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `W/"${hex.slice(0, 16)}"`;
}

// Builds a NORMALISED cache key: origin + pathname + ONLY the whitelisted
// query parameters (sorted, length-capped). Without this, "?x=1", "?x=2", … each
// create a fresh cache entry that misses and runs the full D1 render — an
// unbounded cost-amplification vector. Unknown params never affect the key.
export function normalizedCacheKey(request, allowedParams = []) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const name of [...allowedParams].sort()) {
    const value = url.searchParams.get(name);
    if (value) params.set(name, value.slice(0, 200));
  }
  const qs = params.toString();
  return new Request(`${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`, { method: 'GET' });
}

// Wraps an expensive HTML-generating function with Cache API + ETag.
// `keyRequest` should be the incoming Request (its URL is the cache key).
//
// options:
//   allowedParams — whitelist of query params that are part of the cache key
//                   (strongly recommended; see normalizedCacheKey()).
//   guard         — async () => Response|null, run ONLY on a cache miss (e.g.
//                   a rate limiter, so cache hits never cost a D1 write). A
//                   returned Response is served as-is and never cached.
//   onEmpty       — () => Response, used when generate() returns null/undefined
//                   (e.g. unknown slug → 404). Never cached.
export async function withCache(cacheCtx, keyRequest, cacheControl, generate, options = {}) {
  const key = options.allowedParams ? normalizedCacheKey(keyRequest, options.allowedParams) : keyRequest;
  const hasCacheApi = typeof caches !== 'undefined' && caches?.default;
  const cache = hasCacheApi ? caches.default : null;
  if (cache) {
    const cached = await cache.match(key);
    if (cached) return cached;
  }
  if (options.guard) {
    const blocked = await options.guard();
    if (blocked) return blocked;
  }
  const html = await generate();
  if (html === null || html === undefined) {
    return options.onEmpty ? options.onEmpty() : new Response('Not found', { status: 404 });
  }
  if (!cache) {
    // Cache API unavailable in this runtime — degrade gracefully to a
    // plain (uncached) response instead of throwing.
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cacheControl } });
  }
  const etag = await weakEtag(html);
  const response = new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
      "ETag": etag,
    }
  });
  if (cacheCtx?.waitUntil) {
    cacheCtx.waitUntil(cache.put(key, response.clone()));
  }
  return response;
}

// Low-level edge-cache helpers for routes that build their own Response
// (e.g. the job page: 404/410 branches must never be cached, only the 200).
export async function readEdgeCache(key) {
  try {
    if (typeof caches === 'undefined' || !caches?.default) return null;
    return (await caches.default.match(key)) || null;
  } catch (e) { return null; }
}

export function writeEdgeCache(cacheCtx, key, response) {
  try {
    if (typeof caches === 'undefined' || !caches?.default || !cacheCtx?.waitUntil) return;
    cacheCtx.waitUntil(caches.default.put(key, response.clone()).catch(() => {}));
  } catch (e) { /* cache is an optimisation only */ }
}

