// src/components/job-card.js
// Everything related to rendering a job as a card: company logo, remote-type tag,
// category classification, "new/hot" pastel styling, and the two card renderers
// (SSR full card + compact directory-page row).

import { CATEGORY_META, CATEGORY_ORDER, JOB_TYPE_META } from '../config/constants.js';
import { slugify, escapeHtml } from '../lib/entities.js';
import { iconSparkle, iconFlame, iconPin, iconMapPin, iconBadgeCheck, iconClock, iconGlobe, iconBuilding, iconBookmark } from '../assets/icons.js';
import { DEFAULT_CARD_STYLES, buildCardStyleAttr, buildBadgeStyleAttr, jobTypeIconHtml } from '../lib/job-card-styles.js';
import { logoProxyPath } from '../lib/logo-proxy.js';
import { isHotPayJob, HOT_PAY_LABEL } from '../lib/hot-pay.js';
import { salaryTierEnabled } from '../lib/salary-tier.js';

// Shared empty-Set default for jobCardSSR's optional verifiedCompanySet
// param — a single frozen instance instead of allocating `new Set()` on
// every call with no argument.
const EMPTY_SET = new Set();

function safeLogoUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//')) return '';
  if (raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch (e) { return ''; }
}

export function logoImgHtml(company, size = '64px', cls = 'job-logo', overrideUrl = null, website = '') {
  const safeCompany = escapeHtml(company);
  const fs = Math.round(parseInt(size) * .34) + 'px';
  const ini = (company || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  // Priority: (1) admin/employer-set logo (companies.logo_url /
  // company_logos table, passed in as overrideUrl) — (2) automatic
  // best-effort brand favicon, resolved and cached Worker-side by
  // lib/logo-proxy.js so the visitor's browser only ever talks to our own
  // origin, never a third party — (3) monogram initials if both 404/fail.
  const trustedOverride = safeLogoUrl(overrideUrl);
  const src = trustedOverride || logoProxyPath(company, website);
  if (src) {
    const safeSrc = escapeHtml(src);
    return `<div class="${cls}" style="width:${size};height:${size};background:#fff">
    <img src="${safeSrc}" alt="${safeCompany}" loading="lazy"
      style="width:100%;height:100%;object-fit:contain;padding:7px"
      onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex'">
    <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:${fs};font-weight:800;color:var(--brand)">${escapeHtml(ini)}</span>
  </div>`;
  }
  return `<div class="${cls} monogram-logo" role="img" aria-label="${safeCompany}" style="width:${size};height:${size};display:flex;align-items:center;justify-content:center;font-size:${fs};font-weight:800;color:var(--brand);background:#fff">${escapeHtml(ini)}</div>`;
}

export function jobLocationHtml(jobOrLocation, { compact = false, className = '' } = {}) {
  const location = typeof jobOrLocation === 'object' ? jobOrLocation?.location : jobOrLocation;
  const value = String(location || '').trim();
  if (!value) return '';
  const compactStyle = compact ? ' style="font-size:11px;color:var(--ink3);max-width:180px;overflow:hidden;text-overflow:ellipsis"' : '';
  return `<span class="job-location job-location-v2${compact ? ' job-location-compact' : ''}${className ? ` ${escapeHtml(className)}` : ''}" title="Job location"${compactStyle}>${iconMapPin({ size: compact ? 10 : 11 })} ${escapeHtml(value)}</span>`;
}

export function remoteTagHtml(t) {
  if (!t) return '';
  const m = { fully_remote: ['tag-remote', iconGlobe({ size: 11 }) + ' Remote'], hybrid: ['tag-hybrid', iconBuilding({ size: 11 }) + ' Hybrid'], on_site: ['tag-onsite', iconMapPin({ size: 11 }) + ' On-site'], onsite: ['tag-onsite', iconMapPin({ size: 11 }) + ' On-site'] };
  const [cls, lbl] = m[t] || ['tag-onsite', escapeHtml(t.replace(/_/g, ' '))];
  return `<span class="tag ${cls}">${lbl}</span>`;
}

// Compact single-line job row used on directory detail pages (company /
// category / skill / country / search). REDESIGNED to be self-contained:
// the essential layout (flex row, gaps, truncation) is set via inline
// `style=` on every element, not solely via the `.related-*` CSS classes
// in layout/base-layout.js. Inline styles are near-impossible to
// accidentally override via specificity conflicts or a stale cached
// stylesheet, so this card always renders as one clean horizontal row —
// logo, title/company/meta, salary, and action — even in the worst case.
// The `.related-card` CLASS is still applied on top for the hover-lift
// transition (see base-layout.js), but nothing structural depends on it.
export function salaryTierBadgeHtml(jobOrTier, settings = {}) {
  const tier = typeof jobOrTier === 'object' ? jobOrTier?.salary_tier : jobOrTier;
  if (!salaryTierEnabled(settings) || !['HIGH', 'GOOD', 'STANDARD'].includes(tier)) return '';
  const key = tier.toLowerCase();
  const defaults = { HIGH: 'High Pay', GOOD: 'Good Pay', STANDARD: 'Standard Pay' };
  const label = settings[`salary_tier_${key}_label`] || defaults[tier];
  const safeLabel = escapeHtml(label);
  return `<span class="salary-tier-badge salary-tier-${key}" aria-label="${safeLabel}" title="${safeLabel}">${safeLabel}</span>`;
}

export function jobRowMini(job, logoOverrides = {}, settings = {}, cardStyles = DEFAULT_CARD_STYLES) {
  const jobType = normalizeJobType(job.job_type);
  const jtStyle = cardStyles[jobType] || DEFAULT_CARD_STYLES[jobType];
  const tierIcon = jobType !== 'Free'
    ? `<span class="jt-mini-icon" title="${escapeHtml(JOB_TYPE_META[jobType].label)}">${jobTypeIconHtml(jobType, jtStyle, { size: 12 })}</span>`
    : '';
  const remoteBadge = job.remote_type ? remoteTagHtml(job.remote_type) : '';
  const logoOverride = job.company_logo_url || logoOverrides[(job.company || '').toLowerCase()] || null;
  return `<a href="/job/${job.id}" class="related-card${jobTypeCardClass(job.job_type, jtStyle)}" style="display:flex;align-items:center;gap:14px;${buildCardStyleAttr(jtStyle)};border-radius:12px;padding:13px 16px;text-decoration:none">
    <div style="flex-shrink:0;display:flex">${logoImgHtml(job.company, '40px', 'related-logo', logoOverride, job.company_website)}</div>
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;align-items:center;font-size:13.5px;font-weight:700;color:var(--card-title-color,var(--ink));white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${tierIcon}${escapeHtml(job.title)}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0">
        <span style="font-size:12px;font-weight:600;color:var(--card-company-color,var(--brand));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${escapeHtml(job.company)}</span>
        ${jobLocationHtml(job, { compact: true })}
        ${remoteBadge}
        ${salaryTierBadgeHtml(job, settings)}
      </div>
    </div>
    <div style="flex-shrink:0;display:flex;align-items:center;gap:12px">
      ${job.salary ? `<span style="font-family:var(--font-mono,inherit);font-size:12px;font-weight:700;color:var(--card-salary-color,var(--salary));white-space:nowrap">${escapeHtml(job.salary)}</span>` : ''}
    </div>
  </a>`;
}

// `iconFn(item)` is optional — when provided, its return value (expected
// to be a small emoji/icon string, NOT user-controlled HTML) is rendered
// immediately before the entity name. Used by the /countries directory to
// prefix each entry with a flag emoji (see lib/country-flags.js) without
// touching the /companies and /skills callers, which simply omit the arg.
export function directoryGridHtml(items, hrefBase, iconFn) {
  if (!items.length) return `<div class="empty"><div class="e-icon">📭</div><h3>No entries yet</h3><p>Check back after the next sync.</p></div>`;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
    ${items.map(it => {
      const icon = iconFn ? iconFn(it) : '';
      return `<a href="${hrefBase}/${it.slug}" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;text-decoration:none;display:flex;align-items:center;justify-content:space-between;gap:10px;transition:all .2s" onmouseover="this.style.borderColor='var(--brand)'" onmouseout="this.style.borderColor='var(--border)'">
        <span style="font-size:14px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:7px">${icon}${escapeHtml(it.name)}</span>
        <span style="font-size:11px;font-weight:700;color:var(--brand);background:var(--brand-soft);padding:3px 9px;border-radius:20px">${it.count}</span>
      </a>`;
    }).join('')}
  </div>`;
}


// `categoryOrder` is optional — defaults to the static CATEGORY_ORDER
// import so any caller not yet migrated to dynamic categories (see
// lib/categories.js) behaves exactly as before. Callers that already
// have a request-scoped dynamic order (home.js, job-page.js,
// seo-pages.js) should pass it explicitly. Falls back to the first
// entry in whatever order was given (rather than a hardcoded key) so
// this never breaks if an admin renames/removes the 'developer' category.
export function catForTitleServer(title, categoryOrder = CATEGORY_ORDER) {
  const t = (title || '').toLowerCase();
  for (const k of categoryOrder) { if (t.includes(k)) return k; }
  return categoryOrder[0] || 'developer';
}

// ════════════════════════════════════════════════════════════════
// JOB TYPE (Free / Featured / Premium / Sponsored) — shared helpers used
// by every job-rendering surface (jobCardSSR below, home.js's client-side
// renderJobsList(), jobRowMini, job-page.js). See config/constants.js for
// the tier labels/icons — this file only turns that data into markup. Tier
// styling is independent from the manual `featured` pin flag.
// ════════════════════════════════════════════════════════════════

// Any stored value that isn't one of the 4 known tiers (legacy rows,
// unexpected data) safely falls back to 'Free' rather than rendering an
// unstyled badge or crashing.
export function normalizeJobType(jobType) {
  return (jobType && JOB_TYPE_META[jobType]) ? jobType : 'Free';
}

// Free jobs get no badge at all — badges are the whole point of a paid
// tier standing out, so a "Free" badge on every ordinary listing would
// just be visual noise. `cardStyles` optional — defaults to
// DEFAULT_CARD_STYLES (see lib/job-card-styles.js) so any caller not
// yet passing dynamic per-tier colors renders exactly as before.
export function jobTypeBadgeHtml(jobType, cardStyles = DEFAULT_CARD_STYLES) {
  const type = normalizeJobType(jobType);
  if (type === 'Free') return '';
  const meta = JOB_TYPE_META[type];
  const style = cardStyles[type] || DEFAULT_CARD_STYLES[type];
  return `<span class="jt-badge" style="${buildBadgeStyleAttr(style)}">${jobTypeIconHtml(type, style, { size: 12, cls: 'jt-badge-icon' })}<span>${meta.label}</span></span>`;
}

// Extra class applied to the card wrapper — kept only as a styling
// HOOK (e.g. .jt-card-premium:hover in styles/shared-css.js still adds
// a bigger lift/shadow on hover for paid tiers). All AT-REST visual
// styling (background/border/shadow) is now applied inline via
// buildCardStyleAttr() so it can be admin-controlled per tier — see
// lib/job-card-styles.js.
export function jobTypeCardClass(jobType, style = null) {
  const type = normalizeJobType(jobType);
  const s = style || DEFAULT_CARD_STYLES[type];
  const template = ['classic', 'highlight', 'spotlight', 'promoted'].includes(s?.template) ? s.template : 'classic';
  const accent = ['none', 'top', 'left', 'both'].includes(s?.accent_position) ? s.accent_position : 'none';
  const hover = ['none', 'lift', 'glow'].includes(s?.hover_effect) ? s.hover_effect : 'none';
  return `${type === 'Free' ? '' : ` jt-card-${type.toLowerCase()}`} jct-template-${template} jct-accent-${accent} jct-hover-${hover}`;
}

export function salaryTierCardTint(job) {
  const tints = {
    HIGH: 'var(--salary-high-bg,#eafaf1)',
    GOOD: 'var(--salary-good-bg,#f0ecff)',
    STANDARD: 'var(--salary-standard-bg,#f5f5f7)',
  };
  return tints[job?.salary_tier] || '';
}

export function pastelForJob(job, featuredEnabled = true, hotPaySettings = {}) {
  // Background tint is an independent presentation signal. Manual pinning
  // keeps first priority; persisted salary tiers then color Free cards.
  // HOT PAY remains independently calculated and keeps its legacy yellow tint
  // when no displayable tier is available, so neither signal is lost.
  if (featuredEnabled && job.featured) return 'var(--pastel-blue)';
  return salaryTierCardTint(job) || (isHotJob(job, hotPaySettings) ? 'var(--pastel-yellow)' : 'var(--surface)');
}

// Compatibility wrapper for the single HOT PAY rule in lib/hot-pay.js.
// That rule reads normalized annual USD columns first and only parses the
// existing raw salary/description data for legacy rows; -1 remains the
// backfill sentinel for "checked, but unparseable" and is never HOT.
export function isHotJob(job, hotPaySettings = {}) {
  return isHotPayJob(job, hotPaySettings);
}
export function timeAgoServer(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (h < 1) return 'just now';
  if (h < 24) return h + 'h ago';
  return d + 'd ago';
}
const FALLBACK_CATEGORY_META = { label: 'General', emoji: '🏷️', color: '#2563EB' };

// `categoryMap`/`categoryOrder` are optional — default to the static
// CATEGORY_META/CATEGORY_ORDER import, so any caller not yet migrated to
// dynamic categories renders exactly as before. If a resolved key is
// somehow missing from the map (e.g. briefly, right after an admin
// deletes the category a job was classified under), FALLBACK_CATEGORY_META
// keeps the card rendering instead of throwing.
//
// `cardStyles` (optional, new) is the resolved {Free,Featured,Premium,
// Sponsored} object from lib/job-card-styles.js — defaults to
// DEFAULT_CARD_STYLES so this renders identically whether or not a
// caller has fetched dynamic styles yet.
// `featuredEnabled` (optional, defaults true — Admin Dashboard V2, Phase
// 3) mirrors the `feature_featured_jobs` flag in lib/settings.js. When
// false, the "Pinned" badge and its blue background tint are suppressed
// site-wide, without touching the underlying `jobs.featured` column or
// its `ORDER BY featured DESC` priority in listing queries — those stay
// exactly as they were, since re-ordering results per flag would be a
// much bigger, riskier change than hiding a badge. Every caller below
// defaults to `true` so nothing changes for a caller that hasn't been
// updated to pass it explicitly yet.
// verifiedCompanySet: Set of lowercased company names with a real,
// admin-verified companies row (see lib/companies.js's
// getVerifiedCompanyNameSet, 60s-cached). Optional + defaults to an empty
// Set purely so every existing call site keeps compiling/rendering
// unchanged if it isn't updated to pass one — the badge just stays
// hidden rather than the page breaking (plan §8: verified badge in job
// listings/search results).
export function jobCardSSR(job, idx, categoryMap = CATEGORY_META, categoryOrder = CATEGORY_ORDER, cardStyles = DEFAULT_CARD_STYLES, logoOverrides = {}, featuredEnabled = true, verifiedCompanySet = EMPTY_SET, hotPaySettings = {}) {
  const catKey = catForTitleServer(job.title, categoryOrder);
  const meta = categoryMap[catKey] || FALLBACK_CATEGORY_META;
  const isNew = job.created_at && Date.now() - new Date(job.created_at).getTime() < 86400000;
  const isHot = job.isHotPay === true || (job.isHotPay !== false && isHotJob(job, hotPaySettings));
  const logoOverride = job.company_logo_url || logoOverrides[(job.company || '').toLowerCase()] || null;
  const timeAgo = timeAgoServer(job.created_at);
  const jobType = normalizeJobType(job.job_type);
  const jtStyle = cardStyles[jobType] || DEFAULT_CARD_STYLES[jobType];
  // Paid tiers always show their own admin-configured background; a Free
  // job keeps the existing "hot/pinned" pastel-tint signal, which is
  // orthogonal to (and more useful than) a per-tier background on the
  // free tier specifically. Appending `;background:${bg}` after
  // buildCardStyleAttr()'s own background declaration lets the later
  // one win within the same inline style attribute.
  const freeTint = jobType === 'Free' ? pastelForJob(job, featuredEnabled, hotPaySettings) : null;
  const cardStyleAttr = buildCardStyleAttr(jtStyle) + (freeTint ? `;background:${freeTint}` : '');

  // job.skills comes straight off a raw D1 row (SELECT * FROM jobs) in
  // every caller of this function — it's stored as a JSON string
  // (JSON.stringify at sync time, see db/sync.js), never a parsed array,
  // so every render path needs its own safe parse rather than assuming
  // the shape.
  let skillsList = [];
  try { skillsList = JSON.parse(job.skills || '[]'); } catch (e) {}
  const skillsTagsHtml = skillsList.slice(0, 3).map(s => `<span class="tag tag-type">${escapeHtml(s)}</span>`).join('');
  return `<article class="job-card${jobTypeCardClass(job.job_type, jtStyle)}" style="--cat-color:${meta.color};${cardStyleAttr};animation:fadeInUp .3s ease ${Math.min(idx, 6) * .04}s both">
    <div class="card-inner" style="padding:${jtStyle.card_padding}px 16px;background:inherit">
      <a href="/job/${job.id}" class="card-row1" aria-label="View ${escapeHtml(job.title)} at ${escapeHtml(job.company)}">
        ${logoImgHtml(job.company, `${jtStyle.logo_size}px`, 'co-logo', logoOverride, job.company_website)}
        <div class="card-body">
          <div class="card-badges">
            ${jobTypeBadgeHtml(job.job_type, cardStyles)}
            <span class="cat-dot"><span class="dot"></span>${meta.label}</span>
            ${featuredEnabled && job.featured ? `<span class="tag-pinned">${iconPin({ size: 11 })} Pinned</span>` : ''}
            ${isNew ? `<span class="tag-new">${iconSparkle({ size: 11 })} NEW</span>` : ''}
            ${isHot ? `<span class="tag-hot">${iconFlame({ size: 11 })} ${HOT_PAY_LABEL}</span>` : ''}
            ${salaryTierBadgeHtml(job, hotPaySettings)}
          </div>
          <div class="job-title-card">${escapeHtml(job.title)}</div>
          <div class="job-co-card">${escapeHtml(job.company)} ${verifiedCompanySet.has((job.company || '').toLowerCase()) ? `<span class="verified-ico" title="Verified Company">${iconBadgeCheck({ size: 12 })}</span>` : ''}</div>
          <div class="job-meta-row">
            ${remoteTagHtml(job.remote_type)}
            ${job.employment_type ? '<span class="tag tag-type">' + escapeHtml(job.employment_type.replace(/_/g, ' ')) + '</span>' : ''}
            ${skillsTagsHtml}
          </div>
          ${jobType === 'Sponsored' && job.job_type_note ? `<div class="jt-note">${escapeHtml(job.job_type_note)}</div>` : ''}
        </div>
      </a>
      <div class="card-right">
        <div class="card-secondary-meta">${jobLocationHtml(job, { compact: true })}${timeAgo ? `<span class="card-time-corner">${iconClock({ size: 11 })} ${timeAgo}</span>` : ''}</div>
        ${job.salary ? '<div class="salary-badge">' + escapeHtml(job.salary) + '</div>' : ''}
        <button class="act-btn card-save-btn" id="sb-${job.id}" onclick="event.preventDefault();event.stopPropagation();if(window.toggleSave){window.toggleSave(${job.id})}" aria-label="Save job" title="Save job">${iconBookmark({ size: 16 })}</button>
      </div>
    </div>
  </article>`;
}

// ══════════════════════════════════════════════════════════════════
// MAIN SPA (Remote.io-inspired: navy hero, pastel job cards, SSR)
// ══════════════════════════════════════════════════════════════════
