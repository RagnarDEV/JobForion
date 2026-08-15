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
import { handleAdminSourcesRoute } from './admin/sources.router.js';
import { handleAdminTaxonomyRoute } from './admin/taxonomy.router.js';
import { handleAdminContentRoute } from './admin/content.router.js';
import { handleAdminWebsiteRoute } from './admin/website.router.js';
import { handleAdminMonetizationRoute } from './admin/monetization.router.js';
import { handleAdminSystemRoute } from './admin/system.router.js';
import { handleAdminSecurityRoute } from './admin/security.router.js';
import { handleAdminDashboardRoute } from './admin/dashboard.router.js';

// Order matters only for cost/specificity, same rationale as index.js:
// auth first (must work even before a session exists), the dashboard
// ('/admin' exactly) LAST since it would otherwise need to be excluded
// from every more-specific '/admin/*' check above it.
const ADMIN_SUB_ROUTERS = [
  handleAdminAuthRoute,
  handleAdminJobsRoute,
  handleAdminCompaniesRoute,
  handleAdminSourcesRoute,
  handleAdminTaxonomyRoute,
  handleAdminContentRoute,
  handleAdminWebsiteRoute,
  handleAdminMonetizationRoute,
  handleAdminSystemRoute,
  handleAdminSecurityRoute,
  handleAdminDashboardRoute,
];

export async function handleAdminRoute(url, request, env, base) {
  if (!url.pathname.startsWith('/admin')) return null;
  for (const subRouter of ADMIN_SUB_ROUTERS) {
    const response = await subRouter(url, request, env, base);
    if (response) return response;
  }
  return null;
}
