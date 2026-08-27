// src/routes/admin.router.js
// Everything under /admin, composed from focused sub-routers in
// src/routes/admin/*.router.js — mirrors the EXACT chain-of-responsibility
// pattern index.js already uses for assets/feed/admin/pages/seo/api: each
// sub-router returns a Response if the path is its concern, or `null` to
// let the next one try. This file used to BE all ~960 of those lines
// directly; it grew past the point of being safely readable/editable as
// one file, so it's split by admin section instead (Auth, Dashboard,
// Jobs, Companies, Sources, Taxonomy, Content, Website, Monetization,
// System, Security) — the same groups the sidebar in pages/admin/shell.js
// already organizes navigation into, so "which file owns this route" is
// always answerable by looking at the sidebar.
//
// NOTHING about behavior changed in this split: every route, every
// verifyAdminCookie() check, every try/catch → errorPage(), every
// logActivity() call was moved verbatim into its new home — see
// src/routes/admin/error-page.js for the one piece of shared code
// (previously a local function here) every sub-router imports.
//
// Adding a new admin route in the future: pick the sub-router whose
// section it belongs to (or add a new one here, one line) — never grow
// this file itself.

import { handleAdminAuthRoute } from './admin/auth.router.js';
import { handleAdminJobsRoute } from './admin/jobs.router.js';
import { handleAdminCompaniesRoute } from './admin/companies.router.js';
import { handleAdminAccountsRoute } from './admin/accounts.router.js';
import { handleAdminSourcesRoute } from './admin/sources.router.js';
import { handleAdminTaxonomyRoute } from './admin/taxonomy.router.js';
import { handleAdminContentRoute } from './admin/content.router.js';
import { handleAdminBlogAutomationRoute } from './admin/blog-automation.router.js';
import { handleAdminWebsiteRoute } from './admin/website.router.js';
import { handleAdminMonetizationRoute } from './admin/monetization.router.js';
import { handleAdminSystemRoute } from './admin/system.router.js';
import { handleAdminSecurityRoute } from './admin/security.router.js';
import { handleAdminDashboardRoute } from './admin/dashboard.router.js';
import { handleAdminAnalyticsRoute } from './admin/analytics.router.js';
import { handleAdminAiRoute } from './admin/ai.router.js';
import { handleAdminJobIntelligenceRoute } from './admin/job-intelligence.router.js';
import { handleAdminContentIntelligenceRoute } from './admin/content-intelligence.router.js';
import { handleAdminAssistantRoute } from './admin/admin-assistant.router.js';
import { handleAiControlCenterRoute } from './admin/ai-control-center.router.js';
import { verifyAdminCookie, getAdminCsrfToken, verifyAdminCsrf } from '../auth/admin-auth.js';

// Order matters only for cost/specificity, same rationale as index.js:
// auth first (must work even before a session exists), the dashboard
// ('/admin' exactly) LAST since it would otherwise need to be excluded
// from every more-specific '/admin/*' check above it.
const ADMIN_SUB_ROUTERS = [
  handleAdminAuthRoute,
  handleAdminJobIntelligenceRoute,
  handleAdminContentIntelligenceRoute,
  handleAdminAssistantRoute,
  handleAiControlCenterRoute,
  handleAdminJobsRoute,
  handleAdminCompaniesRoute,
  handleAdminAccountsRoute,
  handleAdminSourcesRoute,
  handleAdminTaxonomyRoute,
  handleAdminContentRoute,
  handleAdminBlogAutomationRoute,
  handleAdminWebsiteRoute,
  handleAdminMonetizationRoute,
  handleAdminSystemRoute,
  handleAdminSecurityRoute,
  handleAdminAiRoute,
  handleAdminAnalyticsRoute,
  handleAdminDashboardRoute,
];

export async function handleAdminRoute(url, request, env, base) {
  if (!url.pathname.startsWith('/admin')) return null;
  const cookie = request.headers.get('Cookie');
  const isAuthenticated = await verifyAdminCookie(env, cookie);
  // Login is intentionally exempt because no admin session exists yet.
  // Every other authenticated admin mutation is checked here before any
  // sub-router can perform a D1/R2 write. The request body is read from a
  // clone so the owning sub-router still receives the original stream.
  if (request.method === 'POST' && url.pathname !== '/admin/login' && isAuthenticated) {
    let submitted = request.headers.get('X-Admin-CSRF') || '';
    if (!submitted) {
      try { submitted = String((await request.clone().formData()).get('_admin_csrf') || ''); } catch (e) {}
    }
    if (!await verifyAdminCsrf(env, cookie, submitted)) return new Response('Invalid CSRF token', { status: 403 });
  }
  for (const subRouter of ADMIN_SUB_ROUTERS) {
    const response = await subRouter(url, request, env, base);
    if (response) {
      if (request.method === 'GET' && isAuthenticated) {
        const headers = new Headers(response.headers);
        const token = await getAdminCsrfToken(env, cookie);
        const secure = url.protocol === 'https:' ? ' Secure;' : '';
        headers.append('Set-Cookie', `jn_admin_csrf=${token}; Path=/admin; Max-Age=86400; SameSite=Strict;${secure}`);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }
      return response;
    }
  }
  return null;
}
