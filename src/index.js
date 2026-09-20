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

import { ensureAllSchema } from './db/schema.js';
import { recordVisit } from './db/telemetry.js';
import { BASE_URL } from './config/constants.js';
import { getSettings } from './lib/platform/settings.js';
import { renderMaintenancePage } from './pages/maintenance.js';
import { renderNotFoundPage } from './pages/public-content.js';
import { verifyAdminCookie } from './auth/admin-auth.js';

import { withSecurityHeaders } from './app/security-headers.js';
import { renderFallbackErrorPage } from './app/fallback-error.js';
import { runScheduled } from './app/cron.js';

import { handleAssetsRoute, handleR2AssetRoute, ASSET_PATHS } from './routes/assets.router.js';
import { handleLogoProxyRoute } from './lib/companies/logo-proxy.js';
import { handleFeedRoute } from './routes/feed.router.js';
import { handleAdminRoute } from './routes/admin.router.js';
import { handleAuthRoute } from './routes/auth.router.js';
import { handleUserRoute } from './routes/user.router.js';
import { handleCompanyRoute } from './routes/company.router.js';
import { handleSeoPagesRoute } from './routes/seo-pages.router.js';
import { handlePagesRoute, getCachedHomepage } from './routes/pages.router.js';
import { handleApiRoute } from './routes/api.router.js';

const NON_TRACKED_STATIC_PATHS = new Set([...ASSET_PATHS, '/feed.rss']);
const LOGO_PROXY_PREFIX = '/logo/';

// Permanent 301 redirect from any retired domain to the current canonical
// one (BASE_URL, in src/config/constants.js). Required for Google's
// "Change of Address" verification, which checks that the old domain
// actually forwards visitors — not just that it's abandoned — and it also
// prevents duplicate-content indexing if the old host is ever reachable
// again. Add any other retired hostnames to this set as domains change.
const RETIRED_HOSTS = new Set(['jobnova.manasa.workers.dev', 'jobnova.sryze.cc', 'jobforion.manasa.workers.dev']);

// Throttled (once per 5 min per isolate) so a persistent failure cannot itself
// burn the D1 budget by logging on every request.
let lastSchemaFailureLoggedAt = 0;
function logSchemaFailure(env, ctx, error) {
  const now = Date.now();
  if (now - lastSchemaFailureLoggedAt < 5 * 60 * 1000) return;
  lastSchemaFailureLoggedAt = now;
  try {
    const p = env.DB.prepare('INSERT INTO error_logs (path, message, stack) VALUES (?, ?, ?)')
      .bind('schema:bootstrap', String((error && error.message) || error || 'Unknown error').slice(0, 500), String((error && error.stack) || '').slice(0, 4000)).run().catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(p);
  } catch (e) { /* error_logs may not exist yet */ }
}

async function notFoundResponse(base, env) {
  try {
    return new Response(await renderNotFoundPage(base, env), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (e) {
    console.error('[404 page] render failed:', e && e.stack || e);
    return renderFallbackErrorPage();
  }
}

// Builds the response WITHOUT security headers — fetch() applies them exactly
// once for every branch (previously each branch wrapped its own response).
// `state` lets the router tell fetch() whether this request is a page view
// worth recording, so analytics only sees real 200 HTML pages (not 404 probes).
async function routeRequest(request, env, ctx, state) {
  const url = new URL(request.url);

  // Retired domain? Redirect permanently before touching D1 or anything
  // else — this must work even if the database is having a bad day.
  if (RETIRED_HOSTS.has(url.hostname)) {
    return Response.redirect(`${BASE_URL}${url.pathname}${url.search}`, 301);
  }

  const base = `${url.protocol}//${url.host}`;

  // ── static brand assets (favicons, manifest, robots.txt) ──
  const assetResponse = handleAssetsRoute(url, base);
  if (assetResponse) return assetResponse;

  // ── R2-backed company logo/cover images (Company System, Stage 3) ──
  const r2Response = await handleR2AssetRoute(url, env);
  if (r2Response) return r2Response;

  // ── automatic company logo proxy (see lib/companies/logo-proxy.js) — no D1,
  // no auth, pure fetch-and-edge-cache, so it runs before schema bootstrap ──
  if (url.pathname.startsWith(LOGO_PROXY_PREFIX)) {
    const logoResponse = await handleLogoProxyRoute(url, ctx);
    if (logoResponse) return logoResponse;
  }

  // A cached anonymous homepage can be served without touching D1. This is
  // intentionally checked before schema bootstrap so a D1 quota incident
  // does not take down the most important public entry point.
  const cachedHomepage = await getCachedHomepage(url, request);
  if (cachedHomepage) return cachedHomepage;

  // D1 schema bootstrap (persisted version gate — see db/schema.js). A failure
  // here must NOT take the whole site (including /admin, the place you repair
  // things from) down: it is logged (throttled) and the request continues —
  // pages guard their own reads, and the next request retries the bootstrap.
  try {
    await ensureAllSchema(env);
  } catch (e) {
    console.error('[schema] bootstrap failed:', e && e.stack || e);
    logSchemaFailure(env, ctx, e);
  }

  // ── maintenance mode (toggled from /admin/settings, no redeploy) ──
  // /admin/* is always exempt — otherwise a site owner who enables
  // maintenance mode could lock themselves out of the one place that
  // can turn it back off.
  let settingsForRequest = null;
  if (!url.pathname.startsWith('/admin')) {
    settingsForRequest = await getSettings(env);
    if (settingsForRequest.maintenance_mode === '1') {
      return renderMaintenancePage(settingsForRequest.site_name, settingsForRequest.maintenance_message);
    }
  }

  // ── Feature flags: an admin can switch the public blog off, site-wide ──
  if (settingsForRequest && settingsForRequest.feature_blog === '0' &&
      (url.pathname === '/blog' || url.pathname.startsWith('/blog/'))) {
    return new Response('Not found', { status: 404 });
  }

  // ── visitor analytics (best-effort, non-blocking) — decided here, recorded
  // by fetch() only if the final response is a 200 HTML page ──
  state.settings = settingsForRequest || {};
  state.trackable = request.method === 'GET' &&
    !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/admin') &&
    !url.pathname.startsWith('/sitemap') && !url.pathname.startsWith('/r2-asset/') &&
    !url.pathname.startsWith(LOGO_PROXY_PREFIX) &&
    !NON_TRACKED_STATIC_PATHS.has(url.pathname);

  // ── JSON API — dispatched early: API calls (including every analytics
  // beacon) never need to walk through the page routers below ──
  if (url.pathname.startsWith('/api/')) {
    return (await handleApiRoute(url, request, env, ctx)) || notFoundResponse(base, env);
  }

  // ── sitemap index + its child sitemaps / feed.rss ──
  // Use the canonical BASE_URL for feeds to ensure Google Search Console consistency
  const feedResponse = await handleFeedRoute(url, env, BASE_URL, ctx);
  if (feedResponse) return feedResponse;

  // ── /admin/* ──
  const adminResponse = await handleAdminRoute(url, request, env, base);
  if (adminResponse) return adminResponse;

  // ── Accounts: /login /register /logout /forgot-password /reset-password
  // /verify-email, /user/*, /company/* ──
  const authResponse = await handleAuthRoute(url, request, env, base, ctx);
  if (authResponse) return authResponse;

  const userResponse = await handleUserRoute(url, request, env, base);
  if (userResponse) return userResponse;

  const companyResponse = await handleCompanyRoute(url, request, env, base);
  if (companyResponse) return companyResponse;

  // ── core content: job / blog / static / home ──
  const pageResponse = await handlePagesRoute(url, request, env, base, ctx);
  if (pageResponse) return pageResponse;

  // ── programmatic SEO: categories / companies / skills / search ──
  const seoResponse = await handleSeoPagesRoute(url, request, env, ctx, base);
  if (seoResponse) return seoResponse;

  return notFoundResponse(base, env);
}

async function handleFetch(request, env, ctx) {
  const state = { trackable: false, settings: {} };
  const response = await routeRequest(request, env, ctx, state);
  if (state.trackable && response.status === 200 && ctx?.waitUntil &&
      String(response.headers.get('Content-Type') || '').includes('text/html')) {
    ctx.waitUntil(recordVisit(env, request, new URL(request.url), state.settings));
  }
  return withSecurityHeaders(response, env);
}

// Diagnostics for a crashed request: shown ONLY to a logged-in admin
// (signed admin cookie) who appends ?jf_debug=1 to the failing URL.
// The admin password is never accepted in a URL — query strings end up in
// browser history, Referer headers and Cloudflare logs.
async function debugDiagnostic(request, env, error) {
  try {
    const dbgUrl = new URL(request.url);
    if (dbgUrl.searchParams.get('jf_debug') !== '1') return null;
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return null;
    return String((error && error.stack) || error || 'Unknown error').slice(0, 4000);
  } catch (e) { return null; }
}

export default {
  // ════════════════════════════════════════════════════════════════
  // TOP-LEVEL SAFETY NET: any uncaught bug in any router/page/lib module
  // would otherwise show Cloudflare's raw "Error 1101" screen site-wide.
  // This wrapper does NOT change behavior for successful requests — it only
  // replaces a dead-end error screen with a branded fallback. The full error
  // and stack are still logged (console.error → Workers Logs) and persisted
  // to error_logs (visible in /admin/system).
  // ════════════════════════════════════════════════════════════════
  async fetch(request, env, ctx) {
    // Per-request copy of the bindings object: several modules stamp
    // request-scoped flags on `env` (e.g. the schema-migration guard). If the
    // runtime hands the same object to every request in an isolate, those
    // flags would leak across requests.
    env = { ...env };
    try {
      return await handleFetch(request, env, ctx);
    } catch (e) {
      console.error('[fetch] unhandled exception:', e && e.stack || e);
      try {
        const logPath = new URL(request.url).pathname;
        const logPromise = env.DB.prepare(
          `INSERT INTO error_logs (path, message, stack) VALUES (?, ?, ?)`
        ).bind(logPath, String((e && e.message) || e || 'Unknown error').slice(0, 500), String((e && e.stack) || '').slice(0, 4000)).run();
        if (ctx?.waitUntil) ctx.waitUntil(logPromise.catch(() => {})); else logPromise.catch(() => {});
      } catch (e4) { /* error_logs table may not exist yet on a brand-new DB */ }
      try {
        return withSecurityHeaders(renderFallbackErrorPage(await debugDiagnostic(request, env, e)), env);
      } catch (e2) {
        return new Response('Service temporarily unavailable. Please try again shortly.', { status: 500 });
      }
    }
  },

  // One trigger, dispatched by UTC time — see src/app/cron.js.
  async scheduled(event, env, ctx) {
    runScheduled(event, { ...env }, ctx);
  },
};
