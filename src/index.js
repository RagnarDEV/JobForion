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
import { renderNotFoundPage } from './pages/public-content.js';
import { runBlogGeneration } from './lib/blog-automation/generator.js';
import { runBlogExpirationCleanup } from './lib/blog-automation/expiration.js';
import { runJobAlertsDispatch } from './lib/job-alerts-dispatcher.js';
import { expireMonetizationCampaigns } from './lib/monetization.js';
import { aggregateAnalytics, cleanupAnalytics, evaluateAnalyticsAlerts } from './lib/analytics.js';

import { handleAssetsRoute, handleR2AssetRoute, ASSET_PATHS } from './routes/assets.router.js';
import { handleLogoProxyRoute } from './lib/logo-proxy.js';
import { handleFeedRoute } from './routes/feed.router.js';
import { handleAdminRoute } from './routes/admin.router.js';
import { handleAuthRoute } from './routes/auth.router.js';
import { handleUserRoute } from './routes/user.router.js';
import { handleCompanyRoute } from './routes/company.router.js';
import { handleSeoPagesRoute } from './routes/seo-pages.router.js';
import { handlePagesRoute } from './routes/pages.router.js';
import { handleApiRoute } from './routes/api.router.js';

const NON_TRACKED_STATIC_PATHS = new Set([...ASSET_PATHS, '/feed.rss']);
const LOGO_PROXY_PREFIX = '/logo/';

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
// Analytics, Google Fonts, Adsterra ads, and Cloudflare R2's default
// public `*.r2.dev` domain (company logo/cover uploads — see
// company.router.js + routes/assets.router.js's handleR2AssetRoute).
// Company logo favicons are NOT in this list on purpose: lib/logo-proxy.js
// fetches those Worker-side (edge -> Google) and serves them from our own
// origin at /logo/<slug>.png, so the visitor's browser never contacts
// Google directly for a logo — no img-src entry needed for that path. If
// R2_PUBLIC_BASE_URL is later pointed at a CUSTOM domain instead of the
// default r2.dev one, that domain must be added to img-src below too, or
// uploaded company images will render broken (silently blocked, not a
// server error) on every page that shows them.
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
    "img-src 'self' https://www.google-analytics.com https://*.r2.dev",
    "connect-src 'self' https://www.google-analytics.com https://analytics.google.com",
    "frame-src https://www.highperformanceformat.com",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
  ].join('; '),
};

function withSecurityHeaders(response, env = null) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  // Uploaded logos may use the configured public R2 domain instead of the
  // Worker proxy. Add only that validated origin to img-src; never widen the
  // policy to arbitrary external image hosts.
  const publicBase = String(env?.R2_PUBLIC_BASE_URL || '').trim();
  if (publicBase) {
    try {
      const origin = new URL(publicBase).origin;
      if (['http:', 'https:'].includes(new URL(publicBase).protocol)) {
        const csp = headers.get('Content-Security-Policy') || '';
        headers.set('Content-Security-Policy', csp.replace('https://*.r2.dev', `https://*.r2.dev ${origin}`));
      }
    } catch (e) {}
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Permanent 301 redirect from any retired domain to the current canonical
// one (BASE_URL, in src/config/constants.js). Required for Google's
// "Change of Address" verification, which checks that the old domain
// actually forwards visitors — not just that it's abandoned — and it also
// prevents duplicate-content indexing if the old host is ever reachable
// again. Add any other retired hostnames to this set as domains change.
const RETIRED_HOSTS = new Set(['jobnova.manasa.workers.dev', 'jobnova.sryze.cc', 'jobforion.manasa.workers.dev']);

// ════════════════════════════════════════════════════════════════
// LAST-RESORT SAFETY NET — see the big try/catch around the whole
// fetch() body below. This function is the one thing standing between
// a future uncaught bug and Cloudflare's raw, unbranded "Error 1101 —
// Worker threw exception" screen (exactly what took the entire site
// down site-wide: see the fix in db/schema.js's ensureAiTables() for
// the actual root cause of that specific incident). Because this
// renders when something has ALREADY gone wrong — possibly D1 itself —
// it is deliberately 100% self-contained: no imports, no D1 reads, no
// template composition from other modules. It must be structurally
// incapable of throwing itself.
function renderFallbackErrorPage() {
  return new Response(
    `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>عذراً، حدث خطأ مؤقت — JobForion</title><meta name="robots" content="noindex, nofollow">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;background:#F6F7FB;color:#12162B;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;line-height:1.7}
.box{background:#fff;border:1px solid #E6E9F0;border-radius:18px;padding:40px 32px;max-width:460px;width:100%;text-align:center;box-shadow:0 16px 40px rgba(18,22,43,.10)}
.mark{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#2563EB,#7C3AED);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:22px;font-weight:800;color:#fff}
h1{font-size:19px;font-weight:800;margin-bottom:10px}
p{font-size:14px;color:#525A72;margin-bottom:22px}
a{display:inline-flex;align-items:center;gap:8px;background:#2563EB;color:#fff;padding:11px 24px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none}
a:hover{background:#1d4fd6}
</style></head><body>
<div class="box">
<div class="mark">JF</div>
<h1>عذراً، حدث خطأ مؤقت</h1>
<p>واجه الموقع مشكلة غير متوقعة أثناء تحميل هذه الصفحة. فريقنا تم إعلامه تلقائياً. الرجاء إعادة المحاولة خلال لحظات.</p>
<a href="/">العودة إلى الصفحة الرئيسية</a>
</div>
</body></html>`,
    { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

const CRON_LEASE_MS = 10 * 60 * 1000;
async function withCronLease(env, name, task) {
  await ensureTable(env);
  await ensureAccountTables(env);
  const key = `_cron_lock_${String(name).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)}`;
  const now = Date.now();
  let acquired = false;
  try {
    const result = await env.DB.prepare(`
      INSERT INTO site_settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP
      WHERE CAST(site_settings.value AS INTEGER) < ?
    `).bind(key, String(now), String(now - CRON_LEASE_MS)).run();
    acquired = Number(result?.meta?.changes || 0) === 1;
    if (!acquired) return { skipped: true };
    return await task();
  } finally {
    if (acquired) {
      try { await env.DB.prepare('DELETE FROM site_settings WHERE key = ?').bind(key).run(); } catch (e) {}
    }
  }
}

async function handleFetch(request, env, ctx) {
    const url = new URL(request.url);

    // Retired domain? Redirect permanently before touching D1 or anything
    // else — this must work even if the database is having a bad day.
    if (RETIRED_HOSTS.has(url.hostname)) {
      return withSecurityHeaders(Response.redirect(`${BASE_URL}${url.pathname}${url.search}`, 301), env);
    }

    const base = `${url.protocol}//${url.host}`;

    // ── static brand assets (favicons, manifest, robots.txt) ──
    const assetResponse = handleAssetsRoute(url, base);
    if (assetResponse) return withSecurityHeaders(assetResponse, env);

    // ── R2-backed company logo/cover images (Company System, Stage 3) ──
    const r2Response = await handleR2AssetRoute(url, env);
    if (r2Response) return withSecurityHeaders(r2Response, env);

    // ── automatic company logo proxy (see lib/logo-proxy.js) — no D1,
    // no auth, pure fetch-and-edge-cache, so it runs before ensureTable ──
    if (url.pathname.startsWith(LOGO_PROXY_PREFIX)) {
      const logoResponse = await handleLogoProxyRoute(url, ctx);
      if (logoResponse) return withSecurityHeaders(logoResponse, env);
    }

    // D1 schema bootstrap is needed by settings, feeds, admin, accounts and
    // content routes, but not by static/R2/logo requests handled above.
    await ensureTable(env);
    await ensureAccountTables(env);

    // ── maintenance mode (toggled from /admin/settings, no redeploy) ──
    // /admin/* is always exempt — otherwise a site owner who enables
    // maintenance mode could lock themselves out of the one place that
    // can turn it back off. Static assets are already handled above (so
    // the maintenance page itself still gets its favicon/branding).
    let settingsForRequest = null;
    if (!url.pathname.startsWith('/admin')) {
      settingsForRequest = await getSettings(env);
      if (settingsForRequest.maintenance_mode === '1') {
        return withSecurityHeaders(renderMaintenancePage(settingsForRequest.site_name, settingsForRequest.maintenance_message), env);
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
      return withSecurityHeaders(new Response('Not found', { status: 404 }), env);
    }

    // ── visitor analytics (best-effort, non-blocking) ──
    const trackable = ['GET'].includes(request.method) &&
      !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/admin') &&
      !url.pathname.startsWith('/sitemap') && !url.pathname.startsWith('/r2-asset/') &&
      !url.pathname.startsWith(LOGO_PROXY_PREFIX) &&
      !NON_TRACKED_STATIC_PATHS.has(url.pathname);
    if (trackable && ctx?.waitUntil) ctx.waitUntil(recordVisit(env, request, url, settingsForRequest || {}));

    // ── sitemap index + its child sitemaps / feed.rss ──
    // Use the canonical BASE_URL for feeds to ensure Google Search Console consistency
    const feedResponse = await handleFeedRoute(url, env, BASE_URL, ctx);
    if (feedResponse) return withSecurityHeaders(feedResponse, env);

    // ── /admin/* ──
    const adminResponse = await handleAdminRoute(url, request, env, base);
    if (adminResponse) return withSecurityHeaders(adminResponse, env);

    // ── Accounts: auth (/login /register /logout /forgot-password
    // /reset-password /verify-email), /user/*, /company/* ──────────
    const authResponse = await handleAuthRoute(url, request, env, base, ctx);
    if (authResponse) return withSecurityHeaders(authResponse, env);

    const userResponse = await handleUserRoute(url, request, env, base);
    if (userResponse) return withSecurityHeaders(userResponse, env);

    const companyResponse = await handleCompanyRoute(url, request, env, base);
    if (companyResponse) return withSecurityHeaders(companyResponse, env);

    // ── core content: job / blog / static / home ──
    const pageResponse = await handlePagesRoute(url, request, env, base);
    if (pageResponse) return withSecurityHeaders(pageResponse, env);

    // ── programmatic SEO: categories / companies / skills / search ──
    const seoResponse = await handleSeoPagesRoute(url, request, env, ctx, base);
    if (seoResponse) return withSecurityHeaders(seoResponse, env);

    // ── JSON API ──
    const apiResponse = await handleApiRoute(url, request, env, ctx);
    if (apiResponse) return withSecurityHeaders(apiResponse, env);

    try {
      return withSecurityHeaders(new Response(await renderNotFoundPage(base, env), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }), env);
    } catch (e) {
      console.error('[404 page] render failed:', e && e.stack || e);
      return withSecurityHeaders(renderFallbackErrorPage(), env);
    }
}

export default {
  // ════════════════════════════════════════════════════════════════
  // TOP-LEVEL SAFETY NET: this is the ONLY place in the whole request
  // lifecycle allowed to let an exception through un-caught before this
  // fix — meaning any bug, anywhere in any router/page/lib module, took
  // down every single page on the site with Cloudflare's raw "Error
  // 1101" screen (see db/schema.js's ensureAiTables() for the real bug
  // that actually caused this in production, now fixed). This wrapper
  // does NOT change behavior for any successful request — it only
  // changes what a visitor sees when something goes wrong, replacing a
  // dead-end error screen with a branded, friendly fallback. The full
  // error and stack trace are still logged via console.error, so
  // `wrangler tail` / the Cloudflare dashboard's Workers Logs continue
  // to show the exact cause for debugging.
  async fetch(request, env, ctx) {
    try {
      return await handleFetch(request, env, ctx);
    } catch (e) {
      console.error('[fetch] unhandled exception:', e && e.stack || e);
      try {
        return withSecurityHeaders(renderFallbackErrorPage(), env);
      } catch (e2) {
        // withSecurityHeaders/renderFallbackErrorPage are static and
        // dependency-free by design, but as an absolute last resort if
        // even this fails, return the plainest possible valid Response
        // rather than let anything propagate to the runtime.
        return new Response('Service temporarily unavailable. Please try again shortly.', { status: 500 });
      }
    }
  },

  async scheduled(event, env, ctx) {
    // Four cron patterns share this one handler (Cloudflare Workers only
    // supports a single scheduled() export) — event.cron tells us which
    // one fired. See wrangler.toml:
    //   "0 */6 * * *"  → job sync (every 6 hours)
    //   "0 3 * * *"    → daily job cleanup + blog expiration cleanup
    //   "0 8 * * *"    → daily Job Alerts dispatch — see
    //                    src/lib/job-alerts-dispatcher.js; each alert's
    //                    own frequency (daily/weekly/instant) and
    //                    last_notified_at decide whether it's actually
    //                    due, so this firing daily does NOT mean every
    //                    alert gets emailed every day.
    //   "0 9 * * *"    → daily blog generation check (Blog Automation —
    //                    see src/lib/blog-automation/generator.js; the
    //                    function itself decides, from D1 settings,
    //                    whether today is actually a scheduled publishing
    //                    day and whether the weekly cap is already hit,
    //                    so this cron firing daily does NOT mean an
    //                    article is generated every single day)
    if (event.cron === '15 * * * *') {
      // Keep this sequence in one waitUntil chain. Cleanup must never race
      // aggregation and delete queue rows before they are processed.
      ctx.waitUntil(withCronLease(env, 'analytics', async () => {
        await aggregateAnalytics(env);
        const settings = await getSettings(env);
        await cleanupAnalytics(env, settings.analytics_retention);
        await evaluateAnalyticsAlerts(env, settings);
      }).catch(() => {}));
    } else if (event.cron === '0 3 * * *') {
      ctx.waitUntil(withCronLease(env, 'daily-maintenance', async () => {
        await Promise.all([cleanupStaleJobs(env), runBlogExpirationCleanup(env), expireMonetizationCampaigns(env)]);
      }).catch(() => {}));
    } else if (event.cron === '0 8 * * *') {
      ctx.waitUntil(withCronLease(env, 'job-alerts', () => runJobAlertsDispatch(env)).catch(() => {}));
    } else if (event.cron === '0 9 * * *') {
      ctx.waitUntil(withCronLease(env, 'blog-generation', () => runBlogGeneration(env, { ctx })).catch(() => {}));
    } else if (event.cron === '0 */6 * * *') {
      ctx.waitUntil(withCronLease(env, 'job-sync', () => syncJobs(env)).catch(() => {}));
    }
  }
};
