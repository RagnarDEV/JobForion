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

import { ensureTable, ensureAccountTables } from './db/schema.js';
import { recordVisit } from './db/analytics.js';
import { syncJobs } from './db/sync.js';
import { cleanupStaleJobs } from './db/cleanup.js';
import { BASE_URL } from './config/constants.js';
import { getSettings } from './lib/settings.js';
import { renderMaintenancePage } from './pages/maintenance.js';
import { runBlogGeneration } from './lib/blog-automation/generator.js';
import { runBlogExpirationCleanup } from './lib/blog-automation/expiration.js';

import { handleAssetsRoute, ASSET_PATHS } from './routes/assets.router.js';
import { handleFeedRoute } from './routes/feed.router.js';
import { handleAdminRoute } from './routes/admin.router.js';
import { handleAuthRoute } from './routes/auth.router.js';
import { handleUserRoute } from './routes/user.router.js';
import { handleCompanyRoute } from './routes/company.router.js';
import { handleSeoPagesRoute } from './routes/seo-pages.router.js';
import { handlePagesRoute } from './routes/pages.router.js';
import { handleApiRoute } from './routes/api.router.js';

const NON_TRACKED_STATIC_PATHS = new Set([...ASSET_PATHS, '/feed.rss']);

// ════════════════════════════════════════════════════════════════
// SECURITY HEADERS — applied to every response this Worker returns
// (assets, sitemaps, admin, pages, SEO directories, API, 404). Cheap,
// site-wide, and this is the single place they ever need to change.
//
// CSP NOTE (read before tightening further): this Content-Security-Policy
// allows 'unsafe-inline' for script-src and style-src. That's a real,
// deliberate trade-off — the codebase currently relies heavily on inline
// <script>/<style> blocks (the homepage SPA, nav toggle, job-page save/
// copy buttons, the admin shell, the Google Analytics snippet itself).
// A strict nonce-based CSP that removes 'unsafe-inline' would need every
// one of those inline blocks converted to external files or given a
// per-request nonce threaded through the whole render pipeline — a much
// larger refactor than a header change. What this CSP still meaningfully
// blocks: any injected/loaded script, stylesheet, font, image, or frame
// from a domain NOT in this explicit allow-list, which is real defense
// in depth against a successful injection trying to pull in attacker-
// controlled external resources. The allow-list below is exactly the set
// of third-party origins this site actually loads from — Google
// Analytics, Google Fonts, Adsterra ads, and the two favicon services
// used for company logos (job-card.js/home.js).
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://www.highperformanceformat.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' https://www.google.com https://icons.duckduckgo.com https://www.google-analytics.com",
    "connect-src 'self' https://www.google-analytics.com https://analytics.google.com",
    "frame-src https://www.highperformanceformat.com",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
  ].join('; '),
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Permanent 301 redirect from any retired domain to the current canonical
// one (BASE_URL, in src/config/constants.js). Required for Google's
// "Change of Address" verification, which checks that the old domain
// actually forwards visitors — not just that it's abandoned — and it also
// prevents duplicate-content indexing if the old host is ever reachable
// again. Add any other retired hostnames to this set as domains change.
const RETIRED_HOSTS = new Set(['jobnova.manasa.workers.dev', 'jobnova.sryze.cc', 'jobforion.manasa.workers.dev']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Retired domain? Redirect permanently before touching D1 or anything
    // else — this must work even if the database is having a bad day.
    if (RETIRED_HOSTS.has(url.hostname)) {
      return withSecurityHeaders(Response.redirect(`${BASE_URL}${url.pathname}${url.search}`, 301));
    }

    const base = `${url.protocol}//${url.host}`;
    await ensureTable(env);
    await ensureAccountTables(env);

    // ── static brand assets (favicons, manifest, robots.txt) ──
    const assetResponse = handleAssetsRoute(url, base);
    if (assetResponse) return withSecurityHeaders(assetResponse);

    // ── maintenance mode (toggled from /admin/settings, no redeploy) ──
    // /admin/* is always exempt — otherwise a site owner who enables
    // maintenance mode could lock themselves out of the one place that
    // can turn it back off. Static assets are already handled above (so
    // the maintenance page itself still gets its favicon/branding).
    let settingsForRequest = null;
    if (!url.pathname.startsWith('/admin')) {
      settingsForRequest = await getSettings(env);
      if (settingsForRequest.maintenance_mode === '1') {
        return withSecurityHeaders(renderMaintenancePage(settingsForRequest.site_name, settingsForRequest.maintenance_message));
      }
    }

    // ── Feature Flags (Admin Dashboard V2) ──────────────────────────
    // First concrete example of flag ENFORCEMENT (not just storage — see
    // lib/settings.js for the full flag list and rollout plan): when an
    // admin turns "Blog" off from /admin/settings, the blog index and
    // every article 404 immediately, site-wide, no redeploy. /admin/blog
    // itself stays reachable so content can still be edited while the
    // public section is switched off.
    if (settingsForRequest && settingsForRequest.feature_blog === '0' &&
        (url.pathname === '/blog' || url.pathname.startsWith('/blog/'))) {
      return withSecurityHeaders(new Response('Not found', { status: 404 }));
    }

    // ── visitor analytics (best-effort, non-blocking) ──
    const trackable = ['GET'].includes(request.method) &&
      !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/admin') &&
      !url.pathname.startsWith('/sitemap') &&
      !NON_TRACKED_STATIC_PATHS.has(url.pathname);
    if (trackable && ctx?.waitUntil) ctx.waitUntil(recordVisit(env, request, url));

    // ── sitemap index + its child sitemaps / feed.rss ──
    // Use the canonical BASE_URL for feeds to ensure Google Search Console consistency
    const feedResponse = await handleFeedRoute(url, env, BASE_URL, ctx);
    if (feedResponse) return withSecurityHeaders(feedResponse);

    // ── /admin/* ──
    const adminResponse = await handleAdminRoute(url, request, env, base);
    if (adminResponse) return withSecurityHeaders(adminResponse);

    // ── Accounts: auth (/login /register /logout /forgot-password
    // /reset-password /verify-email), /user/*, /company/* ──────────
    const authResponse = await handleAuthRoute(url, request, env, base);
    if (authResponse) return withSecurityHeaders(authResponse);

    const userResponse = await handleUserRoute(url, request, env, base);
    if (userResponse) return withSecurityHeaders(userResponse);

    const companyResponse = await handleCompanyRoute(url, request, env, base);
    if (companyResponse) return withSecurityHeaders(companyResponse);

    // ── core content: job / blog / static / home ──
    const pageResponse = await handlePagesRoute(url, request, env, base);
    if (pageResponse) return withSecurityHeaders(pageResponse);

    // ── programmatic SEO: categories / companies / skills / search ──
    const seoResponse = await handleSeoPagesRoute(url, request, env, ctx, base);
    if (seoResponse) return withSecurityHeaders(seoResponse);

    // ── JSON API ──
    const apiResponse = await handleApiRoute(url, request, env);
    if (apiResponse) return withSecurityHeaders(apiResponse);

    return withSecurityHeaders(new Response('Not found', { status: 404 }));
  },

  async scheduled(event, env, ctx) {
    // Three cron patterns share this one handler (Cloudflare Workers only
    // supports a single scheduled() export) — event.cron tells us which
    // one fired. See wrangler.toml:
    //   "0 */6 * * *"  → job sync (every 6 hours)
    //   "0 3 * * *"    → daily job cleanup + blog expiration cleanup
    //   "0 9 * * *"    → daily blog generation check (Blog Automation —
    //                    see src/lib/blog-automation/generator.js; the
    //                    function itself decides, from D1 settings,
    //                    whether today is actually a scheduled publishing
    //                    day and whether the weekly cap is already hit,
    //                    so this cron firing daily does NOT mean an
    //                    article is generated every single day)
    if (event.cron === '0 3 * * *') {
      ctx.waitUntil(cleanupStaleJobs(env));
      ctx.waitUntil(runBlogExpirationCleanup(env));
    } else if (event.cron === '0 9 * * *') {
      ctx.waitUntil(runBlogGeneration(env, { ctx }));
    } else {
      ctx.waitUntil(syncJobs(env));
    }
  }
};
