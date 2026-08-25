// src/routes/assets.router.js
// Self-hosted brand assets — favicons, web manifest, robots.txt.
// No D1 access, no auth, purely static/derived responses.

import { FAVICON_SVG, FAVICON_ICO_B64, FAVICON_32_B64, FAVICON_16_B64, APPLE_TOUCH_B64, ICON512_B64, b64ToBytes } from '../assets/favicon.js';
import { manifestJson } from '../assets/manifest.js';
import { BASE_URL } from '../config/constants.js';

export const ASSET_PATHS = ['/favicon.svg', '/favicon.ico', '/favicon-32.png', '/favicon-16.png', '/apple-touch-icon.png', '/icon-512.png', '/manifest.json', '/robots.txt'];

// ── R2-backed company logo/cover fallback (Company System, Stage 3) ──
// company.router.js's /company/logo and /company/cover uploads link to
// `${R2_PUBLIC_BASE_URL}/<key>` when that secret is configured (the
// bucket's own public r2.dev domain or a custom domain — the fast path,
// serves directly from Cloudflare's edge with zero Worker involvement).
// This route exists purely as a fallback for the moment BEFORE that
// secret is set: an image just uploaded still needs to resolve to
// *something* other than a 404, so the URL falls back to
// `/r2-asset/<key>` and THIS Worker streams it straight from the
// COMPANY_ASSETS bucket. Setting R2_PUBLIC_BASE_URL later is purely a
// performance upgrade — no re-upload or code change needed, since old
// `/r2-asset/...` links keep working here indefinitely.
export async function handleR2AssetRoute(url, env) {
  if (!url.pathname.startsWith('/r2-asset/')) return null;
  if (!env.COMPANY_ASSETS) return new Response('Not found', { status: 404 });
  let key;
  try { key = decodeURIComponent(url.pathname.slice('/r2-asset/'.length)); } catch (e) { return new Response('Not found', { status: 404 }); }
  // Defense in depth: this key space is only ever written by
  // company.router.js under the fixed `companies/<id>/<kind>-<ts>.<ext>`
  // shape, so reject anything containing `..` or starting outside that
  // prefix rather than trusting the path segment as a free-form R2 key.
  if (!key || key.length > 180 || key.includes('..') || !/^companies\/\d+\/(?:logo|cover)-\d+\.(?:png|jpg|webp)$/.test(key)) return new Response('Not found', { status: 404 });
  try {
    const object = await env.COMPANY_ASSETS.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable', // filename is timestamped/unique per upload — safe to cache forever
      },
    });
  } catch (e) {
    return new Response('Not found', { status: 404 });
  }
}

// Returns a Response if this router owns the path, otherwise null (caller tries the next router).
export function handleAssetsRoute(url, base) {
  if (url.pathname === '/favicon.svg') {
    return new Response(FAVICON_SVG, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=604800" } });
  }
  if (url.pathname === '/favicon.ico') {
    return new Response(b64ToBytes(FAVICON_ICO_B64), { headers: { "Content-Type": "image/x-icon", "Cache-Control": "public, max-age=604800" } });
  }
  if (url.pathname === '/favicon-32.png') {
    return new Response(b64ToBytes(FAVICON_32_B64), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
  }
  if (url.pathname === '/favicon-16.png') {
    return new Response(b64ToBytes(FAVICON_16_B64), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
  }
  if (url.pathname === '/apple-touch-icon.png') {
    return new Response(b64ToBytes(APPLE_TOUCH_B64), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
  }
  if (url.pathname === '/icon-512.png') {
    return new Response(b64ToBytes(ICON512_B64), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
  }
  if (url.pathname === '/manifest.json') {
    return new Response(manifestJson(base), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=86400" } });
  }
  if (url.pathname === '/robots.txt') {
    // Sitemap URL is derived from BASE_URL (config/constants.js) — the
    // single source of truth for the site's canonical domain — instead of
    // being hardcoded here. If the domain ever changes again, this stays
    // correct automatically with zero edits needed in this file.
    const robots = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${BASE_URL}/sitemap.xml`;
    return new Response(robots, { headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400" } });
  }
  return null;
}
