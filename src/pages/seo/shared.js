// src/pages/seo/shared.js
// Shared page-context loader and job list renderer for every SEO directory page.

import { baseLayout } from '../../layout/base-layout.js';
import { jobCardSSR } from '../../components/job-card.js';
import { getSettings } from '../../lib/platform/settings.js';
import { getCategories } from '../../lib/content/categories.js';
import { getCardStyles } from '../../lib/jobs/job-card-styles.js';
import { getLogoOverrides, attachCompanyLogos } from '../../lib/companies/company-logos.js';
import { hydrateHotPay } from '../../lib/jobs/hot-pay.js';
import { getFooterPages, getMenuPages } from '../../lib/content/pages-cms.js';
import { getNavButtons } from '../../lib/content/nav-buttons.js';
import { getVerifiedCompanyNameSet } from '../../lib/companies/companies.js';

// Shared by every function below: resolves site settings + the dynamic
// category list + card-style tiers (as both an ordered array and a
// {order, map} bundle ready to hand straight to baseLayout() for the
// "Post a Job" dropdown) — the exact same bundle home.js and job-page.js
// use, so job cards rendered here (via jobCardSSR) are pixel-identical to
// the homepage's, including any admin-customized card styles/colors.
// footerPages/menuPages/navButtons are likewise fetched once here and
// handed to every baseLayout() call below, so custom CMS pages and
// admin-added menu buttons appear consistently across every directory
// page, not just the homepage.
export async function loadPageContext(env) {
  const [settings, categories, cardStyles, footerPages, menuPages, navButtons] = await Promise.all([
    getSettings(env), getCategories(env), getCardStyles(env),
    getFooterPages(env), getMenuPages(env), getNavButtons(env),
  ]);
  const categoryOrder = categories.map(c => c.key);
  const categoryMap = Object.fromEntries(categories.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }]));
  return { settings, categories, categoryOrder, categoryMap, cardStyles, footerPages, menuPages, navButtons, categoryBundle: { order: categoryOrder, map: categoryMap } };
}

// Renders a list of jobs as full homepage-style cards (jobCardSSR) inside
// a `.jobs-list` container — used by every directory detail page below
// (category/company/country/skill/search) so "Similar Jobs" and every
// listing page look identical to the homepage, not a stripped-down row.
export async function jobsListHtml(env, jobs, categoryMap, categoryOrder, cardStyles, emptyHtml) {
  if (!jobs || !jobs.length) return emptyHtml;
  const [hydratedJobs, logoOverrides, settings, verifiedCompanySet] = await Promise.all([
    attachCompanyLogos(env, jobs),
    getLogoOverrides(env, jobs.map(j => j.company)),
    getSettings(env), // cheap: 60s-cached per isolate, see lib/platform/settings.js
    getVerifiedCompanyNameSet(env), // same 60s-cache pattern, see lib/companies/companies.js
  ]);
  const featuredEnabled = settings.feature_featured_jobs !== '0';
  const classifiedJobs = await hydrateHotPay(env, hydratedJobs, settings);
  return `<div class="jobs-list">${classifiedJobs.map((j, i) => jobCardSSR(j, i, categoryMap, categoryOrder, cardStyles, logoOverrides, featuredEnabled, verifiedCompanySet, settings)).join('')}</div>`;
}
