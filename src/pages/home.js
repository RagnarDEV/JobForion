// src/pages/home.js
// The homepage SPA shell: SSR job list (first page, for SEO + fast first paint),
// hero, featured-companies strip, filters, and all client-side interactivity.

import { ensureTable } from '../db/schema.js';
import { navHtml, mobileHeaderHtml } from '../components/nav.js';
import { footerHtml } from '../components/footer.js';
import { postJobModalHtml } from '../components/post-job-modal.js';
import { SHARED_CSS } from '../styles/shared-css.js';
import { ICON_HEAD } from '../assets/favicon.js';
import { FEATURED_COMPANIES, CATEGORY_ORDER, CATEGORY_META } from '../config/constants.js';
import { jobCardSSR } from '../components/job-card.js';
import { adSlot } from '../components/ad-slot.js';
import { escapeHtml, listCountries, listSkills, listCompanies } from '../lib/entities.js';
import { countryFlag } from '../lib/country-flags.js';
import { GOOGLE_ANALYTICS_TAG } from '../lib/analytics-tag.js';
import { iconSparkle, iconFlame, iconPin, iconMapPin, iconBookmark, iconLink, iconArrowRight, iconBadgeCheck, iconClock, iconGlobe, iconBuilding, iconSearch, iconX, iconFilter, iconBell, iconCheck, iconInfo, iconAlertTriangle, iconFolder, iconTag } from '../assets/icons.js';

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
  x: iconX({ size: 13 }), filter: iconFilter({ size: 14 }), bell: iconBell({ size: 20 }),
  check: iconCheck({ size: 16 }), info: iconInfo({ size: 16 }), alertTriangle: iconAlertTriangle({ size: 32 }),
  searchLg: iconSearch({ size: 32 }), folder: iconFolder({ size: 11 }), tag: iconTag({ size: 11 }),
};

// Kept for backward compatibility with anything still calling it directly;
// the homepage itself now renders categories via the panel below instead
// of an always-expanded chip row.
export function categoryChipsServer() {
  return CATEGORY_ORDER.map(k => `<button class="chip" data-cat="${k}" onclick="filterCat('${k}','${CATEGORY_META[k].label}')">${CATEGORY_META[k].label}</button>`).join('');
}

// ── Generic facet-picker panel builder ──────────────────────────────
// All four homepage facets (category, country, skill, company) share one
// visual pattern: a chip that toggles a panel of pill buttons, each
// showing an icon/emoji + name + job count, with a dark "All X" reset
// pill first. Building all four through one function keeps them visually
// and behaviorally identical — a fifth facet later is a one-line addition
// here, not a new bespoke UI.
function facetPanelServer(facet, defaultIconSvg, allLabel, items, iconInDataLabel) {
  // The "All X" reset pill's data-label is intentionally left blank: it's
  // never actually read by selectFacet() (an empty value always falls
  // back to the client-side FACET_DEFAULT_LABEL constant instead), so
  // there's no reason to risk putting anything — let alone an SVG icon's
  // own double-quoted width="…"/height="…" attributes — inside this
  // attribute value.
  const allBtn = `<button class="filter-pill active" data-facet="${facet}" data-value="" data-label="" onclick="selectFacet(this,'${facet}')">${defaultIconSvg} ${allLabel}</button>`;
  const rest = items.map(({ icon, name, value, count }) => {
    const safeName = escapeHtml(name);
    const safeValue = escapeHtml(value);
    // SECURITY/CORRECTNESS: `icon` is only safe to also embed inside the
    // data-label ATTRIBUTE when it's a plain emoji/Unicode character with
    // no embedded quotes (category emoji, country flags). An SVG icon
    // string (skill/company) always contains double quotes from its own
    // attributes and would prematurely close data-label, corrupting this
    // button's HTML — so SVG icons are only ever placed in element
    // CONTENT (below, outside any attribute), never inside one.
    const labelAttr = iconInDataLabel ? `${icon} ${safeName}` : safeName;
    return `<button class="filter-pill" data-facet="${facet}" data-value="${safeValue}" data-label="${labelAttr}" onclick="selectFacet(this,'${facet}')">${icon} ${safeName} <span class="cnt">${count}</span></button>`;
  }).join('');
  return allBtn + rest;
}

function categoryPanelItemsServer(counts) {
  const items = CATEGORY_ORDER.map(k => ({ icon: CATEGORY_META[k].emoji, name: CATEGORY_META[k].label, value: k, count: counts[k] || 0 }));
  return facetPanelServer('category', iconFolder({ size: 11 }), 'All Categories', items, true);
}

// Country picker, each entry prefixed with a flag emoji (lib/country-flags.js) —
// flags are plain Unicode characters, safe to embed in the data-label
// attribute directly. Selecting one filters jobs via /api/jobs?country=...
// (routes/api.router.js), matching the same heuristic already used by
// jobsByRegion() in lib/entities.js.
function countryPanelItemsServer(countries) {
  const items = countries.map(c => ({ icon: countryFlag(c.name), name: c.name, value: c.name, count: c.count }));
  return facetPanelServer('country', iconGlobe({ size: 11 }), 'All Countries', items, true);
}

// Skill picker — sourced from listSkills() (lib/entities.js), which parses
// the jobs.skills JSON column via SQLite's json_each. Filters via
// /api/jobs?skill=... which matches the same json_each pattern. Every
// entry shares one uniform "tag" SVG icon (skills have no natural
// per-item glyph the way countries have flags).
function skillPanelItemsServer(skills) {
  const tagIcon = iconTag({ size: 11 });
  const items = skills.map(s => ({ icon: tagIcon, name: s.name, value: s.name, count: s.count }));
  return facetPanelServer('skill', tagIcon, 'All Skills', items, false);
}

// Company picker — sourced from listCompanies() (lib/entities.js). Filters
// via /api/jobs?company=... (exact match on the jobs.company column).
// Uses the same building icon as the "hybrid/on-site" remote-type tag
// elsewhere on the site for visual consistency.
function companyPanelItemsServer(companies) {
  const buildingIcon = iconBuilding({ size: 11 });
  const items = companies.map(c => ({ icon: buildingIcon, name: c.name, value: c.name, count: c.count }));
  return facetPanelServer('company', buildingIcon, 'All Companies', items, false);
}

// Single-query category counts: one SUM(CASE WHEN...) column per category
// instead of 13 separate COUNT queries, to keep the homepage's D1
// subrequest budget in check (see the free-tier notes in README.md).
async function getCategoryCounts(env) {
  try {
    const caseExprs = CATEGORY_ORDER.map(k => `SUM(CASE WHEN LOWER(title) LIKE ? THEN 1 ELSE 0 END) AS ${k}`).join(', ');
    const binds = CATEGORY_ORDER.map(k => `%${k}%`);
    const { results } = await env.DB.prepare(`SELECT ${caseExprs} FROM jobs`).bind(...binds).all();
    return results[0] || {};
  } catch (e) { return {}; }
}

export async function renderMainHTML(env, base) {
  await ensureTable(env);
  let initialJobs = [], initialTotal = 0, totalJobsCount = 0, companiesCount = 0;
  try {
    const { results } = await env.DB.prepare("SELECT * FROM jobs ORDER BY featured DESC, id DESC LIMIT 20").all();
    initialJobs = results || [];
    const { results: cr } = await env.DB.prepare("SELECT COUNT(*) as total FROM jobs").all();
    initialTotal = cr[0]?.total || 0;
    totalJobsCount = initialTotal;
    const { results: ccr } = await env.DB.prepare("SELECT COUNT(DISTINCT LOWER(company)) as c FROM jobs WHERE company IS NOT NULL AND company != ''").all();
    companiesCount = ccr[0]?.c || 0;
  } catch (e) {}

  // "Top X Jobs" curated sections (one per category, a few most-recent jobs
  // each) — shown below the main list. Skips categories with zero jobs.
  let categorySections = [];
  try {
    categorySections = await Promise.all(CATEGORY_ORDER.map(async (key) => {
      const { results } = await env.DB.prepare(
        "SELECT * FROM jobs WHERE LOWER(title) LIKE ? ORDER BY featured DESC, id DESC LIMIT 4"
      ).bind(`%${key}%`).all();
      return { key, meta: CATEGORY_META[key], jobs: results || [] };
    }));
    categorySections = categorySections.filter(s => s.jobs.length > 0);
  } catch (e) {}

  // Data for the four homepage facet-picker panels (category, country,
  // skill, company) — each bounded to a reasonable top-N since these
  // render as flat button lists, not paginated tables (the full
  // directories live at /categories, /countries, /skills, /companies).
  let topCountries = [], topSkills = [], topCompanies = [], categoryCounts = {};
  try { topCountries = await listCountries(env, { limit: 40 }); } catch (e) {}
  try { topSkills = await listSkills(env, { limit: 40 }); } catch (e) {}
  try { topCompanies = await listCompanies(env, { limit: 40 }); } catch (e) {}
  categoryCounts = await getCategoryCounts(env);

  const categoryPanelHtml = categoryPanelItemsServer(categoryCounts);
  const countryPanelHtml = countryPanelItemsServer(topCountries);
  const skillPanelHtml = skillPanelItemsServer(topSkills);
  const companyPanelHtml = companyPanelItemsServer(topCompanies);

  const itemListSchema = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList",
    "itemListElement": initialJobs.slice(0, 10).map((j, i) => ({
      "@type": "ListItem", "position": i + 1, "url": `${base}/job/${j.id}`
    }))
  });
  const orgSchema = JSON.stringify({
    "@context": "https://schema.org", "@type": "Organization",
    "name": "JobForion", "url": base, "logo": `${base}/icon-512.png`
  });

  const ssrJobsHtml = initialJobs.length
    ? initialJobs.map((j, i) => jobCardSSR(j, i)).join('')
    : `<div class="loader-wrap"><div class="loader"></div></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
${GOOGLE_ANALYTICS_TAG}
<meta charset="UTF-8">
<meta name="google-site-verification" content="7Q0EJk3kQKNLNzIhyzH4k5CsuHsQEa-U0Pwp_w_b0n0"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JobForion — Find Your Next Remote Job</title>
<meta name="description" content="JobForion is a curated remote job board with ${totalJobsCount ? totalJobsCount.toLocaleString() + '+' : ''} verified positions in development, design, marketing, data and more. Updated every few hours.">
<meta name="robots" content="index, follow">
${ICON_HEAD}
<meta property="og:title" content="JobForion — Find Your Next Remote Job">
<meta property="og:description" content="Curated remote jobs updated every few hours. Browse, save, and get alerted — or post your own opening.">
<meta property="og:type" content="website">
<meta property="og:url" content="${base}">
<meta property="og:site_name" content="JobForion">
<meta property="og:image" content="${base}/icon-512.png">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${base}">
<link rel="alternate" type="application/rss+xml" title="JobForion Jobs Feed" href="${base}/feed.rss">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"JobForion","url":"${base}","potentialAction":{"@type":"SearchAction","target":"${base}/?search={search_term_string}","query-input":"required name=search_term_string"}}</script>
<script type="application/ld+json">${orgSchema}</script>
<script type="application/ld+json">${itemListSchema}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@700;800&display=swap" rel="stylesheet">
<style>
${SHARED_CSS}

/* ── HERO (navy → indigo gradient, bold headline, red CTA search) ── */
.hero{padding:96px 24px 84px;background:linear-gradient(135deg,#1830C4 0%,#3556FF 55%,#6C3FE0 100%);position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 60% 50% at 80% 0%,rgba(255,255,255,.12),transparent 60%)}
.hero-inner{max-width:1180px;margin:0 auto;position:relative}
.hero-eyebrow{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:20px;padding:5px 13px;font-size:12px;color:#fff;font-weight:700;margin-bottom:20px}
.hero-eyebrow-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse-dot 2s infinite}
.hero-title{font-family:'Space Grotesk',sans-serif;font-size:54px;font-weight:800;letter-spacing:-1px;line-height:1.1;margin-bottom:20px;color:#fff;max-width:680px}
.hero-title .hl{position:relative;display:inline-block}
.hero-title .hl::after{content:'';position:absolute;left:0;right:0;bottom:2px;height:5px;background:var(--coral);border-radius:3px;opacity:.85;z-index:-1}
.hero-sub{color:rgba(255,255,255,.85);font-size:16px;margin-bottom:28px;line-height:1.65;max-width:540px}
.search-row{display:flex;gap:0;max-width:640px;margin-bottom:26px;background:#fff;border-radius:14px;padding:6px;box-shadow:0 20px 44px -12px rgba(11,18,32,.45)}
.search-wrap{position:relative;flex:1}
.search-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--ink3);pointer-events:none;font-size:15px}
.search-input{width:100%;background:transparent;border:none;padding:12px 12px 12px 40px;color:var(--ink);font-size:15px;font-family:inherit;outline:none}
.search-input::placeholder{color:var(--ink3)}
.search-btn{background:var(--coral);color:#fff;border:none;border-radius:9px;padding:0 26px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s;white-space:nowrap}
.search-btn:hover{background:#e64d68;transform:translateY(-1px)}
.hero-stats{display:flex;gap:30px;flex-wrap:wrap}
.hero-stat{display:flex;flex-direction:column}
.hero-stat-num{font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:700;color:#fff;line-height:1.2}
.hero-stat-label{font-size:11px;color:rgba(255,255,255,.65);font-weight:600;letter-spacing:.4px;text-transform:uppercase}

/* ── FEATURED COMPANIES STRIP ── */
.fc-strip{border-bottom:1px solid var(--border);padding:22px 24px;background:var(--surface)}
.fc-inner{max-width:1180px;margin:0 auto}
.fc-label{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--ink3);margin-bottom:16px;text-align:center}
.fc-logos{display:flex;align-items:center;justify-content:center;gap:40px;flex-wrap:wrap}
.fc-logos span{font-family:'Plus Jakarta Sans',sans-serif;font-size:19px;font-weight:700;color:var(--ink3);opacity:.55;transition:all .25s;cursor:default}
.fc-logos span:hover{opacity:1;color:var(--brand)}

/* ── FILTER BAR ── */
.filters-bar{position:sticky;top:66px;z-index:150;padding:12px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;overflow-x:auto;background:rgba(255,255,255,.92);backdrop-filter:blur(10px)}
.filters-bar::-webkit-scrollbar{height:0}
.chip{display:inline-flex;align-items:center;gap:5px;padding:8px 15px;border-radius:20px;border:1.5px solid var(--border2);background:var(--surface);color:var(--ink2);font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .2s}
.chip:hover{border-color:var(--brand);color:var(--brand)}
.chip.active{background:var(--ink);border-color:var(--ink);color:#fff}

/* ── ADV FILTERS ── */
.adv-filters{max-width:1180px;margin:0 auto;padding:12px 24px;border-bottom:1px solid var(--border);display:none;gap:10px;flex-wrap:wrap;background:var(--bg);align-items:flex-end}
.adv-filters.open{display:flex}
.filter-select{background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:8px 12px;color:var(--ink2);font-size:12px;font-family:inherit;cursor:pointer;outline:none}
.filter-select:focus{border-color:var(--brand);color:var(--ink)}
.filter-label{font-size:10px;font-weight:700;color:var(--ink3);display:flex;flex-direction:column;gap:4px;letter-spacing:.5px;text-transform:uppercase}
.salary-input{width:90px;background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:8px 10px;color:var(--ink);font-size:12px;font-family:inherit;outline:none}
.salary-input:focus{border-color:var(--brand)}
.clear-btn{padding:8px 14px;border-radius:8px;border:1px solid var(--border2);background:transparent;color:var(--ink3);font-size:12px;cursor:pointer;font-family:inherit;transition:all .2s;font-weight:600}
.clear-btn:hover{color:var(--coral);border-color:var(--coral)}

/* ── CONTENT ── */
.content-wrap{max-width:1180px;margin:0 auto;padding:24px}
.results-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:10px;flex-wrap:wrap}
.results-count{font-size:14px;color:var(--ink3)}
.results-count strong{color:var(--ink);font-weight:700}
.adv-toggle-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);color:var(--ink2);font-size:13px;cursor:pointer;font-family:inherit;transition:all .2s;font-weight:600}
.adv-toggle-btn:hover,.adv-toggle-btn.active{background:var(--brand-soft);border-color:var(--brand);color:var(--brand)}

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
.card-right{display:flex;align-items:center;justify-content:flex-end;margin-top:9px;padding-top:9px;border-top:1px solid rgba(18,22,43,.06)}
.card-time-corner{position:absolute;top:12px;right:14px;display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:var(--ink3);background:rgba(255,255,255,.85);padding:3px 8px;border-radius:20px;z-index:2}
.salary-badge{font-size:11.5px;font-weight:800;color:var(--salary);background:rgba(15,174,121,.08);border:1px solid rgba(15,174,121,.18);padding:4px 11px;border-radius:8px;white-space:nowrap}
.card-time-corner{position:absolute;top:10px;right:12px;display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:var(--ink3);background:rgba(255,255,255,.75);padding:3px 8px;border-radius:20px;z-index:1}
.act-btn{width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.6);border:1px solid var(--border2);color:var(--ink3);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;position:relative;z-index:1}
.act-btn:hover{background:var(--brand-soft);color:var(--brand);transform:scale(1.08)}
.act-btn.saved{background:rgba(245,166,35,.12);border-color:var(--amber);color:var(--amber)}

/* ── TOP CATEGORY SECTIONS (remote.io-style curated rows) ── */
.cat-sections{max-width:1180px;margin:0 auto;padding:8px 24px 40px;display:flex;flex-direction:column;gap:30px}
.cat-section-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.cat-section-title{display:flex;align-items:center;gap:8px;font-size:18px;color:var(--ink)}
.cat-section-dot{width:9px;height:9px;border-radius:50%;background:var(--cat-color,var(--brand));flex-shrink:0}
.cat-section-more{background:none;border:none;font-size:12.5px;font-weight:700;color:var(--ink3);cursor:pointer;font-family:inherit;padding:6px 10px;border-radius:8px}
.cat-section-more:hover{color:var(--brand);background:var(--brand-soft)}

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

/* ── FORMS (alerts) ── */
.form-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px 20px;max-width:540px;box-shadow:var(--shadow)}
.form-group{margin-bottom:18px}
.form-label{font-size:11px;font-weight:700;color:var(--ink2);margin-bottom:7px;display:block;letter-spacing:.5px;text-transform:uppercase}
.form-input{width:100%;background:var(--surface2);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;color:var(--ink);font-size:14px;font-family:inherit;outline:none;transition:all .25s}
.form-input:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.form-input::placeholder{color:var(--ink3)}
.submit-btn{width:100%;background:var(--brand);color:#fff;padding:13px;border-radius:10px;font-size:15px;font-weight:700;font-family:inherit;border:none;cursor:pointer;transition:all .25s}
.submit-btn:hover{background:#2842e0;transform:translateY(-1px)}
.kw-chip{display:inline-flex;align-items:center;gap:6px;background:var(--brand-soft);border:1px solid rgba(53,86,255,.2);color:var(--brand);padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;margin:3px}
.kw-chip button{background:none;border:none;color:var(--brand);cursor:pointer;font-size:14px;line-height:1;padding:0;opacity:.7}

.ad-slot{border:1.5px dashed var(--border2);border-radius:12px;padding:14px;text-align:center;margin:16px 0;background:var(--surface2)}
.ad-slot-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink3);margin-bottom:4px}
.ad-slot-hint{font-size:11px;color:var(--ink3)}
.ad-slot-live{border:none;padding:0;background:transparent;display:flex;justify-content:center;overflow:hidden}

@media(max-width:860px){
  .filters-bar{top:60px}
}
@media(max-width:768px){
  .hero{padding:56px 20px 52px}
  .hero-title{font-size:36px;letter-spacing:-.8px;line-height:1.12}
  .hero-sub{font-size:13px;margin-bottom:20px}
  .search-row{flex-direction:column;padding:8px;gap:8px}
  .search-btn{padding:12px}
  .hero-stats{gap:18px}
  .hero-stat-num{font-size:17px}
  .fc-logos{gap:22px}
  .fc-logos span{font-size:15px}
  .content-wrap{padding:14px}
  .cat-sections{padding:8px 14px 30px}
  .card-inner{padding:14px 12px}
  .co-logo{width:42px;height:42px;border-radius:9px}
  .job-title-card{font-size:13px}
  .pagination{padding:20px 0 10px;gap:6px}
  .page-btn{padding:8px 13px;font-size:12px}
}
@media(max-width:380px){
  .hero-title{font-size:29px}
  .chip{padding:6px 12px;font-size:12px}
}
</style>
</head>
<body>
${navHtml()}
${mobileHeaderHtml()}

<main>
  <!-- JOBS VIEW -->
  <div id="vJobs">
    <div class="hero">
      <div class="hero-inner">
        <h1 class="hero-title">Find your next <span class="hl">remote job</span></h1>
        <p class="hero-sub">Browse curated remote positions from top companies worldwide. Filter by category, country, skill, or company — or post your own opening in minutes.</p>
        <div class="search-row">
          <div class="search-wrap">
            <span class="search-icon">${iconSearch({ size: 16 })}</span>
            <input type="text" class="search-input" id="searchInput" placeholder="Job title, skill, or company..." oninput="debounceSearch(this.value)">
          </div>
          <button class="search-btn" onclick="document.getElementById('searchInput').focus()">Search</button>
        </div>
      </div>
    </div>

    <div class="fc-strip">
      <div class="fc-inner">
        <div class="fc-label">Featured Remote Employers</div>
        <div class="fc-logos">${FEATURED_COMPANIES.map(c => `<span>${c}</span>`).join('')}</div>
      </div>
    </div>

    <div class="filters-bar">
      <button class="chip" id="categoryChipBtn" onclick="toggleFacetPanel('category')">${iconFolder({ size: 12 })} Category</button>
      <button class="chip" id="countryChipBtn" onclick="toggleFacetPanel('country')">${iconGlobe({ size: 12 })} Country</button>
      <button class="chip" id="skillChipBtn" onclick="toggleFacetPanel('skill')">${iconTag({ size: 12 })} Skills</button>
      <button class="chip" id="companyChipBtn" onclick="toggleFacetPanel('company')">${iconBuilding({ size: 12 })} Companies</button>
    </div>

    <div class="filter-panel" id="categoryPanel">
      <div class="filter-panel-inner">${categoryPanelHtml}</div>
    </div>
    <div class="filter-panel" id="countryPanel">
      <div class="filter-panel-inner">${countryPanelHtml}</div>
    </div>
    <div class="filter-panel" id="skillPanel">
      <div class="filter-panel-inner">${skillPanelHtml}</div>
    </div>
    <div class="filter-panel" id="companyPanel">
      <div class="filter-panel-inner">${companyPanelHtml}</div>
    </div>

    <div class="adv-filters" id="advFilters">
      <label class="filter-label">Remote<select class="filter-select" id="fRemote" onchange="applyAdvFilters()"><option value="">All</option><option value="fully_remote">Fully Remote</option><option value="hybrid">Hybrid</option><option value="on_site">On-site</option></select></label>
      <label class="filter-label">Employment<select class="filter-select" id="fEmploy" onchange="applyAdvFilters()"><option value="">All</option><option value="full_time">Full Time</option><option value="part_time">Part Time</option><option value="contract">Contract</option></select></label>
      <label class="filter-label">Seniority<select class="filter-select" id="fSeniority" onchange="applyAdvFilters()"><option value="">All</option><option value="Junior">Junior</option><option value="Mid">Mid-Level</option><option value="Senior">Senior</option><option value="Staff">Staff</option></select></label>
      <label class="filter-label">Min Salary<input type="number" class="salary-input" id="fSalaryMin" placeholder="$k" oninput="debounceAdv()"></label>
      <label class="filter-label">Posted<select class="filter-select" id="fDate" onchange="applyAdvFilters()"><option value="">Any time</option><option value="1">Today</option><option value="7">This week</option><option value="30">This month</option></select></label>
      <button class="clear-btn" onclick="clearAdvFilters()">${iconX({ size: 12 })} Clear</button>
    </div>

    <div class="content-wrap">
      <div class="results-hdr">
        <div class="results-count" id="resultsCount"><strong>${initialTotal.toLocaleString()}</strong> jobs found</div>
        <button class="adv-toggle-btn" id="advToggleBtn" onclick="toggleAdv()">${iconFilter({ size: 13 })} Filters</button>
      </div>
      ${adSlot('homepage-results-top')}
      <div class="jobs-list" id="jobsList">${ssrJobsHtml}</div>
      <div class="pagination" id="pagination"></div>
    </div>

    ${categorySections.length ? `
    <div class="cat-sections">
      ${categorySections.map(sec => `
        <div class="cat-section">
          <div class="cat-section-hdr">
            <h2 class="cat-section-title" style="--cat-color:${sec.meta.color}"><span class="cat-section-dot"></span>Top ${escapeHtml(sec.meta.label)} Jobs</h2>
            <button class="cat-section-more" onclick="filterCat('${sec.key}','${escapeHtml(sec.meta.label)}')">View all →</button>
          </div>
          <div class="jobs-list">${sec.jobs.map((j, i) => jobCardSSR(j, i)).join('')}</div>
        </div>`).join('')}
    </div>` : ''}
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

  <!-- ALERTS -->
  <div id="vAlerts" style="display:none">
    <div class="content-wrap">
      <button onclick="goView('jobs')" style="display:inline-flex;align-items:center;gap:7px;color:var(--ink3);font-size:13px;cursor:pointer;border:none;background:none;font-family:inherit;margin-bottom:22px;font-weight:600">← Back to Jobs</button>
      <div class="form-card">
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:700;margin-bottom:6px;color:var(--ink);display:flex;align-items:center;gap:8px">${iconBell({ size: 20 })} Job Alerts</div>
        <div style="font-size:13px;color:var(--ink2);margin-bottom:22px">Get notified by email when new matching jobs are posted.</div>
        <div class="form-group">
          <label class="form-label">Your Email</label>
          <input type="email" class="form-input" id="alertEmail" placeholder="you@example.com">
        </div>
        <div class="form-group">
          <label class="form-label">Keywords <span style="color:var(--ink3);font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">(press Enter)</span></label>
          <input type="text" class="form-input" id="alertKwInput" placeholder="e.g. React, Python..." onkeydown="addKeyword(event)">
          <div style="margin-top:8px" id="kwWrap"></div>
        </div>
        <button class="submit-btn" onclick="submitAlert()">Subscribe to Alerts →</button>
      </div>
    </div>
  </div>
</main>

${footerHtml(base)}
${postJobModalHtml()}

<div class="toast" id="toast">
  <span id="toastIcon" style="font-size:16px;display:inline-flex"></span>
  <span id="toastMsg">Done</span>
  <div class="toast-bar" id="toastBar"></div>
</div>

<script>window.__CATEGORY_META__=${JSON.stringify(CATEGORY_META)};window.__ICONS__=${JSON.stringify(CLIENT_ICONS)};</script>
<script>
const CAT_META=window.__CATEGORY_META__;
const ICONS=window.__ICONS__;
let pg=1,cat='',srch='',advT,srchT;
let jobs=${JSON.stringify(initialJobs)},total=${initialTotal};
let savedIds=JSON.parse(localStorage.getItem('jn_saved')||'[]');
let alertKws=[];
let adv={remote:'',employ:'',seniority:'',salaryMin:'',days:'',country:'',skill:'',company:''};
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
    <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:\${fs};font-weight:800;color:#3556FF">\${ini}</span>
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
  const order=['developer','designer','marketing','data','devops','manager','writer'];
  for(const k of order){if(t.includes(k))return k;}
  return 'developer';
}
function pastelFor(j){
  if(j.featured)return'var(--pastel-blue)';
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
  icon.style.color=type==='success'?'#0FAE79':'#3556FF';
  el.className='toast show';
  if(bar){bar.style.animation='none';bar.offsetHeight;bar.style.animation='toast-bar 3s linear forwards';}
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),3100);
}

const VIEWS=['vJobs','vSaved','vAlerts'];
function showView(id){
  VIEWS.forEach(v=>{const el=document.getElementById(v);if(el)el.style.display=v===id?'block':'none';});
  window.scrollTo({top:0,behavior:'smooth'});
}
function goView(v){
  if(v==='jobs'){showView('vJobs');return;}
  if(v==='saved'){showView('vSaved');renderSaved();return;}
  if(v==='alerts'){showView('vAlerts');return;}
}
window.goView=goView;

function toggleAdv(){document.getElementById('advFilters').classList.toggle('open');document.getElementById('advToggleBtn').classList.toggle('active');}
function applyAdvFilters(){
  adv.remote=document.getElementById('fRemote').value;
  adv.employ=document.getElementById('fEmploy').value;
  adv.seniority=document.getElementById('fSeniority').value;
  adv.salaryMin=document.getElementById('fSalaryMin').value;
  adv.days=document.getElementById('fDate').value;
  pg=1;loadJobs();
}
function debounceAdv(){clearTimeout(advT);advT=setTimeout(applyAdvFilters,500);}
function clearAdvFilters(){
  ['fRemote','fEmploy','fSeniority','fDate'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fSalaryMin').value='';
  adv={remote:'',employ:'',seniority:'',salaryMin:'',days:'',country:adv.country,skill:adv.skill,company:adv.company};
  pg=1;loadJobs();
}

// ── Facet picker panels (Category / Country / Skills / Companies chips) ──
// All four chips share this one generic implementation: only one panel is
// open at a time, each chip stays visually "active" whenever its facet
// currently has a value selected (independent of the other three, so
// facets combine rather than reset each other).
const FACETS=['category','country','skill','company'];
const FACET_DEFAULT_LABEL={category:ICONS.folder+' Category',country:ICONS.globe+' Country',skill:ICONS.tag+' Skills',company:ICONS.building+' Companies'};
// Only skill/company need their icon prepended client-side: their
// data-label attribute intentionally holds ONLY the plain name (see
// facetPanelServer() server-side) since their icon is an SVG string,
// which can't safely live inside an HTML attribute. Category/country
// labels already include their icon (a plain emoji, safe in attributes)
// as part of the label text itself.
const FACET_ICON_PREFIX={skill:ICONS.tag+' ',company:ICONS.building+' '};

function facetHasValue(f){ return f==='category' ? !!cat : !!adv[f]; }

function toggleFacetPanel(facet){
  const targetPanel=document.getElementById(facet+'Panel');
  const willOpen=!targetPanel.classList.contains('open');
  FACETS.forEach(f=>{
    document.getElementById(f+'Panel').classList.remove('open');
    const btn=document.getElementById(f+'ChipBtn');
    btn.classList.toggle('active',facetHasValue(f));
  });
  if(willOpen){
    targetPanel.classList.add('open');
    document.getElementById(facet+'ChipBtn').classList.add('active');
  }
}
window.toggleFacetPanel=toggleFacetPanel;

function closeFacetPanel(facet){
  document.getElementById(facet+'Panel').classList.remove('open');
  document.getElementById(facet+'ChipBtn').classList.toggle('active',facetHasValue(facet));
}

function selectFacet(btn,facet){
  const value=btn.dataset.value||'';
  if(facet==='category'){
    const rawLabel=value?(btn.dataset.label||''):'';
    filterCat(value,rawLabel.replace(/^\S+\s*/,''));
    closeFacetPanel('category');
    return;
  }
  const label=btn.dataset.label||'';
  adv[facet]=value;
  const chipBtn=document.getElementById(facet+'ChipBtn');
  if(value){
    const prefix=FACET_ICON_PREFIX[facet]||''; // empty for country — its flag is already part of label
    chipBtn.innerHTML=prefix+esc(label);
  }else{
    chipBtn.innerHTML=FACET_DEFAULT_LABEL[facet];
  }
  document.querySelectorAll('.filter-pill[data-facet="'+facet+'"]').forEach(el=>el.classList.toggle('active',el.dataset.value===value));
  closeFacetPanel(facet);
  pg=1;loadJobs();
}
window.selectFacet=selectFacet;

document.addEventListener('click',function(e){
  FACETS.forEach(f=>{
    const panel=document.getElementById(f+'Panel');
    const chipBtn=document.getElementById(f+'ChipBtn');
    if(!panel||!panel.classList.contains('open'))return;
    if(panel.contains(e.target)||chipBtn.contains(e.target))return;
    closeFacetPanel(f);
  });
});

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
    return\`<a href="/job/\${j.id}" class="job-card" style="--cat-color:\${meta.color};background:\${bg};animation:fadeInUp .3s ease \${Math.min(idx,6)*.04}s both">
      \${timeAgo?'<span class="card-time-corner">'+ICONS.clock+' '+timeAgo+'</span>':''}
      <div class="card-inner">
        <div class="card-row1">
          \${logoHtml(j.company)}
          <div class="card-body">
            <div class="card-badges">
              <span class="cat-dot"><span class="dot"></span>\${esc(meta.label)}</span>
              \${j.featured?'<span class="tag-pinned">'+ICONS.pin+' Pinned</span>':''}
              \${nw?'<span class="tag-new">'+ICONS.sparkle+' NEW</span>':''}
              \${hot?'<span class="tag-hot">'+ICONS.flame+' HOT</span>':''}
            </div>
            <div class="job-title-card">\${esc(j.title)}</div>
            <div class="job-co-card">\${esc(j.company)} <span class="verified-ico">\${ICONS.badgeCheck}</span></div>
            <div class="job-meta-row">
              \${j.location?'<span class="tag tag-loc">'+ICONS.mapPin+' '+esc(j.location)+'</span>':''}
              \${remoteTag(j.remote_type)}
              \${j.employment_type?'<span class="tag tag-type">'+esc(j.employment_type.replace(/_/g,' '))+'</span>':''}
              \${j.seniority?'<span class="tag tag-type">'+esc(j.seniority)+'</span>':''}
            </div>
          </div>
        </div>
        \${j.salary?'<div class="card-right"><div class="salary-badge">'+esc(j.salary)+'</div></div>':''}
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

function addKeyword(e){
  if(e.key!=='Enter')return;
  const inp=document.getElementById('alertKwInput');
  const val=inp.value.trim();if(!val)return;
  if(!alertKws.includes(val)){alertKws.push(val);renderKws();}
  inp.value='';
}
function removeKw(kw){alertKws=alertKws.filter(k=>k!==kw);renderKws();}
function renderKws(){
  document.getElementById('kwWrap').innerHTML=alertKws.map(k=>\`<span class="kw-chip">\${k}<button onclick="removeKw('\${k}')">×</button></span>\`).join('');
}
async function submitAlert(){
  const email=document.getElementById('alertEmail').value.trim();
  if(!email||!email.includes('@')){showToast('Please enter a valid email','info');return;}
  if(!alertKws.length){showToast('Add at least one keyword','info');return;}
  try{
    const res=await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,keywords:alertKws})});
    const d=await res.json();
    if(d.success){showToast('Subscribed successfully');document.getElementById('alertEmail').value='';alertKws=[];renderKws();}
    else showToast(d.error||'Something went wrong','info');
  }catch(e){showToast('Failed. Try again.','info');}
}

function filterCat(c,label){
  cat=c;pg=1;
  // Category is one of four independent, combinable facets (category,
  // country, skill, company) — this only ever touches the Category chip
  // and its own panel pills, never the other three facets' state.
  const chipBtn=document.getElementById('categoryChipBtn');
  const meta=c?CAT_META[c]:null;
  chipBtn.innerHTML=c?esc((meta?meta.emoji+' ':'')+label):(ICONS.folder+' Category');
  chipBtn.classList.toggle('active',!!c);
  document.querySelectorAll('.filter-pill[data-facet="category"]').forEach(el=>el.classList.toggle('active',el.dataset.value===c));
  showView('vJobs');loadJobs();
}
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
