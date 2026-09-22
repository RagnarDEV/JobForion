// src/pages/home.js
// The homepage SPA shell: SSR job list (first page, for SEO + fast first paint),
// hero, featured-companies strip, filters, and all client-side interactivity.

import { readSiteCache, getSiteStats } from '../lib/platform/site-cache.js';
import { windowedJobs, cappedCount } from '../lib/platform/job-window.js';
import { ensureTable } from '../db/schema.js';
import { navHtml, mobileHeaderHtml, mobileBottomNavHtml } from '../components/nav.js';
import { footerHtml } from '../components/footer.js';
import { homeStyles } from './home/styles.js';
import { homeClientScript } from './home/client-script.js';
import { postJobModalHtml } from '../components/post-job-modal.js';
import { ICON_HEAD } from '../assets/favicon.js';
import { JOB_TYPE_META, JOB_MANUAL_PIN_SORT_SQL, PUBLIC_JOB_STATUS_SQL, JOB_LISTING_COLUMNS } from '../config/constants.js';
import { jobCardSSR, logoImgHtml } from '../components/job-card.js';
import { adSlot } from '../components/ad-slot.js';
import { escapeHtml, slugify, listCompanies } from '../lib/directory/entities.js';
import { googleAnalyticsTag } from '../lib/analytics/tag.js';
import { analyticsTrackerScript } from '../lib/analytics/tracker.js';
import { getSettings, HOMEPAGE_COPY_DEFAULTS, HERO_FONT_OPTIONS, resolveTheme } from '../lib/platform/settings.js';
import { getCategories } from '../lib/content/categories.js';
import { getCardStyles } from '../lib/jobs/job-card-styles.js';
import { getAdSlotsConfig } from '../lib/content/ad-slots.js';
import { getFooterPages, getMenuPages } from '../lib/content/pages-cms.js';
import { getNavButtons } from '../lib/content/nav-buttons.js';
import { getEnabledHomepageSections } from '../lib/content/homepage-sections.js';
import { getEnabledHomepageCustomSections } from '../lib/content/homepage-custom-sections.js';
import { pageCodeFrameHtml } from '../components/page-code-editor.js';
import { categoryIconSvg } from '../lib/content/category-icons.js';
import { getVerifiedCompanyNameSet, listPublicCompanies } from '../lib/companies/companies.js';
import { getLogoOverrides, attachCompanyLogos } from '../lib/companies/company-logos.js';
import { hydrateHotPay, HOT_PAY_LABEL } from '../lib/jobs/hot-pay.js';
import { getPosts } from '../lib/content/blog-cms.js';
import { iconSparkle, iconFlame, iconPin, iconMapPin, iconBookmark, iconLink, iconBadgeCheck, iconClock, iconGlobe, iconBuilding, iconSearch, iconCheck, iconInfo, iconAlertTriangle, iconChevronDown, iconSliders, iconX, iconBell, iconFileText, iconPlus, iconBriefcase, iconArrowRight, iconTierStar, iconTierCrown, iconTierRocket, iconInbox } from '../assets/icons.js';

// Same icon markup used by the server-rendered cards (job-card.js) is
// reused for client-rendered cards (search/filter/pagination results) by
// serializing it once here and injecting it as data — guarantees the two
// renderers can never visually drift apart, and avoids duplicating SVG
// path data in two places.
const CLIENT_ICONS = {
  sparkle: iconSparkle({ size: 11 }), flame: iconFlame({ size: 11 }), pin: iconPin({ size: 11 }),
  mapPin: iconMapPin({ size: 11 }), bookmark: iconBookmark(), link: iconLink(),
  badgeCheck: iconBadgeCheck({ size: 12 }), clock: iconClock({ size: 11 }),
  globe: iconGlobe({ size: 11 }), building: iconBuilding({ size: 11 }), search: iconSearch({ size: 16 }),
  check: iconCheck({ size: 16 }), info: iconInfo({ size: 16 }), alertTriangle: iconAlertTriangle({ size: 32 }),
  searchLg: iconSearch({ size: 32 }),
  tierStar: iconTierStar({ size: 12, cls: 'jt-badge-icon' }), tierCrown: iconTierCrown({ size: 12, cls: 'jt-badge-icon' }), tierRocket: iconTierRocket({ size: 12, cls: 'jt-badge-icon' }),
};

async function getCategoryCounts(env, categories) {
  const rows = Array.isArray(categories) ? categories.filter(c => c?.key) : [];
  const counts = Object.fromEntries(rows.map(c => [c.key, 0]));
  if (!rows.length) return counts;
  // ROW-READ BUDGET: read the precomputed counts (1 row). Only when they do not
  // exist yet (first run after a deploy) fall back to ONE aggregate over the
  // most recent DIRECTORY_WINDOW jobs — never over the whole table.
  const cached = await readSiteCache(env, 'cat:counts');
  if (cached) { rows.forEach(c => { counts[c.key] = Number(cached[String(c.key).toLowerCase()] || 0); }); return counts; }
  const expressions = rows.map((_, index) => `SUM(CASE WHEN LOWER(title) LIKE ? THEN 1 ELSE 0 END) AS c${index}`).join(', ');
  try {
    const { results } = await env.DB.prepare(`SELECT ${expressions} FROM ${windowedJobs()}`).bind(...rows.map(c => `%${String(c.key).toLowerCase()}%`)).all();
    const aggregate = results?.[0] || {};
    rows.forEach((c, index) => { counts[c.key] = Number(aggregate[`c${index}`] || 0); });
  } catch (e) {}
  return counts;
}

export async function renderMainHTML(env, base, user = null) {
  await ensureTable(env);
  // PERFORMANCE: these reads are independent, so they run concurrently instead
  // of as ~11 sequential D1 round-trips (each is isolate-cached when warm, but a
  // cold isolate paid every one of them in series).
  const [settings, categories, cardStyles, adConfig, footerPages, menuPages, navButtons, enabledSections, enabledCustomSections, verifiedCompanySet, blogPosts] = await Promise.all([
    getSettings(env), getCategories(env), getCardStyles(env), getAdSlotsConfig(env),
    getFooterPages(env), getMenuPages(env), getNavButtons(env),
    getEnabledHomepageSections(env), getEnabledHomepageCustomSections(env),
    getVerifiedCompanyNameSet(env),
    getPosts(env, { limit: 4 }).catch(() => []),
  ]);
  const categoryOrder = categories.map(c => c.key);
  const categoryMap = Object.fromEntries(categories.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }]));
  const categoryCounts = await getCategoryCounts(env, categories.slice(0, 8));
  const adsEnabled = settings.ads_enabled !== '0';
  // Homepage Sections Builder (Admin Dashboard V2, Phase 4) — which
  // blocks render and in what order, per /admin/homepage. Falls back to
  // every section enabled in its default order (see
  // lib/content/homepage-sections.js) if the table is empty/unreachable, so a
  // fresh install or a transient D1 hiccup renders the homepage exactly
  // as it always has — never a blank or broken page.
  // Hero customization (see /admin/settings  "Hero & Branding") — falls
  // back to HERO_FONT_OPTIONS[0] (Plus Jakarta Sans, the brand's display
  // font) for any unrecognized/stale value, so a bad save can never
  // leave the heading with no font applied at all.
  const heroFont = HERO_FONT_OPTIONS.find(f => f.name === settings.hero_heading_font) || HERO_FONT_OPTIONS[0];
  const resolvedTheme = resolveTheme(settings);
  const googleFontParams = {
    'Manrope': 'Manrope:wght@400;500;600;700;800',
    'Inter': 'Inter:wght@400;500;600;700;800',
    'Plus Jakarta Sans': 'Plus+Jakarta+Sans:wght@400;500;600;700;800',
    'Poppins': 'Poppins:wght@400;500;600;700;800',
    'Space Grotesk': 'Space+Grotesk:wght@500;600;700;800',
    'Sora': 'Sora:wght@500;600;700;800',
    'Outfit': 'Outfit:wght@400;500;600;700;800',
  };
  const selectedGoogleFonts = [...new Set([resolvedTheme.fontFamily, resolvedTheme.headingFont, heroFont.name])]
    .map(name => googleFontParams[name]).filter(Boolean);
  const googleFontHref = `${selectedGoogleFonts.map(param => `family=${param}`).join('&')}&family=JetBrains+Mono:wght@500;700`;
  // Use the resolved D1 values exactly as entered in Settings. The defaults
  // already describe the current Hero, so a valid admin value must never be
  // silently rewritten just because it happens to match an older copy value.
  const heroTitleLine1 = settings.hero_title_line1 || 'Find the work you love.';
  const heroTitleLine2 = settings.hero_title_line2 || 'Anywhere in the world.';
  const heroSubtitle = settings.hero_subtitle || 'Discover flexible remote work from trusted companies, with global opportunities curated for the way you want to work.';
  const heroSearchButtonText = settings.hero_search_button_text || 'Search Jobs';
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
  // RESILIENT LOADING: the listing query names many columns that only exist
  // once the schema migration has finished. Previously ANY failure was
  // swallowed and the page showed an endless spinner (and that broken HTML was
  // edge-cached). Now each step has its own fallback and the page is marked
  // `degraded` so it is never cached and the browser re-fetches the list.
  let initialJobs = [], initialTotal = 0, totalJobsCount = 0, companiesCount = 0, jobsDegraded = false;
  const listingQueries = [
    `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE ${PUBLIC_JOB_STATUS_SQL} ORDER BY ${JOB_MANUAL_PIN_SORT_SQL} LIMIT 20`,
    `SELECT id,title,company,location,url,salary,remote_type,skills,seniority,employment_type,created_at,featured FROM jobs WHERE ${PUBLIC_JOB_STATUS_SQL} ORDER BY featured DESC, id DESC LIMIT 20`,
    `SELECT id,title,company,location,url,salary,remote_type,skills,seniority,employment_type,created_at FROM jobs ORDER BY id DESC LIMIT 20`,
  ];
  let jobRows = [];
  for (let attempt = 0; attempt < listingQueries.length; attempt++) {
    try {
      jobRows = (await env.DB.prepare(listingQueries[attempt]).all()).results || [];
      if (attempt > 0) jobsDegraded = true;
      break;
    } catch (e) {
      jobsDegraded = true;
      if (attempt === listingQueries.length - 1) console.error('[home] job listing query failed:', e && e.message || e);
    }
  }
  try { jobRows = await attachCompanyLogos(env, jobRows); } catch (e) { jobsDegraded = true; }
  try { jobRows = await hydrateHotPay(env, jobRows, settings); } catch (e) { jobsDegraded = true; }
  initialJobs = jobRows;
  // ROW-READ BUDGET: totals come from the precomputed stats row, never from a
  // live COUNT/COUNT(DISTINCT) over every job (that was ~40,000 rows per render).
  try {
    const stats = await getSiteStats(env);
    if (stats) {
      initialTotal = Number(stats.totalActive || 0);
      companiesCount = Number(stats.companies || 0);
    } else {
      // No stats yet (first run after a deploy): bounded, capped fallback.
      initialTotal = await cappedCount(env, 'jobs', PUBLIC_JOB_STATUS_SQL);
      companiesCount = 0;
    }
  } catch (e) {
    jobsDegraded = true;
    initialTotal = initialJobs.length;
  }
  if (!initialTotal) initialTotal = initialJobs.length;
  totalJobsCount = initialTotal;

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
    : (jobsDegraded
      ? `<div class="loader-wrap"><div class="loader"></div></div>`
      : `<div class="empty"><div class="e-icon">${iconInbox({ size: 44 })}</div><h3>No jobs yet</h3><p>New remote jobs are added every few hours — check back soon.</p></div>`);

  const siteName = escapeHtml(settings.site_name);
  const siteDescription = settings.site_description || `${settings.site_name} is a curated remote job board with ${totalJobsCount ? totalJobsCount.toLocaleString() + '+' : ''} verified positions in development, design, marketing, data and more. Updated every few hours.`;
  const robotsDirective = settings.seo_indexing_enabled === '0' ? 'noindex, nofollow' : 'index, follow';

  // ── Homepage Sections (Admin Dashboard V2, Phase 4) ─────────────────
  // Each section is built as a standalone HTML string here, then
  // assembled below in whatever order/subset `enabledSections` says.
  // `hero` and `job_listing` are `required: true` in
  // lib/content/homepage-sections.js and therefore always present — everything
  // else only renders if an admin has switched it on.
  const homepageSectionCodeMap = Object.fromEntries(enabledSections.map(section => [section.key, section]));
  function homepageCodeOverride(key, fallback, context = 'section') {
    const section = homepageSectionCodeMap[key];
    if (!section || !(section.custom_html || section.custom_css || section.custom_js)) return fallback;
    const frame = pageCodeFrameHtml({ html: section.custom_html, css: section.custom_css, js: section.custom_js, id: `homepage_builtin_${key}`, title: section.label });
    if (context === 'sidebar') return `<div class="homepage-code-sidebar-override side-card">${frame}</div>`;
    return `<section class="homepage-code-override homepage-code-override-${key}"><div class="content-wrap homepage-code-override-inner">${frame}</div></section>`;
  }

  const sidebarSectionHtml = {
    job_alerts: homepageCodeOverride('job_alerts', `<div class="side-card alert-card"><div class="side-card-icon">${iconBell({ size: 18 })}</div><h3>${escapeHtml(homepageCopy.alertsTitle)}</h3><p>${escapeHtml(homepageCopy.alertsText)}</p><a class="side-button" href="${user ? '/user/job-alerts' : '/register'}">${escapeHtml(homepageCopy.alertsCta)}</a></div>`, 'sidebar'),
    career_boost: homepageCodeOverride('career_boost', `<div class="side-card resume-card"><div><p class="eyebrow">STAND OUT</p><h3>${escapeHtml(homepageCopy.careerTitle)}</h3><p>${escapeHtml(homepageCopy.careerText)}</p><a class="side-button light" href="${user ? '/user/profile' : '/register'}">${escapeHtml(homepageCopy.careerCta)}</a></div><div class="resume-orbit"><span></span><span></span><span></span></div></div>`, 'sidebar'),
    career_resources: homepageCodeOverride('career_resources', `<div class="side-card resources-card"><h3>${escapeHtml(homepageCopy.resourcesTitle)}</h3><a href="/blog">${iconFileText({ size: 14 })}<span>Career advice</span></a><a href="/blog">${iconFileText({ size: 14 })}<span>Interview tips</span></a><a href="/skills">${iconFileText({ size: 14 })}<span>Browse by skill</span></a><a href="/countries">${iconFileText({ size: 14 })}<span>Remote by country</span></a></div>`, 'sidebar'),
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
          <label class="filter-field"><span>Salary tier</span><select id="fSalaryTier" onchange="onFilterChange()"><option value="">Any tier</option><option value="HIGH">HIGH</option><option value="GOOD">GOOD</option><option value="STANDARD">STANDARD</option></select></label>
          <label class="filter-field"><span>Posted within</span><select id="fDays" onchange="onFilterChange()"><option value="">Any time</option><option value="1">Last 24 hours</option><option value="3">Last 3 days</option><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</select></label>
          <label class="filter-field"><span>Source</span><select id="fSourceType" onchange="onFilterChange()"><option value="">Any</option><option value="employer">Direct from employer</option><option value="provider">Aggregated</option></select></label>
          <label class="filter-field"><span>Sort by</span><select id="fSort" onchange="onFilterChange()"><option value="relevance">Relevance</option><option value="newest">Newest</option><option value="updated">Recently updated</option><option value="salary">Highest salary</option><option value="oldest">Oldest</option></select></label>
        </div></div></div>
        <div class="popular-searches"><strong>Popular searches:</strong><button onclick="setSearchAndGo('developer')">Developer</button><button onclick="setSearchAndGo('designer')">Designer</button><button onclick="setSearchAndGo('marketing')">Marketing</button><button onclick="setSearchAndGo('data analyst')">Data analyst</button><button onclick="setSearchAndGo('customer support')">Customer Support</button></div>
      </div>
    </section>`,

    featured_companies: topCompanies.length ? `
    <section class="fc-strip homepage-reveal-section">
      <div class="fc-inner">
        <div class="fc-heading section-heading compact-heading">
          <div><p class="eyebrow">CURATED EMPLOYERS</p><h2>${escapeHtml(homepageCopy.featuredTitle)}</h2><p class="fc-subtitle">Discover teams building the future of remote work.</p></div>
          <a class="text-button fc-view-all" href="/companies">View all companies ${iconArrowRight({ size: 13 })}</a>
        </div>
        <div class="fc-logos" aria-label="Featured companies">${topCompanies.slice(0, 8).map(c => `<a class="company-tile" href="/companies/${escapeHtml(c.slug || slugify(c.name))}"><span class="company-tile-top">${logoImgHtml(c.name, '42px', 'company-logo', companyLogoMap[String(c.name || '').toLowerCase()] || null, c.website)}<span class="company-tile-arrow">${iconArrowRight({ size: 13 })}</span></span><strong>${escapeHtml(c.name)}</strong><small>${Number(c.count || 0).toLocaleString()} open roles</small></a>`).join('')}</div>
      </div>
    </section>` : '',

    categories_grid: categories.length ? `
    <section class="category-strip homepage-reveal-section"><div class="content-wrap category-inner">
      <div class="cg-heading section-heading compact-heading"><div><p class="eyebrow">EXPLORE OPPORTUNITIES</p><h2>${escapeHtml(homepageCopy.categoriesTitle)}</h2><p class="cg-subtitle">Find a role that fits the way you want to work.</p></div><a class="text-button" href="/jobs">Explore all roles ${iconArrowRight({ size: 13 })}</a></div>
      <div class="cg-grid">
        ${categories.slice(0, 8).map(c => { const swatch = /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#6339E6'; return `<a href="/categories/${c.key}" class="cg-item" style="--cat-color:${swatch}"><span class="cg-icon" style="background:${swatch}1a;color:${swatch}">${categoryIconSvg(c.key, { size: 18 })}</span><span class="cg-copy"><strong class="cg-label">${escapeHtml(c.label)}</strong><small>${categoryCounts[c.key] ? `${Number(categoryCounts[c.key]).toLocaleString()} open roles` : 'Explore roles'}</small></span><span class="cg-arrow">${iconArrowRight({ size: 13 })}</span></a>`; }).join('')}
      </div>
    </div></section>` : '',

    job_listing: `
    <section class="content-wrap jobs-section"><div class="home-jobs-grid${sidebarSectionsHtml ? '' : ' no-sidebar'}"><div class="home-jobs-column">
      <div class="section-heading jobs-heading"><div><p class="eyebrow">${escapeHtml(homepageCopy.jobsEyebrow)}</p><h2>${escapeHtml(homepageCopy.jobsTitle)}</h2></div><a class="text-button" href="/jobs">${escapeHtml(homepageCopy.jobsCta)}</a></div>
      <div class="job-tabs" role="tablist"><button class="active" data-job-tab="all" onclick="quickJobTab('all',this)">All jobs</button><button data-job-tab="remote" onclick="quickJobTab('remote',this)">Remote</button><button data-job-tab="full_time" onclick="quickJobTab('full_time',this)">Full-time</button><button data-job-tab="part_time" onclick="quickJobTab('part_time',this)">Part-time</button><button data-job-tab="contract" onclick="quickJobTab('contract',this)">Contract</button></div>
      <div class="results-hdr"><div class="results-count" id="resultsCount" style="display:none"><strong>${initialTotal.toLocaleString()}</strong> jobs found</div></div>
      ${adSlot('homepage-results-top', '', adConfig, adsEnabled)}
      <div class="jobs-list" id="jobsList"${jobsDegraded ? ' data-degraded="1"' : ''}>${ssrJobsHtml}</div><a class="jobs-view-all" href="/jobs">${escapeHtml(homepageCopy.jobsCta)}</a>
    </div>${sidebarSectionsHtml ? `<aside class="home-sidebar">${sidebarSectionsHtml}</aside>` : ''}</div></section>`,

    career_insights: blogPosts.length ? `<section class="insights-strip homepage-reveal-section"><div class="content-wrap"><div class="section-heading compact-heading"><div><p class="eyebrow">CAREER GUIDANCE</p><h2>${escapeHtml(homepageCopy.blogTitle)}</h2></div><a class="text-button" href="/blog">${escapeHtml(homepageCopy.blogCta)}</a></div><div class="insights-grid">${blogPosts.map((post, i) => `<a class="insight-tile" href="/blog/${escapeHtml(post.slug)}"><div class="insight-cover" style="${post.cover_image_url ? `background-image:url('${escapeHtml(post.cover_image_url)}')` : `background:linear-gradient(135deg,${['#6a53d8','#ed9d83','#54a9b5','#d47898'][i % 4]},#29244e)`}"><span>${escapeHtml(post.category || 'Career advice')}</span></div><strong>${escapeHtml(post.title)}</strong><small>${escapeHtml(post.excerpt || 'Practical guidance for your next remote opportunity.')}</small></a>`).join('')}</div></div></section>` : '',

    trust_strip: `<section class="trust-strip homepage-reveal-section"><div class="content-wrap trust-wrap"><div class="trust-card"><div class="trust-intro"><span class="trust-kicker">WHY JOBFORION</span><h2>Built for better remote work</h2><p>Everything you need to discover trusted opportunities with confidence.</p></div><div class="trust-grid"><div class="trust-item"><span class="trust-icon">⌁</span><p><strong>100% Remote Jobs</strong><small>Work from anywhere in the world</small></p></div><div class="trust-item"><span class="trust-icon">✓</span><p><strong>Verified companies</strong><small>Teams you can trust</small></p></div><div class="trust-item"><span class="trust-icon">✦</span><p><strong>Daily updates</strong><small>Fresh roles added every day</small></p></div><div class="trust-item"><span class="trust-icon">◌</span><p><strong>Free for job seekers</strong><small>Search and apply for free</small></p></div></div></div></div></section>`,

    employer_cta: `<section class="employer-cta-section homepage-reveal-section"><div class="content-wrap"><div class="cta-banner"><div class="cta-copy"><span class="cta-kicker">FOR EMPLOYERS</span><div class="cta-title">Build your next great team.</div><div class="cta-sub">Reach qualified candidates and post your job in minutes.</div><div class="cta-actions"><button class="cta-btn" onclick="openPostJobModal()">${iconPlus({ size: 13 })} Post a job</button><a class="cta-secondary" href="/companies">Explore employer resources ${iconArrowRight({ size: 13 })}</a></div></div><div class="cta-art" aria-hidden="true"><span class="cta-orbit cta-orbit-one"></span><span class="cta-orbit cta-orbit-two"></span><span class="cta-art-card cta-art-card-main">${iconBuilding({ size: 25 })}<strong>Remote-ready teams</strong><small>Made for modern hiring</small></span><span class="cta-art-card cta-art-card-mini">${iconBriefcase({ size: 17 })}<strong>Post a role</strong></span></div></div></div></section>`,
  };
  const renderedSectionHtml = { ...sectionHtml };
  for (const key of ['hero', 'featured_companies', 'categories_grid', 'job_listing', 'career_insights', 'trust_strip', 'employer_cta']) renderedSectionHtml[key] = homepageCodeOverride(key, sectionHtml[key] || '');
  const homepageSectionsHtml = enabledSections.map(s => renderedSectionHtml[s.key] || '').join('') + enabledCustomSections.map(s => `
    <section class="homepage-custom-section homepage-reveal-section" data-homepage-custom-section="${s.id}">
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
<link href="https://fonts.googleapis.com/css2?${googleFontHref}&display=swap" rel="stylesheet">
${homeStyles({ settings, heroFont })}
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
        <h2 style="font-family:var(--font-heading,sans-serif);font-size:22px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:8px">${iconBookmark({ size: 20 })} Saved Jobs</h2>
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

<script>window.__CATEGORY_META__=${JSON.stringify(categoryMap)};window.__CATEGORY_ORDER__=${JSON.stringify(categoryOrder)};window.__ICONS__=${JSON.stringify(CLIENT_ICONS)};window.__JOB_TYPE_META__=${JSON.stringify(JOB_TYPE_META)};window.__JOB_TYPE_ICONS__=${JSON.stringify({ star: CLIENT_ICONS.tierStar, crown: CLIENT_ICONS.tierCrown, rocket: CLIENT_ICONS.tierRocket, none: '' })};window.__JOB_CARD_STYLES__=${JSON.stringify(cardStyles)};window.__FEATURES__=${JSON.stringify({ featuredJobs: featuredEnabled })};window.__HOT_PAY_LABEL__=${JSON.stringify(HOT_PAY_LABEL)};window.__SALARY_TIER_UI__=${JSON.stringify({ enabled: settings.salary_tier_badges_enabled !== '0', labels: { HIGH: settings.salary_tier_high_label || 'High Pay', GOOD: settings.salary_tier_good_label || 'Good Pay', STANDARD: settings.salary_tier_standard_label || 'Standard Pay' } }).replace(/</g,'\\u003c')};</script>
${homeClientScript({ companyLogoMap, initialJobs, initialTotal, user })}
${analyticsTrackerScript(settings)}
</body>
</html>`;
}
