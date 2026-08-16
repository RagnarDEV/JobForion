// src/pages/home.js
// The homepage SPA shell: SSR job list (first page, for SEO + fast first paint),
// hero, featured-companies strip, filters, and all client-side interactivity.

import { ensureTable } from '../db/schema.js';
import { navHtml, mobileHeaderHtml } from '../components/nav.js';
import { footerHtml } from '../components/footer.js';
import { postJobModalHtml } from '../components/post-job-modal.js';
import { SHARED_CSS } from '../styles/shared-css.js';
import { ICON_HEAD } from '../assets/favicon.js';
import { JOB_TYPE_META, JOB_TYPE_SORT_SQL } from '../config/constants.js';
import { jobCardSSR } from '../components/job-card.js';
import { adSlot } from '../components/ad-slot.js';
import { escapeHtml, slugify, listCompanies } from '../lib/entities.js';
import { COUNTRY_TO_ISO } from '../lib/country-flags.js';
import { googleAnalyticsTag } from '../lib/analytics-tag.js';
import { getSettings, HERO_FONT_OPTIONS } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';
import { getCardStyles } from '../lib/job-card-styles.js';
import { getAdSlotsConfig } from '../lib/ad-slots.js';
import { getFooterPages, getMenuPages } from '../lib/pages-cms.js';
import { getNavButtons } from '../lib/nav-buttons.js';
import { getEnabledHomepageSections } from '../lib/homepage-sections.js';
import { categoryIconSvg } from '../lib/category-icons.js';
import { iconSparkle, iconFlame, iconPin, iconMapPin, iconBookmark, iconLink, iconArrowRight, iconBadgeCheck, iconClock, iconGlobe, iconBuilding, iconSearch, iconCheck, iconInfo, iconAlertTriangle } from '../assets/icons.js';

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

export async function renderMainHTML(env, base) {
  await ensureTable(env);
  const settings = await getSettings(env);
  const categories = await getCategories(env);
  const categoryOrder = categories.map(c => c.key);
  const categoryMap = Object.fromEntries(categories.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }]));
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
  // Hero customization (see /admin/settings → "Hero & Branding") — falls
  // back to HERO_FONT_OPTIONS[0] (Plus Jakarta Sans, the brand's display
  // font) for any unrecognized/stale value, so a bad save can never
  // leave the heading with no font applied at all.
  const heroFont = HERO_FONT_OPTIONS.find(f => f.name === settings.hero_heading_font) || HERO_FONT_OPTIONS[0];
  const heroFontGoogleParam = heroFont.name === 'Plus Jakarta Sans' ? '' : `&family=${heroFont.googleParam}`;
  let initialJobs = [], initialTotal = 0, totalJobsCount = 0, companiesCount = 0;
  try {
    const { results } = await env.DB.prepare(`SELECT * FROM jobs ORDER BY ${JOB_TYPE_SORT_SQL} ASC, featured DESC, id DESC LIMIT 20`).all();
    initialJobs = results || [];
    const { results: cr } = await env.DB.prepare("SELECT COUNT(*) as total FROM jobs").all();
    initialTotal = cr[0]?.total || 0;
    totalJobsCount = initialTotal;
    const { results: ccr } = await env.DB.prepare("SELECT COUNT(DISTINCT LOWER(company)) as c FROM jobs WHERE company IS NOT NULL AND company != ''").all();
    companiesCount = ccr[0]?.c || 0;
  } catch (e) {}

  // Data for the four homepage facet-picker panels (category, country,
  // skill, company) — each bounded to a reasonable top-N since these
  // render as flat button lists, not paginated tables (the full
  // directories live at /categories, /countries, /skills, /companies).
  let topCompanies = [];
  try { topCompanies = await listCompanies(env, { limit: 40 }); } catch (e) {}

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
  const ssrJobsHtml = initialJobs.length
    ? initialJobs.map((j, i) => jobCardSSR(j, i, categoryMap, categoryOrder, cardStyles, {}, featuredEnabled)).join('')
    : `<div class="loader-wrap"><div class="loader"></div></div>`;

  const siteName = escapeHtml(settings.site_name);
  const siteDescription = settings.site_description || `${settings.site_name} is a curated remote job board with ${totalJobsCount ? totalJobsCount.toLocaleString() + '+' : ''} verified positions in development, design, marketing, data and more. Updated every few hours.`;

  // ── Homepage Sections (Admin Dashboard V2, Phase 4) ─────────────────
  // Each section is built as a standalone HTML string here, then
  // assembled below in whatever order/subset `enabledSections` says.
  // `hero` and `job_listing` are `required: true` in
  // lib/homepage-sections.js and therefore always present — everything
  // else only renders if an admin has switched it on.
  const sectionHtml = {
    hero: `
    <div class="hero">
      <div class="hero-inner">
        <h1 class="hero-title">${escapeHtml(settings.hero_title_line1)} <span class="hl">${escapeHtml(settings.hero_title_line2)}</span></h1>
        <p class="hero-sub">${escapeHtml(settings.hero_subtitle)}</p>
        <div class="search-row">
          <div class="search-wrap">
            <span class="search-icon">${iconSearch({ size: 16 })}</span>
            <input type="text" class="search-input" id="searchInput" placeholder="${escapeHtml(settings.hero_search_placeholder)}" oninput="debounceSearch(this.value)">
          </div>
          <button class="search-btn" onclick="document.getElementById('searchInput').focus()">${escapeHtml(settings.hero_search_button_text)}</button>
        </div>
      </div>
    </div>`,

    featured_companies: topCompanies.length ? `
    <div class="fc-strip">
      <div class="fc-inner">
        <div class="fc-label">Featured Remote Employers</div>
        <div class="fc-logos">${topCompanies.slice(0, 6).map(c => `<a href="/companies/${slugify(c.name)}">${escapeHtml(c.name)}</a>`).join('')}</div>
      </div>
    </div>` : '',

    categories_grid: categories.length ? `
    <div class="content-wrap" style="padding-bottom:0">
      <div class="cg-title">Browse by Category</div>
      <div class="cg-grid">
        ${categories.slice(0, 12).map(c => {
          const swatch = /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#2563EB';
          return `<a href="/categories/${c.key}" class="cg-item" style="--cat-color:${swatch}"><span class="cg-icon" style="background:${swatch}1a;color:${swatch}">${categoryIconSvg(c.key, { size: 18 })}</span><span class="cg-label">${escapeHtml(c.label)}</span></a>`;
        }).join('')}
      </div>
    </div>` : '',

    job_listing: `
    <div class="content-wrap">
      <div class="results-hdr">
        <div class="results-count" id="resultsCount" style="display:none"><strong>${initialTotal.toLocaleString()}</strong> jobs found</div>
      </div>
      ${adSlot('homepage-results-top', '', adConfig, adsEnabled)}
      <div class="jobs-list" id="jobsList">${ssrJobsHtml}</div>
      <div class="pagination" id="pagination"></div>
    </div>`,

    cta_banner: `
    <div class="content-wrap">
      <div class="cta-banner">
        <div>
          <div class="cta-title">Hiring remotely?</div>
          <div class="cta-sub">Reach thousands of qualified candidates \u2014 post your job in minutes.</div>
        </div>
        <button class="cta-btn" onclick="openPostJobModal()">+ Post a Job</button>
      </div>
    </div>`,
  };
  const homepageSectionsHtml = enabledSections.map(s => sectionHtml[s.key] || '').join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
${googleAnalyticsTag(settings.ga_measurement_id)}
<meta charset="UTF-8">
<meta name="google-site-verification" content="7Q0EJk3kQKNLNzIhyzH4k5CsuHsQEa-U0Pwp_w_b0n0"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${siteName} — ${escapeHtml(settings.site_tagline)}</title>
<meta name="description" content="${escapeHtml(siteDescription)}">
<meta name="robots" content="index, follow">
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

/* ── HERO (navy → indigo gradient, bold headline, red CTA search) ── */
.hero{padding:96px 24px 84px;background:linear-gradient(135deg,${settings.hero_gradient_start} 0%,${settings.hero_gradient_mid} 55%,${settings.hero_gradient_end} 100%);position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 60% 50% at 80% 0%,rgba(255,255,255,.12),transparent 60%)}
.hero-inner{max-width:1180px;margin:0 auto;position:relative}
.hero-eyebrow{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:20px;padding:5px 13px;font-size:12px;color:#fff;font-weight:700;margin-bottom:20px}
.hero-eyebrow-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse-dot 2s infinite}
.hero-title{font-family:'${heroFont.name}',sans-serif;font-size:54px;font-weight:800;letter-spacing:-1px;line-height:1.1;margin-bottom:20px;color:#fff;max-width:680px}
.hero-title .hl{position:relative;display:inline-block}
.hero-title .hl::after{content:'';position:absolute;left:0;right:0;bottom:2px;height:5px;background:var(--coral);border-radius:3px;opacity:.85;z-index:-1}
.hero-sub{color:rgba(255,255,255,.85);font-size:16px;margin-bottom:28px;line-height:1.65;max-width:540px}
.search-row{display:flex;gap:0;max-width:640px;margin-bottom:26px;background:#fff;border-radius:18px;padding:6px;box-shadow:0 14px 34px -10px rgba(24,48,196,.22);border:1px solid rgba(255,255,255,.7);transition:box-shadow .25s ease}
.search-row:focus-within{box-shadow:0 18px 42px -8px rgba(24,48,196,.3)}
.search-wrap{position:relative;flex:1}
.search-icon{position:absolute;left:16px;top:50%;transform:translateY(-50%);color:var(--ink3);pointer-events:none;font-size:15px}
.search-input{width:100%;background:transparent;border:none;padding:13px 12px 13px 42px;color:var(--ink);font-size:15px;font-family:inherit;outline:none}
.search-input::placeholder{color:var(--ink3)}
.search-btn{background:${settings.hero_search_button_color};color:#fff;border:none;border-radius:13px;padding:0 28px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s;white-space:nowrap}
.search-btn:hover{filter:brightness(1.08);box-shadow:0 6px 16px rgba(0,0,0,.22)}
.hero-stats{display:flex;gap:30px;flex-wrap:wrap}
.hero-stat{display:flex;flex-direction:column}
.hero-stat-num{font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:700;color:#fff;line-height:1.2}
.hero-stat-label{font-size:11px;color:rgba(255,255,255,.65);font-weight:600;letter-spacing:.4px;text-transform:uppercase}

/* ── FEATURED COMPANIES STRIP ── */
.fc-strip{border-bottom:1px solid var(--border);padding:22px 24px;background:var(--surface)}
.fc-inner{max-width:1180px;margin:0 auto}
.fc-label{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--ink3);margin-bottom:16px;text-align:center}
.fc-logos{display:flex;align-items:center;justify-content:center;gap:48px;flex-wrap:wrap}
.fc-logos a{font-family:'Plus Jakarta Sans',sans-serif;font-size:25px;font-weight:700;color:var(--ink3);opacity:.65;transition:all .25s;text-decoration:none}
.fc-logos a:hover{opacity:1;color:var(--brand)}

/* ── CONTENT ── */
.content-wrap{max-width:1180px;margin:0 auto;padding:24px}

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
.job-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--cat-color,var(--brand));opacity:.55;transition:opacity .2s,width .2s}
.job-card:hover{border-color:var(--cat-color,var(--brand));box-shadow:var(--shadow-lg);transform:translateY(-2px)}
.job-card:hover::before{opacity:1;width:5px}
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
.tag-loc{background:var(--surface2);color:var(--ink2);font-size:10.5px;font-weight:600;border:none;padding:3px 10px;border-radius:20px}
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
  .search-row{flex-direction:column;padding:8px;gap:8px}
  .search-btn{padding:12px}
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
</style>
</head>
<body>
${navHtml(settings, menuPages, navButtons)}
${mobileHeaderHtml(settings, menuPages, navButtons)}

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

<script>window.__CATEGORY_META__=${JSON.stringify(categoryMap)};window.__CATEGORY_ORDER__=${JSON.stringify(categoryOrder)};window.__ICONS__=${JSON.stringify(CLIENT_ICONS)};window.__COUNTRY_ISO__=${JSON.stringify(COUNTRY_TO_ISO)};window.__JOB_TYPE_META__=${JSON.stringify(JOB_TYPE_META)};window.__JOB_CARD_STYLES__=${JSON.stringify(cardStyles)};window.__FEATURES__=${JSON.stringify({ featuredJobs: featuredEnabled })};</script>
<script>
const CAT_META=window.__CATEGORY_META__;
const CAT_ORDER=window.__CATEGORY_ORDER__;
const ICONS=window.__ICONS__;
const COUNTRY_ISO=window.__COUNTRY_ISO__;
const JOB_TYPE_META=window.__JOB_TYPE_META__;
const JOB_CARD_STYLES=window.__JOB_CARD_STYLES__;
const FEATURES=window.__FEATURES__;
function isoToFlagEmoji(iso){
  if(!iso||iso.length!==2)return null;
  const cps=[...iso.toUpperCase()].map(c=>127397+c.charCodeAt(0));
  return String.fromCodePoint(...cps);
}
function clientCountryFlag(name){
  if(!name)return'🌍';
  const key=name.trim().toLowerCase();
  if(/^(remote|worldwide|anywhere|global)$/.test(key))return'🌍';
  const iso=COUNTRY_ISO[key];
  if(!iso)return'🌍';
  return isoToFlagEmoji(iso)||'🌍';
}
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
let savedIds=JSON.parse(localStorage.getItem('jn_saved')||'[]');
let adv={};
let hasLoadedOnce=true;

function initials(n){return(n||'?').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();}
function logoHtml(co,sz='54px'){
  const slug=(co||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const domain=slug+'.com';
  const ini=initials(co);
  const fs=Math.round(parseInt(sz)*.32)+'px';
  return \`<div class="co-logo" style="width:\${sz};height:\${sz}">
    <img src="https://www.google.com/s2/favicons?domain=\${domain}&sz=64" alt="\${co}"
      style="width:100%;height:100%;object-fit:contain;padding:6px;display:block"
      onerror="this.onerror=null;this.src='https://icons.duckduckgo.com/ip3/\${domain}.ico';this.onerror=function(){this.style.display='none';this.nextElementSibling.style.display='flex'}">
    <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:\${fs};font-weight:800;color:#2563EB">\${ini}</span>
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
  if(isHot(j.salary))return'var(--pastel-yellow)';
  return'var(--surface)';
}
function isNew(ts){if(!ts)return false;return Date.now()-new Date(ts).getTime()<86400000;}
function isHot(sal){if(!sal)return false;return parseInt(sal.replace(/\\D/g,'').slice(0,3))>=150;}
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
    const hot=isHot(j.salary);
    const timeAgo=j.created_at?getTimeAgo(new Date(j.created_at)):'';
    const k=catForTitle(j.title);
    const meta=CAT_META[k];
    const bg=pastelFor(j);
    const jts=jtStyleFor(j.job_type);
    const locFlag=j.location?clientCountryFlag(j.location.split(',').pop().trim()):'';
    return\`<a href="/job/\${j.id}" class="job-card\${jobTypeCardClass(j.job_type)}" style="--cat-color:\${meta.color};\${jtCardStyleAttr(j.job_type,bg)};animation:fadeInUp .3s ease \${Math.min(idx,6)*.04}s both">
      <div class="card-inner" style="padding:\${jts.card_padding}px 16px">
        <div class="card-row1">
          \${logoHtml(j.company,jts.logo_size+'px')}
          <div class="card-body">
            <div class="card-badges">
              \${jobTypeBadge(j.job_type)}
              <span class="cat-dot"><span class="dot"></span>\${esc(meta.label)}</span>
              \${FEATURES.featuredJobs && j.featured?'<span class="tag-pinned">'+ICONS.pin+' Pinned</span>':''}
              \${nw?'<span class="tag-new">'+ICONS.sparkle+' NEW</span>':''}
              \${hot?'<span class="tag-hot">'+ICONS.flame+' HOT</span>':''}
            </div>
            <div class="job-title-card">\${esc(j.title)}</div>
            <div class="job-co-card">\${esc(j.company)} <span class="verified-ico">\${ICONS.badgeCheck}</span></div>
            <div class="job-meta-row">
              \${j.location?'<span class="tag tag-loc">'+locFlag+' '+esc(j.location)+'</span>':''}
              \${remoteTag(j.remote_type)}
              \${j.employment_type?'<span class="tag tag-type">'+esc(j.employment_type.replace(/_/g,' '))+'</span>':''}
              \${j.seniority?'<span class="tag tag-type">'+esc(j.seniority)+'</span>':''}
            </div>
            \${normalizeJobType(j.job_type)==='Sponsored'&&j.job_type_note?'<div class="jt-note">'+esc(j.job_type_note)+'</div>':''}
          </div>
        </div>
        \${(timeAgo||j.salary)?'<div class="card-right">'+(timeAgo?'<span class="card-time-corner">'+ICONS.clock+' '+timeAgo+'</span>':'')+(j.salary?'<div class="salary-badge">'+esc(j.salary)+'</div>':'')+'</div>':''}
      </div>
    </a>\`;
  }).join('');
}

async function loadJobs(){
  document.getElementById('jobsList').innerHTML=renderSkeletons();
  document.getElementById('pagination').innerHTML='';
  const p=new URLSearchParams({page:pg});
  if(cat)p.set('category',cat);
  if(srch)p.set('search',srch);
  if(adv.remote)p.set('remote_type',adv.remote);
  if(adv.employ)p.set('employment_type',adv.employ);
  if(adv.seniority)p.set('seniority',adv.seniority);
  if(adv.salaryMin)p.set('salary_min',adv.salaryMin);
  if(adv.days)p.set('days',adv.days);
  if(adv.country)p.set('country',adv.country);
  if(adv.skill)p.set('skill',adv.skill);
  if(adv.company)p.set('company',adv.company);
  try{
    const res=await fetch('/api/jobs?'+p);
    const data=await res.json();
    jobs=data.jobs||[];total=data.total||0;
    document.getElementById('resultsCount').innerHTML=\`<strong>\${total.toLocaleString()}</strong> jobs found\${cat?' in <strong>'+(CAT_META[cat]?CAT_META[cat].label:cat)+'</strong>':''}\${adv.country?' in <strong>'+esc(adv.country)+'</strong>':''}\${adv.skill?' with <strong>'+esc(adv.skill)+'</strong>':''}\${adv.company?' at <strong>'+esc(adv.company)+'</strong>':''}\${srch?' for "<strong>'+srch+'</strong>"':''}\`;
    if(!jobs.length){
      document.getElementById('jobsList').innerHTML=\`<div class="empty"><div class="e-icon">\${ICONS.searchLg}</div><h3>No jobs found</h3><p>Try different keywords or clear filters</p></div>\`;
      return;
    }
    renderJobsList();
    renderPagination();
  }catch(e){
    document.getElementById('jobsList').innerHTML=\`<div class="empty"><div class="e-icon">\${ICONS.alertTriangle}</div><h3>Failed to load</h3><p>Refresh and try again</p></div>\`;
  }
}

function toggleSave(id){
  const idx=savedIds.indexOf(id);
  if(idx>=0){savedIds.splice(idx,1);showToast('Removed from saved','info');}
  else{savedIds.push(id);showToast('Job saved! '+ICONS.bookmark);}
  localStorage.setItem('jn_saved',JSON.stringify(savedIds));
  const btn=document.getElementById('sb-'+id);
  if(btn)btn.classList.toggle('saved',savedIds.includes(id));
}
window.toggleSave=toggleSave;
function shareJob(id){
  const url=window.location.origin+'/job/'+id;
  navigator.clipboard.writeText(url).then(()=>showToast('Link copied! '+ICONS.link)).catch(()=>showToast('Copied!'));
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
    <a href="/job/\${j.id}" class="job-card">
      <div class="card-inner">
        <div class="card-row1">
          \${logoHtml(j.company)}
          <div class="card-body">
            <div class="job-title-card">\${esc(j.title)}</div>
            <div class="job-co-card">\${esc(j.company)}</div>
            <div class="job-meta-row">\${remoteTag(j.remote_type)}</div>
          </div>
        </div>
        <div class="card-right">
          \${j.salary?'<div class="salary-badge">'+esc(j.salary)+'</div>':'<div></div>'}
          <button class="act-btn saved" onclick="event.preventDefault();toggleSave(\${j.id});renderSaved()">\${ICONS.bookmark}</button>
        </div>
      </div>
    </a>\`).join('');
}

function clearAllSaved(){savedIds=[];localStorage.removeItem('jn_saved');renderSaved();showToast('All cleared','info');}

function debounceSearch(v){clearTimeout(srchT);srchT=setTimeout(()=>{srch=v;pg=1;loadJobs();},400);}
function goPage(p){pg=p;loadJobs();window.scrollTo({top:0,behavior:'smooth'});}

function renderPagination(){
  const el=document.getElementById('pagination');
  if(!el)return;
  const tp=Math.ceil(total/20);
  el.innerHTML=tp>1?\`
    <button class="page-btn" onclick="goPage(\${pg-1})" \${pg===1?'disabled':''}>← Prev</button>
    <span class="page-info">Page \${pg} / \${tp}</span>
    <button class="page-btn" onclick="goPage(\${pg+1})" \${pg===tp?'disabled':''}>Next →</button>\`:'';
}

// bind actions on the server-rendered initial cards too, and fill in
// what only client JS can compute (relative time-ago is already SSR'd,
// but pagination needs the live "total" count known only after render)
document.addEventListener('DOMContentLoaded',()=>{
  savedIds.forEach(id=>{const b=document.getElementById('sb-'+id);if(b)b.classList.add('saved');});
  renderPagination();
});
</script>
</body>
</html>`;
}
