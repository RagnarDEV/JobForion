// src/index.js
// ════════════════════════════════════════════════════════════════
// JobForion — Cloudflare Worker entry point
//
// This file is intentionally thin: it owns request-level concerns only
// (table bootstrap, visitor tracking, router dispatch order) and delegates
// everything else to src/routes/*.js, which in turn delegate rendering to
// src/pages/*.js, src/components/*.js, and src/lib/*.js (programmatic SEO).
//
// Router dispatch order matters only in that more specific/cheaper routes
// run first; each router returns `null` if the path isn't its concern, so
// this composes safely — see src/routes/*.router.js for details.
// ════════════════════════════════════════════════════════════════

import { ensureTable } from './db/schema.js';
import { recordVisit } from './db/analytics.js';
import { syncJobs } from './db/sync.js';
import { cleanupStaleJobs } from './db/cleanup.js';
import { BASE_URL } from './config/constants.js';

import { handleAssetsRoute, ASSET_PATHS } from './routes/assets.router.js';
import { handleFeedRoute } from './routes/feed.router.js';
import { handleAdminRoute } from './routes/admin.router.js';
import { handleSeoPagesRoute } from './routes/seo-pages.router.js';
import { handlePagesRoute } from './routes/pages.router.js';
import { handleApiRoute } from './routes/api.router.js';

const NON_TRACKED_STATIC_PATHS = new Set([...ASSET_PATHS, '/sitemap.xml', '/feed.rss']);

// Permanent 301 redirect from any retired domain to the current canonical
// one (BASE_URL, in src/config/constants.js). Required for Google's
// "Change of Address" verification, which checks that the old domain
// actually forwards visitors — not just that it's abandoned — and it also
// prevents duplicate-content indexing if the old host is ever reachable
// again. Add any other retired hostnames to this set as domains change.
const RETIRED_HOSTS = new Set(['jobnova.manasa.workers.dev', 'jobnova.sryze.cc']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Retired domain? Redirect permanently before touching D1 or anything
    // else — this must work even if the database is having a bad day.
    if (RETIRED_HOSTS.has(url.hostname)) {
      return Response.redirect(`${BASE_URL}${url.pathname}${url.search}`, 301);
    }

    const base = `${url.protocol}//${url.host}`;
    await ensureTable(env);

    // ── static brand assets (favicons, manifest, robots.txt) ──
    const assetResponse = handleAssetsRoute(url, base);
    if (assetResponse) return assetResponse;

    // ── visitor analytics (best-effort, non-blocking) ──
    const trackable = ['GET'].includes(request.method) &&
      !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/admin') &&
      !NON_TRACKED_STATIC_PATHS.has(url.pathname);
    if (trackable && ctx?.waitUntil) ctx.waitUntil(recordVisit(env, request, url));

    // ── sitemap.xml / feed.rss ──
    // Use the canonical BASE_URL for feeds to ensure Google Search Console consistency
    const feedResponse = await handleFeedRoute(url, env, BASE_URL, ctx);
    if (feedResponse) return feedResponse;

    // ── /admin/* ──
    const adminResponse = await handleAdminRoute(url, request, env, base);
    if (adminResponse) return adminResponse;

    // ── core content: job / blog / static / home ──
    const pageResponse = await handlePagesRoute(url, request, env, base);
    if (pageResponse) return pageResponse;

    // ── programmatic SEO: categories / companies / skills / search ──
    const seoResponse = await handleSeoPagesRoute(url, request, env, ctx, base);
    if (seoResponse) return seoResponse;

    // ── JSON API ──
    const apiResponse = await handleApiRoute(url, request, env);
    if (apiResponse) return apiResponse;

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    // Two cron patterns share this one handler (Cloudflare Workers only
    // supports a single scheduled() export) — event.cron tells us which
    // one fired. See wrangler.toml: "0 */2 * * *" for sync, "0 3 * * *"
    // for the daily cleanup.
    if (event.cron === '0 3 * * *') {
      ctx.waitUntil(cleanupStaleJobs(env));
    } else {
      ctx.waitUntil(syncJobs(env));
    }
  }
};
