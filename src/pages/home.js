// src/pages/home.js
// The homepage SPA shell: SSR job list (first page, for SEO + fast first paint),
// hero, featured-companies strip, filters, and all client-side interactivity.

import { ensureTable } from '../db/schema.js';
import { navHtml, mobileHeaderHtml, mobileBottomNavHtml } from '../components/nav.js';
import { footerHtml } from '../components/footer.js';
import { postJobModalHtml } from '../components/post-job-modal.js';
import { SHARED_CSS } from '../styles/shared-css.js';
import { ICON_HEAD } from '../assets/favicon.js';
import { JOB_TYPE_META, JOB_TYPE_SORT_SQL, PUBLIC_JOB_STATUS_SQL, JOB_LISTING_COLUMNS } from '../config/constants.js';
import { jobCardSSR, logoImgHtml } from '../components/job-card.js';
import { adSlot } from '../components/ad-slot.js';
import { escapeHtml, slugify, listCompanies } from '../lib/entities.js';
import { googleAnalyticsTag } from '../lib/analytics-tag.js';
import { getSettings, HOMEPAGE_COPY_DEFAULTS, HERO_FONT_OPTIONS, themeCssVariables } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';
import { getCardStyles } from '../lib/job-card-styles.js';
import { getAdSlotsConfig } from '../lib/ad-slots.js';
import { getFooterPages, getMenuPages } from '../lib/pages-cms.js';
import { getNavButtons } from '../lib/nav-buttons.js';
import { getEnabledHomepageSections } from '../lib/homepage-sections.js';
import { getEnabledHomepageCustomSections } from '../lib/homepage-custom-sections.js';
import { pageCodeFrameHtml } from '../components/page-code-editor.js';
import { categoryIconSvg } from '../lib/category-icons.js';
import { getVerifiedCompanyNameSet, listPublicCompanies } from '../lib/companies.js';
import { getLogoOverrides, attachCompanyLogos } from '../lib/company-logos.js';
import { hydrateHotPay, HOT_PAY_LABEL } from '../lib/hot-pay.js';
import { getPosts } from '../lib/blog-cms.js';
import { iconSparkle, iconFlame, iconPin, iconMapPin, iconBookmark, iconLink, iconArrowRight, iconBadgeCheck, iconClock, iconGlobe, iconBuilding, iconSearch, iconCheck, iconInfo, iconAlertTriangle, iconFilter, iconChevronDown, iconSliders, iconLayoutGrid, iconX, iconBell, iconFileText, iconPlus, iconBriefcase } from '../assets/icons.js';

// Same icon markup used by the server-rendered cards (job-card.js) is
// reused for client-rendered cards (search/filter/pagination results) by
// serializing it once here and injecting it as data — guarantees the two
// renderers can never visually drift apart, and avoids duplicating SVG
// path data in two places.
const CLIENT_ICONS = {
  sparkle: iconSparkle({ size: 11 }), flame: iconFlame({ size: 11 }), pin: iconPin({ size: 11 }),
  mapPin: iconMapPin({ size: 11 }), bookmark: iconBookmark(), link: iconLink(), arrowRight: iconArrowRight(),
  arrowRightSm: iconArrowRight({ size: 11 }), badgeCheck: iconBadgeCheck({ size: 12 }), clock: iconClock({ size: 11 }),
  globe: iconGlobe({ size: 11 }), building: iconBuilding({ size: 11 }), search: iconSearch({ size: 16 }),
  check: iconCheck({ size: 16 }), info: iconInfo({ size: 16 }), alertTriangle: iconAlertTriangle({ size: 32 }),
  searchLg: iconSearch({ size: 32 }),
};

async function getCategoryCounts(env, categories) {
  const counts = Object.fromEntries((categories || []).map(c => [c.key, 0]));
  await Promise.all((categories || []).map(async c => {
    try {
      const { results } = await env.DB.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${PUBLIC_JOB_STATUS_SQL} AND LOWER(title) LIKE ?`).bind(`%${String(c.key || '').toLowerCase()}%`).all();
      counts[c.key] = Number(results?.[0]?.c || 0);
    } catch (e) {}
  }));
  return counts;
}

export async function renderMainHTML(env, base, user = null) {
  await ensureTable(env);
  const settings = await getSettings(env);
  const categories = await getCategories(env);
  const categoryOrder = categories.map(c => c.key);
  const categoryMap = Object.fromEntries(categories.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }]));
  const categoryCounts = await getCategoryCounts(env, categories.slice(0, 8));
  const cardStyles = await getCardStyles(env);
  const adConfig = await getAdSlotsConfig(env);
  const adsEnabled = settings.ads_enabled !== '0';
  const footerPages = await getFooterPages(env);
  const menuPages = await getMenuPages(env);
  const navButtons = await getNavButtons(env);
  // Homepage Sections Builder (Admin Dashboard V2, Phase 4) — which
  // blocks render and in what order, per /admin/homepage. Falls back to
  // every section enabled in its default order (see
  // lib/homepage-sections.js) if the table is empty/unreachable, so a
  // fresh install or a transient D1 hiccup renders the homepage exactly
  // as it always has — never a blank or broken page.
  const enabledSections = await getEnabledHomepageSections(env);
  const enabledCustomSections = await getEnabledHomepageCustomSections(env);
  // Hero customization (see /admin/settings → "Hero & Branding") — falls
  // back to HERO_FONT_OPTIONS[0] (Plus Jakarta Sans, the brand's display
  // font) for any unrecognized/stale value, so a bad save can never
  // leave the heading with no font applied at all.
  const heroFont = HERO_FONT_OPTIONS.find(f => f.name === settings.hero_heading_font) || HERO_FONT_OPTIONS[0];
  const heroFontGoogleParam = heroFont.name === 'Plus Jakarta Sans' ? '' : `&family=${heroFont.googleParam}`;
  const legacyHeroDefaults = {
    title1: 'Find your next',
    title2: 'remote job',
    subtitle: 'Browse curated remote positions from top companies worldwide. Filter by category, country, skill, or company — or post your own opening in minutes.',
    button: 'Search',
  };
  const heroTitleLine1 = settings.hero_title_line1 === legacyHeroDefaults.title1 ? 'Find the work you love.' : settings.hero_title_line1;
  const heroTitleLine2 = settings.hero_title_line2 === legacyHeroDefaults.title2 ? 'Anywhere in the world.' : settings.hero_title_line2;
  const heroSubtitle = settings.hero_subtitle === legacyHeroDefaults.subtitle ? 'Discover flexible remote work from trusted companies, with global opportunities curated for the way you want to work.' : settings.hero_subtitle;
  const heroSearchButtonText = settings.hero_search_button_text === legacyHeroDefaults.button ? 'Search Jobs' : settings.hero_search_button_text;
  const homepageCopy = {
    featuredTitle: settings.homepage_featured_title || HOMEPAGE_COPY_DEFAULTS.homepage_featured_title,
    categoriesTitle: settings.homepage_categories_title || HOMEPAGE_COPY_DEFAULTS.homepage_categories_title,
    jobsEyebrow: settings.homepage_jobs_eyebrow || HOMEPAGE_COPY_DEFAULTS.homepage_jobs_eyebrow,
    jobsTitle: settings.homepage_jobs_title || HOMEPAGE_COPY_DEFAULTS.homepage_jobs_title,
    jobsCta: settings.homepage_jobs_cta || HOMEPAGE_COPY_DEFAULTS.homepage_jobs_cta,
    alertsTitle: settings.homepage_alerts_title || HOMEPAGE_COPY_DEFAULTS.homepage_alerts_title,
    alertsText: settings.homepage_alerts_text || HOMEPAGE_COPY_DEFAULTS.homepage_alerts_text,
    alertsCta: settings.homepage_alerts_cta || HOMEPAGE_COPY_DEFAULTS.homepage_alerts_cta,
    careerTitle: settings.homepage_career_title || HOMEPAGE_COPY_DEFAULTS.homepage_career_title,
    careerText: settings.homepage_career_text || HOMEPAGE_COPY_DEFAULTS.homepage_career_text,
    careerCta: settings.homepage_career_cta || HOMEPAGE_COPY_DEFAULTS.homepage_career_cta,
    resourcesTitle: settings.homepage_resources_title || HOMEPAGE_COPY_DEFAULTS.homepage_resources_title,
    blogTitle: settings.homepage_blog_title || HOMEPAGE_COPY_DEFAULTS.homepage_blog_title,
    blogCta: settings.homepage_blog_cta || HOMEPAGE_COPY_DEFAULTS.homepage_blog_cta,
  };
  let initialJobs = [], initialTotal = 0, totalJobsCount = 0, companiesCount = 0;
  try {
    const { results } = await env.DB.prepare(`SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE ${PUBLIC_JOB_STATUS_SQL} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, featured DESC, id DESC LIMIT 20`).all();
    initialJobs = await hydrateHotPay(env, await attachCompanyLogos(env, results || []), settings);
    const { results: cr } = await env.DB.prepare(`SELECT COUNT(*) as total FROM jobs WHERE ${PUBLIC_JOB_STATUS_SQL}`).all();
    initialTotal = cr[0]?.total || 0;
    totalJobsCount = initialTotal;
    const { results: ccr } = await env.DB.prepare(`SELECT COUNT(DISTINCT LOWER(company)) as c FROM jobs WHERE company IS NOT NULL AND company != '' AND ${PUBLIC_JOB_STATUS_SQL}`).all();
    companiesCount = ccr[0]?.c || 0;
  } catch (e) {}

  // Top companies prefer the real, admin-managed companies table (which
  // carries logo_url, verification and an exact job_count). Legacy provider-
  // only names remain a safe fallback so the homepage never goes empty on a
  // fresh install. Logos are resolved from real company data or admin logo
  // overrides; the renderer uses a monogram when neither exists.
  let topCompanies = [];
  let companyLogoMap = {};
  try {
    const [realCompanies, legacyCompanies] = await Promise.all([
      listPublicCompanies(env, { limit: 40 }),
      listCompanies(env, { limit: 40 }),
    ]);
    const seen = new Set();
    for (const c of realCompanies || []) {
      const key = String(c.name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      topCompanies.push({ ...c, count: Number(c.job_count || 0), slug: c.slug || slugify(c.name) });
      if (c.logo_url) companyLogoMap[key] = c.logo_url;
    }
    for (const c of legacyCompanies || []) {
      const key = String(c.name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      topCompanies.push(c);
    }
    const overrides = await getLogoOverrides(env, topCompanies.map(c => c.name));
    companyLogoMap = { ...companyLogoMap, ...overrides };
  } catch (e) {}
  const verifiedCompanySet = await getVerifiedCompanyNameSet(env);
  let blogPosts = [];
  try { blogPosts = await getPosts(env, { limit: 4 }); } catch (e) {}

  const itemListSchema = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList",
    "itemListElement": initialJobs.slice(0, 10).map((j, i) => ({
      "@type": "ListItem", "position": i + 1, "url": `${base}/job/${j.id}`
    }))
  });
  const orgSchema = JSON.stringify({
    "@context": "https://schema.org", "@type": "Organization",
    "name": settings.site_name, "url": base, "logo": `${base}/icon-512.png`
  });

  const featuredEnabled = settings.feature_featured_jobs !== '0';
  const initialLogoOverrides = await getLogoOverrides(env, initialJobs.map(j => j.company));
  const jobLogoOverrides = { ...companyLogoMap, ...initialLogoOverrides };
  const ssrJobsHtml = initialJobs.length
    ? initialJobs.map((j, i) => jobCardSSR(j, i, categoryMap, categoryOrder, cardStyles, jobLogoOverrides, featuredEnabled, verifiedCompanySet, settings)).join('')
    : `<div class="loader-wrap"><div class="loader"></div></div>`;

  const siteName = escapeHtml(settings.site_name);
  const siteDescription = settings.site_description || `${settings.site_name} is a curated remote job board with ${totalJobsCount ? totalJobsCount.toLocaleString() + '+' : ''} verified positions in development, design, marketing, data and more. Updated every few hours.`;
  const robotsDirective = settings.seo_indexing_enabled === '0' ? 'noindex, nofollow' : 'index, follow';

  // ── Homepage Sections (Admin Dashboard V2, Phase 4) ─────────────────
  // Each section is built as a standalone HTML string here, then
  // assembled below in whatever order/subset `enabledSections` says.
  // `hero` and `job_listing` are `required: true` in
  // lib/homepage-sections.js and therefore always present — everything
  // else only renders if an admin has switched it on.
  const sidebarSectionHtml = {
    job_alerts: `<div class="side-card alert-card"><div class="side-card-icon">${iconBell({ size: 18 })}</div><h3>${escapeHtml(homepageCopy.alertsTitle)}</h3><p>${escapeHtml(homepageCopy.alertsText)}</p><a class="side-button" href="${user ? '/user/job-alerts' : '/register'}">${escapeHtml(homepageCopy.alertsCta)} ${iconArrowRight({ size: 13 })}</a></div>`,
    career_boost: `<div class="side-card resume-card"><div><p class="eyebrow">STAND OUT</p><h3>${escapeHtml(homepageCopy.careerTitle)}</h3><p>${escapeHtml(homepageCopy.careerText)}</p><a class="side-button light" href="${user ? '/user/profile' : '/register'}">${escapeHtml(homepageCopy.careerCta)} ${iconArrowRight({ size: 13 })}</a></div><div class="resume-orbit"><span></span><span></span><span></span></div></div>`,
    career_resources: `<div class="side-card resources-card"><h3>${escapeHtml(homepageCopy.resourcesTitle)}</h3><a href="/blog">${iconFileText({ size: 14 })}<span>Career advice</span>${iconArrowRight({ size: 13 })}</a><a href="/blog">${iconFileText({ size: 14 })}<span>Interview tips</span>${iconArrowRight({ size: 13 })}</a><a href="/skills">${iconFileText({ size: 14 })}<span>Browse by skill</span>${iconArrowRight({ size: 13 })}</a><a href="/countries">${iconFileText({ size: 14 })}<span>Remote by country</span>${iconArrowRight({ size: 13 })}</a></div>`,
  };
  const sidebarSectionsHtml = enabledSections.filter(s => sidebarSectionHtml[s.key]).map(s => sidebarSectionHtml[s.key]).join('');

  const sectionHtml = {
    hero: `
    <section class="hero">
      <div class="hero-inner">
        <div class="hero-copy">
          <div class="hero-eyebrow"><span class="hero-eyebrow-dot"></span> REMOTE-FIRST CAREERS</div>
          <h1 class="hero-title">${escapeHtml(heroTitleLine1)}<br><span class="hl">${escapeHtml(heroTitleLine2)}</span></h1>
          <p class="hero-sub">${escapeHtml(heroSubtitle)}</p>
        </div>
        <div class="hero-visual" aria-hidden="true"><div class="hero-map-grid"></div><span class="hero-orbit orbit-a"></span><span class="hero-orbit orbit-b"></span><span class="hero-orbit orbit-c"></span><div class="hero-people-card"><span>JD</span><span>AK</span><span>RS</span></div></div>
        <div class="search-card">
          <label class="sc-field"><span>Job title, keywords, or company</span><div class="sc-row"><span class="sc-icon">${iconSearch({ size: 17 })}</span><input type="text" class="sc-input" id="searchInput" placeholder="${escapeHtml(settings.hero_search_placeholder)}" oninput="debounceSearch(this.value)"></div></label>
          <label class="sc-field"><span>Location</span><div class="sc-row"><span class="sc-icon">${iconMapPin({ size: 15 })}</span><input type="text" class="sc-input" id="fCountry" placeholder="Anywhere" oninput="debounceCountryChange(this.value)"></div></label>
          <label class="sc-field"><span>Job type</span><div class="sc-row sc-row-select"><span class="sc-icon">${iconBriefcase({ size: 15 })}</span><select class="sc-select" id="fEmploy" onchange="onFilterChange()"><option value="">Any type</option><option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="contract">Contract</option></select><span class="sc-chevron">${iconChevronDown({ size: 15 })}</span></div></label>
          <button class="sc-slider-btn" id="filtersToggleBtn" onclick="toggleFiltersPanel()" aria-label="More filters" title="More filters">${iconSliders({ size: 16 })}<span class="filters-count-badge" id="filtersCountBadge" style="display:none">0</span></button>
          <button class="sc-search-btn" onclick="onFilterChange()">${iconSearch({ size: 15 })} ${escapeHtml(heroSearchButtonText)}</button>
        </div>
        <div class="filters-toggle-row"><button class="filters-clear-btn" id="filtersClearBtn" onclick="clearFilters()" style="display:none">${iconX({ size: 11 })} Clear all filters</button></div>
        <div class="filters-panel" id="filtersPanel"><div class="filters-panel-inner"><div class="filters-grid">
          <label class="filter-field"><span>Remote type</span><select id="fRemote" onchange="onFilterChange()"><option value="">Any</option><option value="fully_remote">Fully remote</option><option value="hybrid">Hybrid</option><option value="on_site">On-site</option></select></label>
          <label class="filter-field"><span>Category</span><select id="fCategory" onchange="onFilterChange()"><option value="">All categories</option>${categories.map(c => `<option value="${c.key}">${escapeHtml(c.label)}</option>`).join('')}</select></label>
          <label class="filter-field"><span>Seniority</span><select id="fSeniority" onchange="onFilterChange()"><option value="">Any</option><option value="Junior">Junior</option><option value="Mid">Mid-level</option><option value="Senior">Senior</option><option value="Lead">Lead</option></select></label>
          <label class="filter-field"><span>Min salary (USD/yr)</span><input type="number" id="fSalaryMin" placeholder="e.g. 80000" min="0" step="5000" oninput="debounceFilterChange()"></label>
          <label class="filter-field"><span>Max salary (USD/yr)</span><input type="number" id="fSalaryMax" placeholder="e.g. 150000" min="0" step="5000" oninput="debounceFilterChange()"></label>
          <label class="filter-field"><span>Posted within</span><select id="fDays" onchange="onFilterChange()"><option value="">Any time</option><option value="1">Last 24 hours</option><option value="3">Last 3 days</option><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</select></label>
          <label class="filter-field"><span>Source</span><select id="fSourceType" onchange="onFilterChange()"><option value="">Any</option><option value="employer">Direct from employer</option><option value="provider">Aggregated</option></select></label>
          <label class="filter-field"><span>Sort by</span><select id="fSort" onchange="onFilterChange()"><option value="relevance">Relevance</option><option value="newest">Newest</option><option value="updated">Recently updated</option><option value="salary">Highest salary</option><option value="oldest">Oldest</option></select></label>
        </div></div></div>
        <div class="popular-searches"><strong>Popular searches:</strong><button onclick="setSearchAndGo('developer')">Developer</button><button onclick="setSearchAndGo('designer')">Designer</button><button onclick="setSearchAndGo('marketing')">Marketing</button><button onclick="setSearchAndGo('data analyst')">Data analyst</button><button onclick="setSearchAndGo('customer support')">Customer Support</button></div>
      </div>
    </section>`,

    featured_companies: topCompanies.length ? `
    <section class="fc-strip">
      <div class="fc-inner"><div class="section-heading compact-heading"><div><p class="eyebrow">CURATED EMPLOYERS</p><h2>${escapeHtml(homepageCopy.featuredTitle)}</h2></div><a class="text-button" href="/companies">View all companies ${iconArrowRight({ size: 14 })}</a></div>
      <div class="fc-logos">${topCompanies.slice(0, 8).map(c => `<a class="company-tile" href="/companies/${escapeHtml(c.slug || slugify(c.name))}">${logoImgHtml(c.name, '38px', 'company-logo', companyLogoMap[String(c.name || '').toLowerCase()] || null, c.website)}<strong>${escapeHtml(c.name)}</strong><small>${Number(c.count || 0).toLocaleString()} open roles</small></a>`).join('')}</div></div>
    </section>` : '',

    categories_grid: categories.length ? `
    <section class="category-strip"><div class="content-wrap category-inner"><div class="cg-title">${escapeHtml(homepageCopy.categoriesTitle)}</div><div class="cg-grid">
      ${categories.slice(0, 8).map(c => { const swatch = /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#6339E6'; return `<a href="/categories/${c.key}" class="cg-item" style="--cat-color:${swatch}"><span class="cg-icon" style="background:${swatch}1a;color:${swatch}">${categoryIconSvg(c.key, { size: 18 })}</span><span><strong class="cg-label">${escapeHtml(c.label)}</strong><small>${categoryCounts[c.key] ? `${Number(categoryCounts[c.key]).toLocaleString()} open roles` : 'Explore roles'}</small></span></a>`; }).join('')}
    </div></div></section>` : '',

    job_listing: `
    <section class="content-wrap jobs-section"><div class="home-jobs-grid${sidebarSectionsHtml ? '' : ' no-sidebar'}"><div class="home-jobs-column">
      <div class="section-heading jobs-heading"><div><p class="eyebrow">${escapeHtml(homepageCopy.jobsEyebrow)}</p><h2>${escapeHtml(homepageCopy.jobsTitle)}</h2></div><a class="text-button" href="/jobs">${escapeHtml(homepageCopy.jobsCta)} ${iconArrowRight({ size: 14 })}</a></div>
      <div class="job-tabs" role="tablist"><button class="active" data-job-tab="all" onclick="quickJobTab('all',this)">All jobs</button><button data-job-tab="remote" onclick="quickJobTab('remote',this)">Remote</button><button data-job-tab="full_time" onclick="quickJobTab('full_time',this)">Full-time</button><button data-job-tab="part_time" onclick="quickJobTab('part_time',this)">Part-time</button><button data-job-tab="contract" onclick="quickJobTab('contract',this)">Contract</button></div>
      <div class="results-hdr"><div class="results-count" id="resultsCount" style="display:none"><strong>${initialTotal.toLocaleString()}</strong> jobs found</div></div>
      ${adSlot('homepage-results-top', '', adConfig, adsEnabled)}
      <div class="jobs-list" id="jobsList">${ssrJobsHtml}</div><a class="jobs-view-all" href="/jobs">${escapeHtml(homepageCopy.jobsCta)} ${iconArrowRight({ size: 14 })}</a>
    </div>${sidebarSectionsHtml ? `<aside class="home-sidebar">${sidebarSectionsHtml}</aside>` : ''}</div></section>`,

    career_insights: blogPosts.length ? `<section class="insights-strip"><div class="content-wrap"><div class="section-heading compact-heading"><div><p class="eyebrow">CAREER GUIDANCE</p><h2>${escapeHtml(homepageCopy.blogTitle)}</h2></div><a class="text-button" href="/blog">${escapeHtml(homepageCopy.blogCta)} ${iconArrowRight({ size: 14 })}</a></div><div class="insights-grid">${blogPosts.map((post, i) => `<a class="insight-tile" href="/blog/${escapeHtml(post.slug)}"><div class="insight-cover" style="${post.cover_image_url ? `background-image:url('${escapeHtml(post.cover_image_url)}')` : `background:linear-gradient(135deg,${['#6a53d8','#ed9d83','#54a9b5','#d47898'][i % 4]},#29244e)`}"><span>${escapeHtml(post.category || 'Career advice')}</span></div><strong>${escapeHtml(post.title)}</strong><small>${escapeHtml(post.excerpt || 'Practical guidance for your next remote opportunity.')}</small></a>`).join('')}</div></div></section>` : '',

    trust_strip: `<section class="trust-strip"><div class="content-wrap trust-grid"><div><span class="trust-icon">⌁</span><p><strong>100% Remote Jobs</strong><small>Work from anywhere in the world</small></p></div><div><span class="trust-icon">✓</span><p><strong>Verified companies</strong><small>Teams you can trust</small></p></div><div><span class="trust-icon">✦</span><p><strong>Daily updates</strong><small>Fresh roles added every day</small></p></div><div><span class="trust-icon">◌</span><p><strong>Free for job seekers</strong><small>Search and apply for free</small></p></div></div></section>`,

    employer_cta: `<div class="content-wrap"><div class="cta-banner"><div><div class="cta-title">Hiring remotely?</div><div class="cta-sub">Reach qualified candidates and post your job in minutes.</div></div><button class="cta-btn" onclick="openPostJobModal()">${iconPlus({ size: 13 })} Post a job</button></div></div>`,
  };
  const homepageSectionsHtml = enabledSections.map(s => sectionHtml[s.key] || '').join('') + enabledCustomSections.map(s => `
    <section class="homepage-custom-section" data-homepage-custom-section="${s.id}">
      <div class="content-wrap homepage-custom-inner">
        <div class="section-heading compact-heading"><div><p class="eyebrow">CUSTOM SECTION</p><h2>${escapeHtml(s.title)}</h2>${s.description ? `<p class="homepage-custom-description">${escapeHtml(s.description)}</p>` : ''}</div></div>
        <div class="homepage-custom-code">${pageCodeFrameHtml({ html: s.custom_html || '', css: s.custom_css || '', js: s.custom_js || '', id: `homepage_custom_${s.id}`, title: s.title })}</div>
      </div>
    </section>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
${googleAnalyticsTag(settings.ga_measurement_id)}
<meta charset="UTF-8">
<meta name="google-site-verification" content="7Q0EJk3kQKNLNzIhyzH4k5CsuHsQEa-U0Pwp_w_b0n0"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${siteName} — ${escapeHtml(settings.site_tagline)}</title>
<meta name="description" content="${escapeHtml(siteDescription)}">
<meta name="robots" content="${robotsDirective}">
${ICON_HEAD}
<meta property="og:title" content="${siteName} — ${escapeHtml(settings.site_tagline)}">
<meta property="og:description" content="${escapeHtml(siteDescription)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${base}">
<meta property="og:site_name" content="${siteName}">
<meta property="og:image" content="${base}/icon-512.png">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${base}">
<link rel="alternate" type="application/rss+xml" title="${siteName} Jobs Feed" href="${base}/feed.rss">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":${JSON.stringify(settings.site_name)},"url":"${base}","potentialAction":{"@type":"SearchAction","target":"${base}/?search={search_term_string}","query-input":"required name=search_term_string"}}</script>
<script type="application/ld+json">${orgSchema}</script>
<script type="application/ld+json">${itemListSchema}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@700;800&family=JetBrains+Mono:wght@500;700${heroFontGoogleParam}&display=swap" rel="stylesheet">
<style>
${SHARED_CSS}
${themeCssVariables(settings)}

/* ── HERO (light editorial surface with a purple decision path) ── */
.hero{padding:66px 24px 84px;background:linear-gradient(116deg,#fff 0%,#fbfaff 55%,#f3efff 100%);position:relative;overflow:hidden;border-bottom:1px solid #f0edf8}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 42% 80% at 82% 20%,rgba(117,75,236,.09),transparent 65%);pointer-events:none}.hero-inner{max-width:1150px;margin:0 auto;position:relative;min-height:390px}.hero-copy{position:relative;z-index:2;width:min(560px,55%);padding-top:11px}.hero-eyebrow{display:inline-flex;align-items:center;gap:7px;color:var(--brand);font-size:10px;font-weight:800;letter-spacing:1.1px;margin-bottom:15px}.hero-eyebrow-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse-dot 2s infinite}.hero-title{font-family:'${heroFont.name}',sans-serif;font-size:clamp(40px,4.4vw,57px);font-weight:800;letter-spacing:-2.3px;line-height:1.06;margin-bottom:17px;color:var(--ink);max-width:600px}.hero-title .hl{position:relative;display:inline-block;color:var(--brand)}.hero-title .hl::after{content:'';position:absolute;left:0;right:0;bottom:1px;height:5px;background:#cfc2ff;border-radius:3px;opacity:.7;z-index:-1}.hero-sub{color:#77748a;font-size:13px;margin-bottom:24px;line-height:1.8;max-width:450px}
.hero-visual{position:absolute;right:-35px;top:0;width:560px;height:320px;pointer-events:none}.hero-map-grid{position:absolute;inset:24px 0 0 0;border-radius:50%;opacity:.62;background-image:radial-gradient(circle at 25% 35%,rgba(99,57,230,.75) 0 2px,transparent 3px),radial-gradient(circle at 54% 26%,rgba(99,57,230,.55) 0 2px,transparent 3px),radial-gradient(circle at 70% 62%,rgba(99,57,230,.65) 0 2px,transparent 3px),radial-gradient(circle at 37% 72%,rgba(99,57,230,.55) 0 2px,transparent 3px),radial-gradient(ellipse at center,transparent 0 47%,rgba(190,177,245,.2) 48% 49%,transparent 50%),radial-gradient(ellipse at center,transparent 0 58%,rgba(190,177,245,.16) 59% 60%,transparent 61%);transform:rotate(-13deg)}.hero-map-grid::after{content:'';position:absolute;inset:14% 9%;background:repeating-linear-gradient(0deg,transparent 0 17px,rgba(147,125,225,.08) 18px 19px),repeating-linear-gradient(90deg,transparent 0 20px,rgba(147,125,225,.08) 21px 22px);mask-image:radial-gradient(ellipse,#000 0 48%,transparent 72%);transform:rotate(10deg)}.hero-orbit{position:absolute;width:42px;height:42px;border-radius:50%;border:3px solid #fff;box-shadow:0 8px 18px rgba(42,30,99,.18);background:linear-gradient(135deg,#21457e,#8dd0e5)}.orbit-a{top:33px;right:135px}.orbit-b{bottom:36px;right:48px;background:linear-gradient(135deg,#c87579,#503771)}.orbit-c{top:112px;right:66px;background:linear-gradient(135deg,#d7aa91,#463b62)}.hero-people-card{position:absolute;right:64px;top:165px;padding:7px;background:rgba(255,255,255,.92);border:1px solid #eeeaf9;border-radius:9px;display:flex}.hero-people-card span{width:25px;height:25px;margin-left:-4px;border:2px solid #fff;border-radius:50%;display:grid;place-items:center;color:#fff;background:#593fd4;font-size:7px;font-weight:800}.hero-people-card span:first-child{margin-left:0;background:#d17977}.hero-people-card span:last-child{background:#278092}
.search-card{position:absolute;z-index:4;left:0;bottom:0;width:min(870px,86%);display:grid;grid-template-columns:1.35fr 1fr 42px 132px;gap:9px;align-items:end;padding:13px 15px;background:#fff;border:1px solid #ebe8f2;border-radius:10px;box-shadow:0 14px 34px rgba(48,31,121,.1)}.sc-field{display:grid;gap:5px;min-width:0}.sc-field>span{color:#5d596f;font-size:8px;font-weight:800}.sc-row{display:flex;align-items:center;gap:8px;height:38px;background:#fff;border:1px solid #e8e5ef;border-radius:6px;padding:0 10px;transition:box-shadow .18s}.sc-row:focus-within{box-shadow:0 0 0 2px var(--brand-soft)}.sc-icon{color:#8c879b;flex-shrink:0;display:inline-flex}.sc-input{flex:1;min-width:0;background:transparent;border:none;padding:0;color:var(--ink);font-size:10px;font-family:inherit;outline:none}.sc-input::placeholder{color:#9c98a9}.sc-slider-btn{position:relative;flex-shrink:0;width:38px;height:38px;border-radius:7px;border:1px solid #e8e5ef;background:#fff;color:#777286;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .18s}.sc-slider-btn:hover,.sc-slider-btn.active{background:var(--brand-soft);border-color:#cabdf7;color:var(--brand)}.sc-row-select{cursor:pointer}.sc-select{flex:1;min-width:0;background:transparent;border:none;padding:0;color:var(--ink);font-size:10px;font-weight:600;font-family:inherit;outline:none;appearance:none;cursor:pointer}.sc-chevron{color:#8b8799;flex-shrink:0;display:inline-flex;pointer-events:none}.sc-search-btn{height:38px;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#6339e6;color:#fff;border:none;border-radius:7px;padding:0 13px;font-size:10px;font-weight:800;cursor:pointer;font-family:inherit;transition:all .18s;white-space:nowrap}.sc-search-btn:hover{filter:brightness(1.08);box-shadow:0 8px 18px rgba(99,57,230,.25)}.filters-count-badge{position:absolute;top:-4px;right:-4px;background:var(--coral);color:#fff;font-size:8px;font-weight:800;padding:1px 5px;border-radius:20px;line-height:1.5;min-width:13px;text-align:center;border:2px solid #fff}.filters-toggle-row{max-width:560px;display:flex;justify-content:flex-end;min-height:0}.filters-clear-btn{display:inline-flex;align-items:center;gap:4px;background:none;border:none;color:var(--brand);font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;padding:4px}.filters-clear-btn:hover{color:var(--brand2)}.filters-panel{position:relative;z-index:5;max-width:870px;max-height:0;overflow:hidden;opacity:0;transition:max-height .32s ease,opacity .25s ease,margin-top .32s ease}.filters-panel.open{max-height:360px;opacity:1;margin-top:8px}.filters-panel-inner{background:#fff;border:1px solid #ece8f7;border-radius:12px;padding:16px 18px;box-shadow:0 14px 34px rgba(45,29,112,.1)}.filters-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}.filter-field{display:flex;flex-direction:column;gap:6px}.filter-field span{font-size:9px;font-weight:800;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px}.filter-field select,.filter-field input{background:var(--surface2);border:1.5px solid var(--border2);border-radius:8px;padding:9px 11px;font-size:12px;color:var(--ink);font-family:inherit;outline:none;transition:border-color .2s;width:100%}.filter-field select:focus,.filter-field input:focus{border-color:var(--brand)}.popular-searches{position:absolute;z-index:3;left:0;bottom:-31px;display:flex;align-items:center;gap:8px;color:#7d798d;font-size:9px}.popular-searches strong{font-size:9px}.popular-searches button{border:0;background:var(--brand-soft);border-radius:12px;padding:5px 9px;color:#6943d8;font-size:8px;cursor:pointer}.popular-searches button:hover{background:#e6deff}

/* ── FEATURED COMPANIES STRIP ── */
.fc-strip{border-bottom:1px solid var(--border);padding:31px 24px 28px;background:var(--surface)}.fc-inner{max-width:1150px;margin:0 auto}.compact-heading{margin-bottom:15px}.section-heading{display:flex;justify-content:space-between;gap:18px;align-items:end}.eyebrow{color:var(--brand);margin:0 0 6px;font-size:9px;letter-spacing:1px;font-weight:800}.section-heading h2{font-family:'Space Grotesk',sans-serif;color:var(--ink);letter-spacing:-.8px;font-size:19px;margin:0}.text-button{display:inline-flex;align-items:center;gap:6px;color:var(--brand);font-size:10px;font-weight:800;white-space:nowrap}.text-button:hover{color:var(--brand2)}.fc-logos{display:grid;grid-template-columns:repeat(8,1fr);border:1px solid #efedf4;border-radius:10px;overflow:hidden}.company-tile{min-height:112px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;background:#fff;border-right:1px solid #efedf4;transition:all .18s}.company-tile:last-child{border-right:0}.company-tile:hover{background:#faf8ff;transform:translateY(-3px)}.company-tile strong{font-size:9px;color:#2d2944}.company-tile small{font-size:8px;color:#9692a3}.company-mark{width:31px;height:31px;display:grid;place-items:center;font-family:'Space Grotesk',sans-serif;font-size:19px;font-weight:800;color:var(--brand);border-radius:9px;background:var(--brand-soft)}.company-logo{width:38px;height:38px;border-radius:10px;background:var(--brand-soft);border:1px solid #ece8f7;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.company-logo img{width:100%;height:100%;object-fit:contain;padding:6px}.company-logo span{width:100%;height:100%;align-items:center;justify-content:center}

/* ── CONTENT ── */
  .content-wrap{max-width:1180px;margin:0 auto;padding:24px}.home-jobs-grid.no-sidebar{grid-template-columns:1fr}.homepage-custom-section{border-top:1px solid var(--border);background:var(--surface)}.homepage-custom-inner{padding-top:34px;padding-bottom:34px}.homepage-custom-description{margin:7px 0 0;color:var(--ink3);font-size:11px;line-height:1.6}.homepage-custom-code{width:100%;overflow:visible}.homepage-custom-code .page-code-frame{display:block;width:100%;max-width:none;border:0;border-radius:0;background:transparent}

/* ── Categories Grid (Homepage Sections Builder, Phase 4) ── */
.cg-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:15px;font-weight:800;color:var(--ink);margin-bottom:12px}
.cg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:24px}
.cg-item{display:flex;align-items:center;gap:11px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;text-decoration:none;transition:all .2s}
.cg-item:hover{border-color:var(--cat-color,var(--brand));transform:translateY(-1px);box-shadow:var(--shadow)}
.cg-icon{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.cg-label{font-size:12.5px;font-weight:700;color:var(--ink)}

/* ── Post-a-Job CTA banner (Homepage Sections Builder, Phase 4) ── */
.cta-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 60%,#1E3A8A 100%);border-radius:16px;padding:24px 28px;margin-bottom:24px}
.cta-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:19px;font-weight:800;color:#fff;margin-bottom:4px}
.cta-sub{font-size:13px;color:rgba(255,255,255,.82)}
.cta-btn{background:var(--coral);color:#fff;border:none;border-radius:24px;padding:12px 24px;font-size:13.5px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;transition:all .2s;box-shadow:0 4px 14px rgba(255,92,122,.35)}
.cta-btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(255,92,122,.45)}
@media(max-width:640px){
  .cta-banner{padding:20px}
  .cta-btn{width:100%;text-align:center}
}
.results-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:10px;flex-wrap:wrap}
.results-count{font-size:14px;color:var(--ink3)}
.results-count strong{color:var(--ink);font-weight:700}

/* ── JOB LIST (pastel-tinted cards, remote.io rhythm) ── */
.jobs-list{display:flex;flex-direction:column;gap:9px}
.job-card{border:1px solid var(--border);border-radius:13px;display:block;text-decoration:none;color:inherit;transition:all .2s;position:relative;overflow:hidden}
.job-card:hover{border-color:var(--cat-color,var(--brand));box-shadow:var(--shadow-lg);transform:translateY(-2px)}
.card-inner{padding:13px 14px}
.card-row1{display:flex;align-items:flex-start;gap:11px}
.co-logo{width:54px;height:54px;border-radius:12px;background:var(--brand-soft);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--brand);overflow:hidden;flex-shrink:0}
.co-logo img{width:100%;height:100%;object-fit:contain;padding:8px}
.card-body{flex:1;min-width:0}
.card-badges{display:flex;align-items:center;gap:5px;margin-bottom:5px;flex-wrap:wrap}
.cat-dot{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;color:var(--cat-color,var(--brand))}
.cat-dot .dot{width:6px;height:6px;border-radius:50%;background:var(--cat-color,var(--brand))}
.job-title-card{font-size:14px;font-weight:700;color:var(--ink);line-height:1.3;margin-bottom:3px;transition:color .2s}
.job-card:hover .job-title-card{color:var(--cat-color,var(--brand))}
.job-co-card{font-size:11.5px;color:var(--ink2);font-weight:600;margin-bottom:7px;display:flex;align-items:center;gap:5px}
.verified-ico{font-size:11px}
.job-meta-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.card-right{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:9px;padding-top:9px;border-top:1px solid rgba(18,22,43,.06)}
.card-time-corner{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:600;color:var(--ink3)}
.salary-badge{font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--salary);background:rgba(15,174,121,.08);border:1px solid rgba(15,174,121,.18);padding:4px 11px;border-radius:8px;white-space:nowrap}
.act-btn{width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.6);border:1px solid var(--border2);color:var(--ink3);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;position:relative;z-index:1}
.act-btn:hover{background:var(--brand-soft);color:var(--brand);transform:scale(1.08)}
.act-btn.saved{background:rgba(245,166,35,.12);border-color:var(--amber);color:var(--amber)}

/* ── TAGS ── */
.tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 9px;border-radius:20px;font-weight:700;white-space:nowrap}
.tag-remote{background:rgba(15,174,121,.1);color:var(--green);border:1px solid rgba(15,174,121,.2)}
.tag-hybrid{background:rgba(245,166,35,.1);color:var(--amber);border:1px solid rgba(245,166,35,.2)}
.tag-onsite{background:var(--surface2);color:var(--ink2);border:none}
.tag-type{background:var(--surface2);color:var(--ink2);border:none}
.tag-new{background:var(--pastel-blue);color:var(--brand);border:none;font-size:10px;padding:3px 9px;font-weight:800;letter-spacing:.3px;border-radius:20px}
.tag-hot{background:var(--pastel-yellow);color:#B45309;border:none;font-size:10px;padding:3px 9px;font-weight:800;border-radius:20px}

/* ── TOAST ── */
.toast{position:fixed;bottom:20px;right:16px;background:var(--ink);border:1px solid var(--ink);border-radius:12px;padding:12px 18px;font-size:13px;color:#fff;display:flex;align-items:center;gap:10px;box-shadow:0 12px 32px rgba(18,22,43,.25);transform:translateY(100px);opacity:0;transition:all .3s;z-index:9999;max-width:300px}
.toast.show{transform:translateY(0);opacity:1}
.toast-bar{position:absolute;bottom:0;left:0;height:2px;background:var(--brand);border-radius:0 0 12px 12px;animation:toast-bar 3s linear forwards}

/* ── EMPTY / LOADER ── */
.empty{text-align:center;padding:60px 16px;color:var(--ink3)}
.empty .e-icon{font-size:44px;margin-bottom:12px;opacity:.5}
.empty h3{font-size:17px;color:var(--ink2);margin-bottom:6px;font-weight:700}
.empty p{font-size:13px}
.loader-wrap{padding:60px 16px;text-align:center}
.loader{display:inline-block;width:32px;height:32px;border:3px solid var(--border2);border-top-color:var(--brand);border-radius:50%;animation:spin .7s linear infinite}
.skel{background:linear-gradient(90deg,var(--surface) 25%,var(--surface2) 50%,var(--surface) 75%);background-size:200% 100%;animation:skeleton 1.5s infinite;border-radius:8px}

/* ── PAGINATION ── */
.pagination{display:flex;align-items:center;justify-content:center;gap:7px;padding:24px 0 12px}
.page-btn{padding:9px 17px;border-radius:9px;border:1.5px solid var(--border2);background:var(--surface);color:var(--ink2);font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .2s}
.page-btn:hover:not(:disabled){border-color:var(--brand);color:var(--brand)}
.page-btn:disabled{opacity:.35;cursor:default}
.page-info{font-size:13px;color:var(--ink3);padding:0 8px}

.ad-slot{border:1.5px dashed var(--border2);border-radius:12px;padding:14px;text-align:center;margin:16px 0;background:var(--surface2)}
.ad-slot-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink3);margin-bottom:4px}
.ad-slot-hint{font-size:11px;color:var(--ink3)}
.ad-slot-live{border:none;padding:0;background:transparent;display:flex;justify-content:center;overflow:hidden}

@media(max-width:768px){
  .hero{min-height:calc(100vh - 130px);min-height:calc(100svh - 130px);display:flex;flex-direction:column;justify-content:center;padding:40px 20px}
  .hero-title{font-size:42px;letter-spacing:-.9px;line-height:1.14;text-align:center}
  .hero-sub{font-size:15.5px;font-weight:600;color:rgba(255,255,255,.94);line-height:1.6;text-align:center;margin-bottom:30px}
  .search-card{padding:8px;margin-left:auto;margin-right:auto}
  .sc-row{padding:12px 14px}
  .hero-stats{gap:18px}
  .hero-stat-num{font-size:17px}
  .fc-logos{gap:28px}
  .fc-logos a{font-size:19px}
  .content-wrap{padding:14px}
  .card-inner{padding:14px 12px}
  .co-logo{width:42px;height:42px;border-radius:9px}
  .job-title-card{font-size:13px}
  .pagination{padding:20px 0 10px;gap:6px}
  .page-btn{padding:8px 13px;font-size:12px}
}
@media(max-width:380px){
  .hero-title{font-size:29px}
}
/* Final visual pass: the supplied UI reference mapped onto the live SSR markup. */
.hero{padding:66px 24px 84px;background:linear-gradient(116deg,#fff 0%,#fbfaff 55%,#f3efff 100%);border-bottom:1px solid #f0edf8}.hero::before{background:radial-gradient(ellipse 42% 80% at 82% 20%,rgba(117,75,236,.09),transparent 65%)}.hero-inner{max-width:1150px;min-height:390px}.hero-copy{width:min(560px,55%);padding-top:11px}.hero-eyebrow{background:none;border:0;color:var(--brand);font-size:10px;letter-spacing:1.1px;padding:0;margin-bottom:15px}.hero-title{font-family:'${heroFont.name}',sans-serif;font-size:clamp(40px,4.4vw,57px);letter-spacing:-2.3px;line-height:1.06;color:var(--ink);max-width:600px}.hero-title .hl{color:var(--brand)}.hero-title .hl::after{background:#cfc2ff}.hero-sub{color:#77748a;font-size:13px;max-width:450px}.hero-visual{right:-35px;top:0;width:560px;height:320px}.hero-map-grid{display:block}.hero-people-card{display:flex}.search-card{left:0;bottom:0;width:min(870px,86%);grid-template-columns:1.28fr 1fr 1fr 42px 122px;gap:9px;padding:13px 15px;border-radius:10px}.sc-field{display:grid}.sc-field>span{display:block}.sc-row{height:38px;padding:0 10px;margin-bottom:0;border-radius:6px}.sc-input,.sc-select{font-size:10px}.sc-search-btn{height:38px;border-radius:7px;padding:0 13px;font-size:10px}.filters-toggle-row{max-width:870px}.filters-panel{max-width:870px}.filters-clear-btn{color:var(--brand)}.popular-searches{bottom:-31px}.content-wrap{max-width:1150px;padding:24px}.category-strip{padding:22px 0}.category-inner{padding-top:0;padding-bottom:0}.cg-grid{grid-template-columns:repeat(8,minmax(0,1fr))}.cg-item{min-height:65px;min-width:0;padding:8px 10px}.cg-item>span:last-child{min-width:0}.cg-item strong{font-size:9px;white-space:normal;overflow-wrap:anywhere}.fc-strip{padding:31px 24px 28px}.fc-inner{max-width:1150px}.fc-logos{grid-template-columns:repeat(8,1fr);gap:0}.company-tile{min-height:112px}.jobs-section{padding-top:42px}.home-jobs-grid{grid-template-columns:minmax(0,1.72fr) minmax(230px,.72fr);gap:27px}.section-heading h2{font-size:19px}.job-card{border-radius:11px}.home-sidebar{display:grid}.side-card{border-radius:11px}.jobs-view-all{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;border:1px solid #bcaef2;border-radius:8px;min-height:34px;color:var(--brand);font-size:9px;font-weight:800}.jobs-view-all:hover{background:var(--brand-soft)}.card-secondary-meta{display:flex;align-items:center;justify-content:flex-end;gap:9px;min-width:0;flex:1}.card-save-btn{flex-shrink:0}.card-save-btn.saved{background:var(--brand-soft);border-color:#bdaef8;color:var(--brand)}.home-jobs-column .job-card{background:#fff!important}.home-jobs-column .job-card .card-inner{display:flex;align-items:center;gap:16px;padding:13px 16px}.home-jobs-column .job-card .card-row1{flex:1;min-width:0;align-items:center}.home-jobs-column .job-card .card-right{display:grid;grid-template-columns:minmax(92px,1fr) 30px;grid-template-rows:auto auto;align-items:center;gap:3px 10px;flex:0 0 205px;margin:0;padding:0;border:0}.home-jobs-column .job-card .card-secondary-meta{grid-column:1;grid-row:2;justify-content:flex-end;gap:8px}.home-jobs-column .job-card .salary-badge{grid-column:1;grid-row:1;justify-self:end}.home-jobs-column .job-card .card-save-btn{grid-column:2;grid-row:1 / span 2}.insights-strip{padding:24px 0 32px;background:#fff;border-top:1px solid #f0eef4}.insights-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}.insight-tile{display:block;border:1px solid #eceaf2;border-radius:10px;overflow:hidden;background:#fff;transition:all .18s}.insight-tile:hover{border-color:#c9bcf5;box-shadow:0 8px 18px rgba(48,31,121,.08);transform:translateY(-2px)}.insight-cover{height:100px;background-size:cover;background-position:center;display:flex;align-items:flex-end;padding:8px}.insight-cover span{background:rgba(99,57,230,.92);color:#fff;border-radius:4px;padding:3px 6px;font-size:8px;font-weight:800}.insight-tile>strong,.insight-tile>small{display:block;padding:0 10px}.insight-tile>strong{margin-top:9px;font-size:10px;line-height:1.45;color:#312d48}.insight-tile>small{margin:5px 0 11px;color:#8b8799;font-size:8px;line-height:1.5}.trust-grid{padding:24px 0}.cta-banner{background:linear-gradient(135deg,var(--brand),var(--brand2))}
@media(max-width:960px){.hero-visual{right:-150px;opacity:.65}.cg-grid,.fc-logos{grid-template-columns:repeat(4,1fr)}.cg-item:nth-child(4n),.company-tile:nth-child(4n){border-right:0}.cg-item:nth-child(-n+4),.company-tile:nth-child(-n+4){border-bottom:1px solid #f0eef5}.home-jobs-grid{grid-template-columns:1fr}.home-sidebar{grid-template-columns:repeat(2,1fr)}.resources-card{grid-column:span 2}.sf-top{grid-template-columns:1.4fr repeat(2,1fr)}}
@media(max-width:760px){.hero{min-height:555px;padding:50px 20px 42px}.hero-inner{min-height:555px}.hero-copy{width:100%;text-align:left}.hero-title{font-size:39px;letter-spacing:-2.1px;text-align:left}.hero-sub{font-size:12px;max-width:310px;text-align:left}.hero-visual{width:400px;right:-136px;top:169px;height:217px;opacity:.8}.hero-people-card{right:11px;top:113px}.search-card{bottom:54px;width:100%;display:grid;grid-template-columns:1fr;gap:8px;padding:12px}.sc-field{display:grid}.sc-slider-btn{display:none}.sc-search-btn{width:100%}.filters-panel{max-width:100%}.filters-toggle-row{max-width:100%}.popular-searches{bottom:18px;max-width:100%;overflow:hidden;gap:7px;white-space:nowrap}.category-strip{padding:29px 0 22px}.category-inner{padding:0 14px}.cg-grid{display:flex;overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:none}.cg-grid::-webkit-scrollbar{display:none}.cg-item{min-width:112px;flex:0 0 112px;flex-direction:column;justify-content:center;text-align:center;scroll-snap-align:start;border-right:1px solid #f0eef5!important;border-bottom:0!important}.fc-logos{display:flex;overflow-x:auto;scrollbar-width:none}.fc-logos::-webkit-scrollbar{display:none}.company-tile{min-width:118px;flex:0 0 118px;border-right:1px solid #efedf4!important}.insights-grid{grid-template-columns:repeat(2,1fr);gap:10px}.insight-cover{height:84px}.home-jobs-column .job-card .card-inner{display:block;padding:12px}.home-jobs-column .job-card .card-row1{display:flex}.home-jobs-column .job-card .card-right{display:flex;align-items:center;justify-content:flex-start;gap:7px;margin-top:8px;padding-top:8px;border-top:1px solid #f0eef4}.home-jobs-column .job-card .card-secondary-meta{justify-content:flex-start;overflow:hidden}.home-jobs-column .job-card .salary-badge{margin-left:auto}.home-jobs-column .job-card .card-save-btn{margin-left:0}.insights-grid{grid-template-columns:repeat(2,1fr);gap:10px}.insight-cover{height:84px}.jobs-section{padding-top:34px}.content-wrap{padding:14px}.home-sidebar{grid-template-columns:1fr}.resources-card{grid-column:auto}.job-tabs{gap:17px;overflow:auto}.job-tabs button{font-size:9px}.trust-grid{grid-template-columns:1fr 1fr;gap:18px}.trust-grid>div{justify-content:flex-start;border:0}.cta-banner{padding:20px}.cta-btn{width:100%}}
.job-tabs{display:flex;align-items:center;gap:21px;border-bottom:1px solid #efedf4;margin:0 0 12px;overflow-x:auto;scrollbar-width:none}.job-tabs::-webkit-scrollbar{display:none}.job-tabs button{position:relative;flex-shrink:0;border:0;background:transparent;color:#858094;padding:0 0 10px;font:800 10px 'Manrope',sans-serif;cursor:pointer;white-space:nowrap}.job-tabs button:hover{color:var(--brand)}.job-tabs button.active{color:var(--brand)}.job-tabs button.active::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:var(--brand)}.home-sidebar{display:grid;grid-template-columns:1fr;gap:11px}.side-card{border:1px solid #eceaf2;border-radius:11px;padding:17px;background:#fff;box-shadow:0 6px 18px rgba(38,25,99,.05);position:relative;overflow:hidden}.side-card-icon{width:34px;height:34px;border-radius:9px;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center;margin-bottom:11px}.side-card h3{font:800 14px 'Space Grotesk',sans-serif;color:var(--ink);margin-bottom:6px}.side-card p{font-size:11px;line-height:1.65;color:#817c90;margin-bottom:13px}.side-button{display:inline-flex;align-items:center;gap:5px;color:var(--brand);font-size:10px;font-weight:800}.side-button:hover{color:var(--brand2)}.resume-card{background:linear-gradient(135deg,#6b45e6 0%,#4e2acc 100%);border-color:#6841dd;min-height:170px}.resume-card h3,.resume-card p{color:#fff}.resume-card p{color:rgba(255,255,255,.8)}.resume-card .eyebrow{color:#e2d9ff}.resume-card .side-button.light{color:#fff;background:rgba(255,255,255,.16);padding:8px 11px;border-radius:7px}.resume-orbit{position:absolute;right:-20px;bottom:-30px;width:128px;height:128px;border:1px solid rgba(255,255,255,.25);border-radius:50%;opacity:.8}.resume-orbit:before,.resume-orbit:after{content:'';position:absolute;inset:13px;border:1px solid rgba(255,255,255,.22);border-radius:50%}.resume-orbit:after{inset:32px}.resources-card h3{margin-bottom:7px}.resources-card a{display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid #f0eef4;color:#6f6a7f;font-size:10px;font-weight:700}.resources-card a svg:first-child{color:var(--brand)}.resources-card a svg:last-child{margin-left:auto}.resources-card a:hover{color:var(--brand)}.toast{z-index:9999}
@media(max-width:760px){.job-tabs{gap:19px;margin-top:4px}.job-tabs button{font-size:10px}.home-sidebar{gap:10px}.side-card{padding:15px;border-radius:10px}.side-card-icon{width:32px;height:32px}.side-card h3{font-size:15px}.side-card p{font-size:11px}.resume-card{min-height:150px}.resources-card a{padding:10px 0}.toast{left:14px;right:14px;bottom:82px;max-width:none}}
@media(max-width:400px){.hero-title{font-size:34px}.filters-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
${navHtml(settings, menuPages, navButtons, user)}
${mobileHeaderHtml(settings, menuPages, navButtons, user)}
${mobileBottomNavHtml('/', user)}

<main>
  <!-- JOBS VIEW -->
  <div id="vJobs">
    ${homepageSectionsHtml}
  </div>

  <!-- SAVED -->
  <div id="vSaved" style="display:none">
    <div class="content-wrap" style="max-width:800px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <h2 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:8px">${iconBookmark({ size: 20 })} Saved Jobs</h2>
        <button onclick="clearAllSaved()" style="padding:7px 14px;border-radius:8px;border:1px solid var(--border2);background:transparent;color:var(--ink3);font-size:12px;cursor:pointer;font-family:inherit;font-weight:600">Clear All</button>
      </div>
      <div class="jobs-list" id="savedList"></div>
    </div>
  </div>
</main>

${footerHtml(base, settings, footerPages)}
${postJobModalHtml(categoryOrder, categoryMap)}

<div class="toast" id="toast">
  <span id="toastIcon" style="font-size:16px;display:inline-flex"></span>
  <span id="toastMsg">Done</span>
  <div class="toast-bar" id="toastBar"></div>
</div>

<script>window.__CATEGORY_META__=${JSON.stringify(categoryMap)};window.__CATEGORY_ORDER__=${JSON.stringify(categoryOrder)};window.__ICONS__=${JSON.stringify(CLIENT_ICONS)};window.__JOB_TYPE_META__=${JSON.stringify(JOB_TYPE_META)};window.__JOB_CARD_STYLES__=${JSON.stringify(cardStyles)};window.__FEATURES__=${JSON.stringify({ featuredJobs: featuredEnabled })};window.__HOT_PAY_LABEL__=${JSON.stringify(HOT_PAY_LABEL)};</script>
<script>
const CAT_META=window.__CATEGORY_META__;
const CAT_ORDER=window.__CATEGORY_ORDER__;
const ICONS=window.__ICONS__;
const COMPANY_LOGOS=${JSON.stringify(companyLogoMap).replace(/</g,'\\u003c')};
const JOB_TYPE_META=window.__JOB_TYPE_META__;
const JOB_CARD_STYLES=window.__JOB_CARD_STYLES__;
const FEATURES=window.__FEATURES__;
 const HOT_PAY_LABEL=window.__HOT_PAY_LABEL__||'HOT PAY';
function normalizeJobType(t){return(t&&JOB_TYPE_META[t])?t:'Free';}
// Mirrors lib/job-card-styles.js's buildCardStyleAttr/buildBadgeStyleAttr
// exactly (same shadow presets, same gradient/solid logic) so cards
// re-rendered client-side after a filter/search look identical to the
// server-rendered ones — both read from the same JOB_CARD_STYLES data.
const JT_SHADOWS={none:'none',soft:'0 4px 18px rgba(18,22,43,.10)',strong:'0 8px 26px rgba(18,22,43,.18)'};
function jtStyleFor(t){return JOB_CARD_STYLES[normalizeJobType(t)];}
function jtCardStyleAttr(t,freeTint){
  const s=jtStyleFor(t);
  const bg=s.bg_type==='gradient'?\`linear-gradient(\${s.gradient_angle}deg, \${s.bg_color1}, \${s.bg_color2})\`:s.bg_color1;
  const border=s.border_style==='none'?'none':\`\${s.border_width}px \${s.border_style} \${s.border_color}\`;
  const shadow=JT_SHADOWS[s.shadow]||JT_SHADOWS.none;
  const finalBg=(normalizeJobType(t)==='Free'&&freeTint)?freeTint:bg;
  return \`background:\${finalBg};border:\${border};box-shadow:\${shadow}\`;
}
function jobTypeBadge(t){
  const type=normalizeJobType(t);
  if(type==='Free')return'';
  const meta=JOB_TYPE_META[type];
  const s=jtStyleFor(type);
  return \`<span class="jt-badge" style="background:\${s.badge_bg_color};color:\${s.badge_text_color}">\${meta.icon} \${meta.label}</span>\`;
}
function jobTypeCardClass(t){
  const type=normalizeJobType(t);
  return type==='Free'?'':' jt-card-'+type.toLowerCase();
}
let pg=1,cat='',srch='',advT,srchT;
let jobs=${JSON.stringify(initialJobs)},total=${initialTotal};
const IS_AUTHENTICATED=${user ? 'true' : 'false'};
let savedIds=IS_AUTHENTICATED?[]:JSON.parse(localStorage.getItem('jn_saved')||'[]');
let adv={};
let hasLoadedOnce=true;

function initials(n){return(n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';}
function escHtml(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}
function slugifyClient(v){
  return (String(v||'').toLowerCase().trim().replace(/[^a-z0-9\\s-]/g,'').replace(/\\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80))||'na';
}
function logoDomain(value){
  try{
    const raw=String(value||'').trim();
    const parsed=new URL(/^https?:\\/\\//i.test(raw)?raw:'https://'+raw);
    const host=parsed.hostname.toLowerCase();
    if(!host||host==='localhost'||host.endsWith('.local')||/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(host))return'';
    return host;
  }catch(e){return'';}
}
function logoHtml(co,sz='54px',jobLogo='',website=''){
  const name=String(co||'?');
  // Priority mirrors job-card.js's logoImgHtml(): admin/employer override
  // -> automatic /logo/<slug>.png proxy (Worker-side fetch, edge-cached,
  // never a direct third-party request from this browser) -> monogram.
  const override=jobLogo||COMPANY_LOGOS[name.toLowerCase()]||'';
  const slug=slugifyClient(name);
  const domain=logoDomain(website);
  const logo=override||(slug&&slug!=='na'?'/logo/'+slug+'.png'+(domain?'?domain='+encodeURIComponent(domain):''):'');
  const ini=initials(name);
  const fs=Math.round(parseInt(sz)*.32)+'px';
  if(!logo)return \`<div class="co-logo monogram-logo" role="img" aria-label="\${escHtml(name)}" style="width:\${sz};height:\${sz};display:flex;align-items:center;justify-content:center;font-size:\${fs};font-weight:800;color:#6339E6">\${escHtml(ini)}</div>\`;
  return \`<div class="co-logo" style="width:\${sz};height:\${sz}">
    <img src="\${escHtml(logo)}" alt="\${escHtml(name)}" loading="lazy" style="width:100%;height:100%;object-fit:contain;padding:6px" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex'">
    <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:\${fs};font-weight:800;color:#6339E6">\${escHtml(ini)}</span>
  </div>\`;
}
function remoteTag(t){
  if(!t)return'';
  const m={fully_remote:['tag-remote',ICONS.globe+' Remote'],hybrid:['tag-hybrid',ICONS.building+' Hybrid'],on_site:['tag-onsite',ICONS.mapPin+' On-site'],onsite:['tag-onsite',ICONS.mapPin+' On-site']};
  const[cls,lbl]=m[t]||['tag-onsite',t.replace(/_/g,' ')];
  return\`<span class="tag \${cls}">\${lbl}</span>\`;
}
function catForTitle(title){
  const t=(title||'').toLowerCase();
  for(const k of CAT_ORDER){if(t.includes(k))return k;}
  return CAT_ORDER[0]||'developer';
}
function pastelFor(j){
  if(FEATURES.featuredJobs && j.featured)return'var(--pastel-blue)';
  if(j.isHotPay)return'var(--pastel-yellow)';
  return'var(--surface)';
}
function isNew(ts){if(!ts)return false;return Date.now()-new Date(ts).getTime()<86400000;}
function getTimeAgo(date){
  const diff=Date.now()-date.getTime();
  const h=Math.floor(diff/3600000);
  const d=Math.floor(diff/86400000);
  if(h<1)return'just now';
  if(h<24)return h+'h ago';
  return d+'d ago';
}

let toastTimer;
function showToast(msg,type='success'){
  const el=document.getElementById('toast');
  const icon=document.getElementById('toastIcon');
  const bar=document.getElementById('toastBar');
  document.getElementById('toastMsg').textContent=msg;
  icon.innerHTML=type==='success'?ICONS.check:ICONS.info;
  icon.style.color=type==='success'?'#059669':'#2563EB';
  el.className='toast show';
  if(bar){bar.style.animation='none';bar.offsetHeight;bar.style.animation='toast-bar 3s linear forwards';}
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),3100);
}

const VIEWS=['vJobs','vSaved'];
function showView(id){
  VIEWS.forEach(v=>{const el=document.getElementById(v);if(el)el.style.display=v===id?'block':'none';});
  window.scrollTo({top:0,behavior:'smooth'});
}
function goView(v){
  if(v==='jobs'){showView('vJobs');return;}
  if(v==='saved'){showView('vSaved');renderSaved();return;}
}
window.goView=goView;
if(IS_AUTHENTICATED){fetch('/api/user/saved-jobs').then(function(res){return res.ok?res.json():null;}).then(function(data){if(data&&Array.isArray(data.job_ids)){savedIds=data.job_ids;syncSaveButtons();}}).catch(function(){});}
function renderSkeletons(){
  return Array(4).fill(0).map(()=>\`
    <div class="job-card" style="pointer-events:none">
      <div class="card-inner">
        <div class="card-row1">
          <div class="skel" style="width:46px;height:46px;border-radius:10px;flex-shrink:0"></div>
          <div class="card-body">
            <div class="skel" style="height:12px;width:55%;margin-bottom:8px;border-radius:5px"></div>
            <div class="skel" style="height:16px;width:80%;margin-bottom:8px;border-radius:5px"></div>
            <div class="skel" style="height:11px;width:40%;border-radius:5px"></div>
          </div>
        </div>
      </div>
    </div>\`).join('');
}

function esc(s){
  if(s===null||s===undefined)return'';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function renderJobsList(){
  document.getElementById('jobsList').innerHTML=jobs.map((j,idx)=>{
    const nw=isNew(j.created_at);
    const hot=j.isHotPay===true;
    const timeAgo=j.created_at?getTimeAgo(new Date(j.created_at)):'';
    const k=catForTitle(j.title);
    const meta=CAT_META[k];
    const bg=pastelFor(j);
    const jts=jtStyleFor(j.job_type);
    return\`<article class="job-card\${jobTypeCardClass(j.job_type)}" style="--cat-color:\${meta.color};\${jtCardStyleAttr(j.job_type,bg)};animation:fadeInUp .3s ease \${Math.min(idx,6)*.04}s both">
      <div class="card-inner" style="padding:\${jts.card_padding}px 16px">
        <a href="/job/\${j.id}" class="card-row1" aria-label="View \${esc(j.title)} at \${esc(j.company)}">
          \${logoHtml(j.company,jts.logo_size+'px',j.company_logo_url,j.company_website)}
          <div class="card-body">
            <div class="card-badges">
              \${jobTypeBadge(j.job_type)}
              <span class="cat-dot"><span class="dot"></span>\${esc(meta.label)}</span>
              \${FEATURES.featuredJobs && j.featured?'<span class="tag-pinned">'+ICONS.pin+' Pinned</span>':''}
              \${nw?'<span class="tag-new">'+ICONS.sparkle+' NEW</span>':''}
              \${hot?'<span class="tag-hot">'+ICONS.flame+' '+HOT_PAY_LABEL+'</span>':''}
            </div>
            <div class="job-title-card">\${esc(j.title)}</div>
            <div class="job-co-card">\${esc(j.company)} \${j.is_verified?'<span class="verified-ico" title="Verified Company">'+ICONS.badgeCheck+'</span>':''}</div>
            <div class="job-meta-row">
              \${remoteTag(j.remote_type)}
              \${j.employment_type?'<span class="tag tag-type">'+esc(j.employment_type.replace(/_/g,' '))+'</span>':''}
              \${j.seniority?'<span class="tag tag-type">'+esc(j.seniority)+'</span>':''}
            </div>
            \${normalizeJobType(j.job_type)==='Sponsored'&&j.job_type_note?'<div class="jt-note">'+esc(j.job_type_note)+'</div>':''}
          </div>
        </a>
        \${'<div class="card-right"><div class="card-secondary-meta">'+(j.location?'<span class="job-location job-location-v2" title="Job location">'+ICONS.mapPin+' '+esc(j.location)+'</span>':'')+(timeAgo?'<span class="card-time-corner">'+ICONS.clock+' '+timeAgo+'</span>':'')+'</div>'+(j.salary?'<div class="salary-badge">'+esc(j.salary)+'</div>':'')+'<button class="act-btn card-save-btn" id="sb-'+j.id+'" onclick="event.preventDefault();event.stopPropagation();toggleSave('+j.id+')" aria-label="Save job" title="Save job">'+ICONS.bookmark+'</button></div>'}
      </div>
    </article>\`;
  }).join('');
}

function buildQueryParams(){
  const p=new URLSearchParams();
  p.set('page',pg);
  if(cat)p.set('category',cat);
  if(srch)p.set('search',srch);
  if(adv.remote)p.set('remote_type',adv.remote);
  if(adv.employ)p.set('employment_type',adv.employ);
  if(adv.seniority)p.set('seniority',adv.seniority);
  if(adv.salaryMin)p.set('salary_min',adv.salaryMin);
  if(adv.salaryMax)p.set('salary_max',adv.salaryMax);
  if(adv.days)p.set('days',adv.days);
  if(adv.sourceType)p.set('source_type',adv.sourceType);
  if(adv.sort&&adv.sort!=='relevance')p.set('sort',adv.sort);
  if(adv.country)p.set('country',adv.country);
  if(adv.skill)p.set('skill',adv.skill);
  if(adv.company)p.set('company',adv.company);
  return p;
}

// Advanced Pagination (Stage 9) — URL State + Browser Navigation. Every
// filter/search/sort/page change was previously kept ONLY in JS memory:
// the address bar never changed, so refreshing, sharing the link, or
// using Back/Forward all silently lost the current search entirely and
// landed back on the plain unfiltered homepage. updateUrlBar() mirrors
// the exact state loadJobs() just fetched into the address bar (page=1
// omitted for a clean default URL); pushHistory=true is used ONLY for
// an actual page-to-page navigation (Next/Prev/page number), since that
// is the one action a user genuinely expects the Back button to step
// through — a filter/search/sort change instead REPLACES the current
// history entry, so idly adjusting five filters in a row doesn't require
// mashing Back five times to escape.
function updateUrlBar(pushHistory){
  const p=buildQueryParams();
  if(p.get('page')==='1')p.delete('page');
  const qs=p.toString();
  const newUrl=window.location.pathname+(qs?'?'+qs:'');
  if(newUrl===window.location.pathname+window.location.search)return;
  if(pushHistory)history.pushState({jnSearch:true},'',newUrl);
  else history.replaceState({jnSearch:true},'',newUrl);
}

// Reads state BACK out of the URL — used on first load (so a shared/
// refreshed link actually restores the filtered view instead of the
// plain homepage) and on popstate (Back/Forward). Also syncs the actual
// form controls' displayed values, not just the in-memory cat/adv
// object, since a restored filter that doesn't visually show up as
// selected in its dropdown would look like the search silently failed.
function applyStateFromUrl(){
  const p=new URLSearchParams(window.location.search);
  cat=p.get('category')||'';
  srch=p.get('search')||'';
  pg=Math.max(1,parseInt(p.get('page')||'1',10)||1);
  adv={
    remote:p.get('remote_type')||'', employ:p.get('employment_type')||'',
    seniority:p.get('seniority')||'', salaryMin:p.get('salary_min')||'',
    salaryMax:p.get('salary_max')||'', days:p.get('days')||'',
    sourceType:p.get('source_type')||'', sort:p.get('sort')||'relevance',
    country:p.get('country')||'', skill:p.get('skill')||'', company:p.get('company')||'',
  };
  const setVal=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  setVal('fCategory',cat); setVal('searchInput',srch); setVal('fCountry',adv.country); setVal('fRemote',adv.remote);
  setVal('fEmploy',adv.employ); setVal('fSeniority',adv.seniority); setVal('fSalaryMin',adv.salaryMin);
  setVal('fSalaryMax',adv.salaryMax); setVal('fDays',adv.days); setVal('fSourceType',adv.sourceType);
  setVal('fSort',adv.sort);
  document.querySelectorAll('.chip[data-cat]').forEach(el=>el.classList.toggle('active',el.dataset.cat===cat));
  updateFiltersBadge();
  return p.toString().length>0; // true if the URL actually carried any search state
}

async function loadJobs(pushHistory){
  document.getElementById('jobsList').innerHTML=renderSkeletons();
  const paginationEl=document.getElementById('pagination');
  if(paginationEl)paginationEl.innerHTML='';
  const p=buildQueryParams();
  try{
    const res=await fetch('/api/jobs?'+p);
    const data=await res.json();
    jobs=data.jobs||[];total=data.total||0;
    updateUrlBar(!!pushHistory);
    document.getElementById('resultsCount').innerHTML=\`<strong>\${total.toLocaleString()}</strong> jobs found\${cat?' in <strong>'+(CAT_META[cat]?CAT_META[cat].label:cat)+'</strong>':''}\${adv.country?' in <strong>'+esc(adv.country)+'</strong>':''}\${adv.skill?' with <strong>'+esc(adv.skill)+'</strong>':''}\${adv.company?' at <strong>'+esc(adv.company)+'</strong>':''}\${srch?' for "<strong>'+srch+'</strong>"':''}\`;
    if(!jobs.length){
      document.getElementById('jobsList').innerHTML=\`<div class="empty"><div class="e-icon">\${ICONS.searchLg}</div><h3>No jobs found</h3><p>Try a different keyword, remove a filter, or widen the location.</p><button onclick="clearFilters()" class="filters-clear-btn" style="display:inline-flex;margin-top:12px">Clear all filters</button></div>\`;
      return;
    }
    renderJobsList();
    syncSaveButtons();
    renderPagination();
  }catch(e){
    document.getElementById('jobsList').innerHTML=\`<div class="empty"><div class="e-icon">\${ICONS.alertTriangle}</div><h3>Failed to load</h3><p>Refresh and try again</p></div>\`;
  }
}

function syncSaveButtons(){document.querySelectorAll('.card-save-btn[id^="sb-"]').forEach(btn=>{const id=Number(btn.id.slice(3));btn.classList.toggle('saved',savedIds.includes(id));});}
function redirectToLogin(){const next=window.location.pathname+window.location.search;window.location.href='/login?next='+encodeURIComponent(next);}
function toggleSave(id){
  if(!IS_AUTHENTICATED){showToast('Sign in to save jobs','info');setTimeout(redirectToLogin,450);return;}
  const idx=savedIds.indexOf(id);
  const nowSaved = idx < 0;
  if(idx>=0){savedIds.splice(idx,1);showToast('Removed from saved','info');}
  else{savedIds.push(id);showToast('Job saved!');}
  localStorage.setItem('jn_saved',JSON.stringify(savedIds));
  const btn=document.getElementById('sb-'+id);
  if(btn)btn.classList.toggle('saved',savedIds.includes(id));
  fetch('/api/user/saved-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:id,action:nowSaved?'save':'unsave'})}).then(function(res){if(!res.ok)throw new Error('save failed');}).catch(function(){showToast('Unable to update saved jobs','info');});
}
window.toggleSave=toggleSave;
function shareJob(id){
  const url=window.location.origin+'/job/'+id;
  navigator.clipboard.writeText(url).then(()=>showToast('Link copied!')).catch(()=>showToast('Copied!'));
}
window.shareJob=shareJob;

function renderSaved(){
  if(!savedIds.length){
    document.getElementById('savedList').innerHTML=\`<div class="empty"><div class="e-icon">\${ICONS.bookmark}</div><h3>No saved jobs yet</h3><p>Tap the bookmark icon to save jobs</p></div>\`;
    return;
  }
  const saved=jobs.filter(j=>savedIds.includes(j.id));
  if(!saved.length){
    document.getElementById('savedList').innerHTML=\`<div class="empty"><div class="e-icon">\${ICONS.bookmark}</div><h3>Browse jobs and save the ones you like</h3></div>\`;
    return;
  }
  document.getElementById('savedList').innerHTML=saved.map(j=>\`
    <article class="job-card">
      <div class="card-inner">
        <a href="/job/\${j.id}" class="card-row1" aria-label="View \${esc(j.title)} at \${esc(j.company)}">
          \${logoHtml(j.company,'54px','',j.company_website)}
          <div class="card-body">
            <div class="job-title-card">\${esc(j.title)}</div>
            <div class="job-co-card">\${esc(j.company)}</div>
            <div class="job-meta-row">\${remoteTag(j.remote_type)}</div>
          </div>
        </a>
        <div class="card-right">
          \${j.salary?'<div class="salary-badge">'+esc(j.salary)+'</div>':'<div></div>'}
          <button class="act-btn saved" aria-label="Remove saved job" onclick="event.preventDefault();toggleSave(\${j.id});renderSaved()">\${ICONS.bookmark}</button>
        </div>
      </div>
    </article>\`).join('');
}

function clearAllSaved(){savedIds=[];localStorage.removeItem('jn_saved');renderSaved();showToast('All cleared','info');}

function setSearchAndGo(v){const input=document.getElementById('searchInput');if(input)input.value=v;srch=v;pg=1;loadJobs();}
function quickJobTab(type,btn){document.querySelectorAll('.job-tabs button').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');if(type==='all'){adv.remote='';adv.employ='';}else if(type==='remote'){adv.remote='fully_remote';adv.employ='';}else{adv.remote='';adv.employ=type;}const remote=document.getElementById('fRemote');const employ=document.getElementById('fEmploy');if(remote)remote.value=adv.remote;if(employ)employ.value=adv.employ;pg=1;updateFiltersBadge();loadJobs();}
function debounceSearch(v){clearTimeout(srchT);srchT=setTimeout(()=>{srch=v;pg=1;loadJobs();},400);}
function debounceCountryChange(v){clearTimeout(srchT);srchT=setTimeout(()=>{adv.country=v.trim();pg=1;updateFiltersBadge();loadJobs();},450);}

// ── Filters panel (attached to the hero search box) ──────────────
function toggleFiltersPanel(){
  document.getElementById('filtersPanel').classList.toggle('open');
  document.getElementById('filtersToggleBtn').classList.toggle('active');
}
function updateFiltersBadge(){
  // adv.sort defaults to 'relevance' once the Sort dropdown exists in the
  // DOM — that's a no-op choice, not an active filter, so it's excluded
  // from the count (otherwise the badge would always show "1" the moment
  // someone opens the filters panel, even with nothing actually filtered).
  const activeAdvCount=Object.entries(adv).filter(([k,v])=>v&&!(k==='sort'&&v==='relevance')).length;
  const count=(cat?1:0)+activeAdvCount;
  const badge=document.getElementById('filtersCountBadge');
  const clearBtn=document.getElementById('filtersClearBtn');
  if(count>0){badge.style.display='inline-block';badge.textContent=count;clearBtn.style.display='inline';}
  else{badge.style.display='none';clearBtn.style.display='none';}
}
function onFilterChange(){
  cat=document.getElementById('fCategory').value;
  adv.remote=document.getElementById('fRemote').value;
  adv.employ=document.getElementById('fEmploy').value;
  adv.country=document.getElementById('fCountry')?.value.trim() || '';
  adv.seniority=document.getElementById('fSeniority').value;
  adv.days=document.getElementById('fDays').value;
  adv.sourceType=document.getElementById('fSourceType').value;
  adv.sort=document.getElementById('fSort').value;
  pg=1;
  updateFiltersBadge();
  loadJobs();
}
let filterDebT;
function debounceFilterChange(){
  clearTimeout(filterDebT);
  filterDebT=setTimeout(()=>{
    adv.salaryMin=document.getElementById('fSalaryMin').value;
    adv.salaryMax=document.getElementById('fSalaryMax').value;
    pg=1;
    updateFiltersBadge();
    loadJobs();
  },500);
}
function clearFilters(){
  cat='';adv={};
  ['fCategory','fCountry','fRemote','fEmploy','fSeniority','fDays','fSalaryMin','fSalaryMax','fSourceType'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('fSort').value='relevance';
  pg=1;
  updateFiltersBadge();
  loadJobs();
}
function goPage(p){pg=p;loadJobs(true);window.scrollTo({top:0,behavior:'smooth'});}

function renderPagination(){
  const el=document.getElementById('pagination');
  if(!el)return;
  const tp=Math.ceil(total/20);
  el.innerHTML=tp>1?\`
    <button class="page-btn" onclick="goPage(\${pg-1})" \${pg===1?'disabled':''} aria-label="Previous page">← Prev</button>
    <span class="page-info" aria-current="page">Page \${pg} / \${tp}</span>
    <button class="page-btn" onclick="goPage(\${pg+1})" \${pg===tp?'disabled':''} aria-label="Next page">Next →</button>\`:'';
}

// bind actions on the server-rendered initial cards too, and fill in
// what only client JS can compute (relative time-ago is already SSR'd,
// but pagination needs the live "total" count known only after render)
document.addEventListener('DOMContentLoaded',()=>{
    savedIds.forEach(id=>{const b=document.getElementById('sb-'+id);if(b)b.classList.add('saved');});
    document.querySelectorAll('.card-save-btn').forEach(btn=>{const id=Number(btn.id.replace('sb-',''));if(savedIds.includes(id))btn.classList.add('saved');});
  // If the URL was opened WITH search state (shared link, refresh, or a
  // Back/Forward landing here), the server-side render above only ever
  // produced the plain unfiltered top-20 — re-fetch client-side with the
  // restored filters applied. A plain "/" with no params skips this
  // extra request entirely, keeping the original fast first paint.
  if(applyStateFromUrl())loadJobs(false);
  else renderPagination();
});
// Browser Back/Forward (plan Stage 9) — re-read whatever state the
// browser just navigated to and reload results to match, WITHOUT
// pushing yet another history entry (that would fight the browser's own
// navigation stack).
window.addEventListener('popstate',()=>{
  applyStateFromUrl();
  loadJobs(false);
});
</script>
</body>
</html>`;
}
