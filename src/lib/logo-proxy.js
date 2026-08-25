// src/lib/logo-proxy.js
// ════════════════════════════════════════════════════════════════
// Automatic company logo resolution — the missing piece that made
// job/company cards fall back to bare initials for every company that
// doesn't have an admin/employer-set `logo_url` (i.e. almost every
// company synced from an ATS provider — thousands of them).
//
// WHY THIS EXISTS (regression context): job-card.js's logoImgHtml() and
// home.js's client-side logoHtml() were both deliberately changed to stop
// requesting https://www.google.com/s2/favicons?domain=... directly from
// the VISITOR'S browser — a legitimate privacy call, since that leaks the
// visitor's IP/User-Agent to Google on every single job card render. But
// nothing replaced it, so real logos stopped appearing anywhere on the
// site. This module restores automatic logos WITHOUT reintroducing that
// privacy leak: the favicon lookup happens Worker-side (Cloudflare edge
// -> Google), never browser-side, and the result is cached at Cloudflare's
// edge (same Cache API pattern already used for sitemap.xml in
// feed.router.js) so any given company is fetched from Google at most
// once per cache window, not once per pageview.
//
// Priority order actually rendered on a card (see job-card.js):
//   1. Admin/employer-set logo (companies.logo_url / company_logos table)
//   2. This proxy's best-effort guessed brand favicon  <-- this file
//   3. Monogram initials (final fallback, always safe, zero network)
// ════════════════════════════════════════════════════════════════

import { slugify } from './entities.js';

const FAVICON_SIZE = 128;
const FETCH_TIMEOUT_MS = 4000;
const EDGE_CACHE_CONTROL = 'public, max-age=2592000, s-maxage=2592000'; // 30 days — a company's logo essentially never changes
const NEGATIVE_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400'; // 1 day — retry sooner if the guess failed (name normalized differently later, transient network blip, etc.)

// Route shape: /logo/<slugified-company-name>.png — the slug is derived
// the same way on both the server (this file) and the client (home.js's
// inline JS) so a given company always maps to the same cache key.
function websiteHostname(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//')) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol) || !host || host === 'localhost' || host.endsWith('.local') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return '';
    return host.slice(0, 253);
  } catch (e) { return ''; }
}

export function logoProxyPath(companyName, website = '') {
  const slug = slugify(companyName);
  if (!slug || slug === 'na') return null;
  const domain = websiteHostname(website);
  return domain ? `/logo/${slug}.png?domain=${encodeURIComponent(domain)}` : `/logo/${slug}.png`;
}

// Best-effort domain guess from a free-text company name. Deliberately
// simple (strip everything but letters/digits, append .com) — this is the
// same heuristic every "auto logo" job board uses, and it resolves
// correctly for the overwhelming majority of real companies (google,
// slack, notion, airbnb, shopify, spotify, ...). It will occasionally
// guess wrong for oddly-named or non-.com companies; that's an acceptable
// trade-off given the alternative is showing nothing at all, and any
// individual company can still be corrected permanently via
// /admin/companies or the employer's own dashboard (which always takes
// priority over this guess — see priority order above).
function guessDomain(companyName) {
  const cleaned = String(companyName || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|gmbh|plc)\.?\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
  return cleaned ? `${cleaned}.com` : null;
}

function slugFromPath(pathname) {
  const m = pathname.match(/^\/logo\/([a-z0-9-]{1,80})\.png$/);
  return m ? m[1] : null;
}

function domainFromUrl(url, slug) {
  const candidate = String(url.searchParams.get('domain') || '').toLowerCase().trim();
  if (/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(candidate) && candidate.includes('.') && !candidate.includes('..') && !candidate.endsWith('.local')) return candidate;
  return guessDomain(slug);
}

// Reverse of the slug isn't recoverable in general (slugify is lossy), so
// the proxy re-derives the *domain guess* straight from the slug itself
// rather than needing the original company name — slugify() and this
// function both boil a name down to alphanumerics, so guessDomain(slug)
// and guessDomain(originalName) land on the same result in practice.
async function fetchFaviconBytes(domain) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${FAVICON_SIZE}`,
      { signal: controller.signal, headers: { 'User-Agent': 'JobForion-LogoProxy/1.0' } }
    );
    if (!res.ok) return null;
    const contentType = res.headers.get('Content-Type') || '';
    if (!contentType.startsWith('image/')) return null;
    const buf = await res.arrayBuffer();
    // Google always returns *some* bytes (a generic globe placeholder) even
    // for a domain guess with no real favicon — a real favicon is never
    // this tiny, so treat near-empty responses as "no logo found" and let
    // the card fall back to the monogram instead of caching a blank tile.
    if (buf.byteLength < 200) return null;
    return { bytes: buf, contentType };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Called from index.js before any D1 access — this route is pure
// fetch-and-cache and never touches the database, so it stays fast and
// cheap even under load.
export async function handleLogoProxyRoute(url, ctx) {
  const slug = slugFromPath(url.pathname);
  if (!slug) return null;

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const domain = domainFromUrl(url, slug);
  const found = domain ? await fetchFaviconBytes(domain) : null;

  if (!found) {
    // Cache the miss too (short TTL) — otherwise a company with no
    // resolvable domain gets a fresh Google round-trip on every single
    // pageview from every visitor, which is exactly the wasted-subrequest
    // pattern this codebase works hard to avoid elsewhere (see db/sync.js).
    const miss = new Response(null, { status: 404, headers: { 'Cache-Control': NEGATIVE_CACHE_CONTROL } });
    if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, miss.clone()));
    return miss;
  }

  const response = new Response(found.bytes, {
    headers: {
      'Content-Type': found.contentType,
      'Cache-Control': EDGE_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    },
  });
  if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
