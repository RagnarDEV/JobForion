// src/components/job-card.js
// Everything related to rendering a job as a card: company logo, remote-type tag,
// category classification, "new/hot" pastel styling, and the two card renderers
// (SSR full card + compact directory-page row).

import { CATEGORY_META, CATEGORY_ORDER, JOB_TYPE_META } from '../config/constants.js';
import { slugify, escapeHtml } from '../lib/entities.js';
import { iconSparkle, iconFlame, iconPin, iconMapPin, iconBadgeCheck, iconClock, iconGlobe, iconBuilding } from '../assets/icons.js';
import { countryFlag } from '../lib/country-flags.js';

export function logoImgHtml(company, size = '64px', cls = 'job-logo') {
  const safeCompany = escapeHtml(company);
  const slug = (company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const domain = slug + '.com';
  const ini = (company || '?').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  const fs = Math.round(parseInt(size) * .34) + 'px';
  return `<div class="${cls}" style="width:${size};height:${size}">
    <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64" alt="${safeCompany}"
      style="width:100%;height:100%;object-fit:contain;padding:7px"
      onerror="this.onerror=null;this.src='https://icons.duckduckgo.com/ip3/${domain}.ico';this.onerror=function(){this.style.display='none';this.nextElementSibling.style.display='flex'}">
    <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:${fs};font-weight:800;color:var(--brand)">${escapeHtml(ini)}</span>
  </div>`;
}

export function remoteTagHtml(t) {
  if (!t) return '';
  const m = { fully_remote: ['tag-remote', iconGlobe({ size: 11 }) + ' Remote'], hybrid: ['tag-hybrid', iconBuilding({ size: 11 }) + ' Hybrid'], on_site: ['tag-onsite', iconMapPin({ size: 11 }) + ' On-site'], onsite: ['tag-onsite', iconMapPin({ size: 11 }) + ' On-site'] };
  const [cls, lbl] = m[t] || ['tag-onsite', escapeHtml(t.replace(/_/g, ' '))];
  return `<span class="tag ${cls}">${lbl}</span>`;
}

export function jobRowMini(job) {
  const jobType = normalizeJobType(job.job_type);
  const tierIcon = jobType !== 'Free' ? `<span class="related-jt-tier" title="${JOB_TYPE_META[jobType].label}">${JOB_TYPE_META[jobType].icon}</span> ` : '';
  return `<a href="/job/${job.id}" class="related-card${jobTypeCardClass(job.job_type)}">
    ${logoImgHtml(job.company, '38px', 'related-logo')}
    <div class="related-info">
      <div class="related-jt">${tierIcon}${escapeHtml(job.title)}</div>
      <div class="related-co">${escapeHtml(job.company)} · <a href="/companies/${slugify(job.company)}" style="color:var(--ink3)" onclick="event.stopPropagation()">view company →</a></div>
    </div>
    ${job.salary ? `<div class="related-sal">${escapeHtml(job.salary)}</div>` : ''}
    <span style="color:var(--ink3)">›</span>
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
// the tier priority/labels — this file only turns that data into markup.
// ════════════════════════════════════════════════════════════════

// Any stored value that isn't one of the 4 known tiers (legacy rows,
// unexpected data) safely falls back to 'Free' rather than rendering an
// unstyled badge or crashing.
export function normalizeJobType(jobType) {
  return (jobType && JOB_TYPE_META[jobType]) ? jobType : 'Free';
}

// Free jobs get no badge at all — badges are the whole point of a paid
// tier standing out, so a "Free" badge on every ordinary listing would
// just be visual noise.
export function jobTypeBadgeHtml(jobType) {
  const type = normalizeJobType(jobType);
  if (type === 'Free') return '';
  const meta = JOB_TYPE_META[type];
  return `<span class="jt-badge jt-badge-${type.toLowerCase()}">${meta.icon} ${meta.label}</span>`;
}

// Extra class applied to the card wrapper for tier-specific border/shadow/
// scale treatment (see the .jt-card-* rules in styles/shared-css.js).
export function jobTypeCardClass(jobType) {
  const type = normalizeJobType(jobType);
  return type === 'Free' ? '' : ` jt-card-${type.toLowerCase()}`;
}

export function pastelForJob(job) {
  // Background tint is now meaningful, not decorative: only pinned and
  // high-salary jobs get a tint. "New" already has its own badge, so it
  // doesn't need to also recolor the whole card — that was just visual
  // noise competing with the badges for attention.
  if (job.featured) return 'var(--pastel-blue)';
  const isHot = job.salary && parseInt(job.salary.replace(/\D/g, '').slice(0, 3)) >= 150;
  if (isHot) return 'var(--pastel-yellow)';
  return 'var(--surface)';
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
const FALLBACK_CATEGORY_META = { label: 'General', emoji: '🏷️', color: '#3556FF' };

// `categoryMap`/`categoryOrder` are optional — default to the static
// CATEGORY_META/CATEGORY_ORDER import, so any caller not yet migrated to
// dynamic categories renders exactly as before. If a resolved key is
// somehow missing from the map (e.g. briefly, right after an admin
// deletes the category a job was classified under), FALLBACK_CATEGORY_META
// keeps the card rendering instead of throwing.
export function jobCardSSR(job, idx, categoryMap = CATEGORY_META, categoryOrder = CATEGORY_ORDER) {
  const catKey = catForTitleServer(job.title, categoryOrder);
  const meta = categoryMap[catKey] || FALLBACK_CATEGORY_META;
  const isNew = job.created_at && Date.now() - new Date(job.created_at).getTime() < 86400000;
  const isHot = job.salary && parseInt(job.salary.replace(/\D/g, '').slice(0, 3)) >= 150;
  const bg = pastelForJob(job);
  const timeAgo = timeAgoServer(job.created_at);
  const jobType = normalizeJobType(job.job_type);
  const locationFlag = job.location ? countryFlag(job.location.split(',').pop().trim()) : '';
  return `<a href="/job/${job.id}" class="job-card${jobTypeCardClass(job.job_type)}" style="--cat-color:${meta.color};background:${bg};animation:fadeInUp .3s ease ${Math.min(idx, 6) * .04}s both">
    ${timeAgo ? `<span class="card-time-corner">${iconClock({ size: 11 })} ${timeAgo}</span>` : ''}
    <div class="card-inner">
      <div class="card-row1">
        ${logoImgHtml(job.company, '54px', 'co-logo')}
        <div class="card-body">
          <div class="card-badges">
            ${jobTypeBadgeHtml(job.job_type)}
            <span class="cat-dot"><span class="dot"></span>${meta.label}</span>
            ${job.featured ? `<span class="tag-pinned">${iconPin({ size: 11 })} Pinned</span>` : ''}
            ${isNew ? `<span class="tag-new">${iconSparkle({ size: 11 })} NEW</span>` : ''}
            ${isHot ? `<span class="tag-hot">${iconFlame({ size: 11 })} HOT</span>` : ''}
          </div>
          <div class="job-title-card">${escapeHtml(job.title)}</div>
          <div class="job-co-card">${escapeHtml(job.company)} <span class="verified-ico" title="Verified">${iconBadgeCheck({ size: 12 })}</span></div>
          <div class="job-meta-row">
            ${job.location ? `<span class="tag tag-loc">${locationFlag} ` + escapeHtml(job.location) + '</span>' : ''}
            ${remoteTagHtml(job.remote_type)}
            ${job.employment_type ? '<span class="tag tag-type">' + escapeHtml(job.employment_type.replace(/_/g, ' ')) + '</span>' : ''}
          </div>
          ${jobType === 'Sponsored' && job.job_type_note ? `<div class="jt-note">${escapeHtml(job.job_type_note)}</div>` : ''}
        </div>
      </div>
      ${job.salary ? '<div class="card-right"><div class="salary-badge">' + escapeHtml(job.salary) + '</div></div>' : ''}
    </div>
  </a>`;
}

// ══════════════════════════════════════════════════════════════════
// MAIN SPA (Remote.io-inspired: navy hero, pastel job cards, SSR)
// ══════════════════════════════════════════════════════════════════
