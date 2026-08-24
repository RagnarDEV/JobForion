import { escapeHtml, slugify, cleanDescription } from '../lib/entities.js';
import { logoImgHtml } from './job-card.js';
import { iconArrowRight, iconBadgeCheck, iconBuilding, iconMapPin, iconBriefcase } from '../assets/icons.js';

function verifiedBadge(size = 13) {
  return `<span class="company-verified" title="Verified Company" aria-label="Verified Company">${iconBadgeCheck({ size })}</span>`;
}

function formatLocation(company) {
  return [company.city, company.country].filter(Boolean).join(', ') || company.location || '';
}

function safeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch (e) { return ''; }
}

export function companyCardHtml(company, { logoOverride = null } = {}) {
  const name = String(company.name || '').trim();
  const slug = company.slug || slugify(name);
  if (!name || !slug) return '';
  const safeName = escapeHtml(name);
  const location = formatLocation(company);
  const jobCount = Number(company.job_count ?? company.count ?? 0);
  const description = company.description ? cleanDescription(company.description).slice(0, 150) : '';
  const industry = company.industry || '';
  const hasProfile = Boolean(company.profile || company.id || company.logo_url || company.description || company.industry || company.country || company.verified);
  const logoUrl = safeImageUrl(company.logo_url || logoOverride) || null;
  return `<a href="/companies/${escapeHtml(slug)}" class="company-card" aria-label="View company profile for ${safeName}">
    <div class="company-card-head">
      ${logoImgHtml(name, '52px', 'company-card-logo', logoUrl)}
      <div class="company-card-title-wrap"><div class="company-card-name">${safeName}${company.verified ? verifiedBadge() : ''}</div>${hasProfile ? '<span class="company-card-profile-label">Company profile</span>' : ''}</div>
    </div>
    ${description ? `<p class="company-card-description">${escapeHtml(description)}</p>` : ''}
    <div class="company-card-meta">${industry ? `<span>${iconBuilding({ size: 13 })}${escapeHtml(industry)}</span>` : ''}${location ? `<span>${iconMapPin({ size: 13 })}${escapeHtml(location)}</span>` : ''}</div>
    <div class="company-card-footer"><span class="company-card-jobs">${iconBriefcase({ size: 13 })}${jobCount.toLocaleString()} open job${jobCount === 1 ? '' : 's'}</span><span class="company-card-action">View company ${iconArrowRight({ size: 14 })}</span></div>
  </a>`;
}

export function companyCardStyles() {
  return `<style>
    .company-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:18px}
    .company-card{display:flex;flex-direction:column;min-width:0;min-height:198px;padding:17px;background:var(--surface);border:1px solid var(--border);border-radius:14px;color:inherit;text-decoration:none;box-shadow:var(--shadow-card);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
    .company-card:hover{border-color:#cfc4fa;box-shadow:0 12px 28px rgba(48,31,121,.1);transform:translateY(-2px)}
    .company-card:focus-visible{outline:3px solid var(--brand-soft);outline-offset:2px;border-color:var(--brand)}
    .company-card-head{display:flex;align-items:center;gap:12px;min-width:0}.company-card-logo{width:52px;height:52px;border-radius:12px;flex:0 0 52px}.company-card-logo img{width:100%;height:100%;object-fit:contain;padding:7px}.company-card-title-wrap{min-width:0}.company-card-name{display:flex;align-items:center;gap:5px;min-width:0;color:var(--ink);font:800 14px/1.3 'Plus Jakarta Sans',sans-serif;overflow:hidden;text-overflow:ellipsis}.company-verified{display:inline-flex;flex:0 0 auto;color:var(--brand)}.company-card-profile-label{display:block;margin-top:3px;color:var(--ink3);font-size:10px;font-weight:700}.company-card-description{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin:13px 0 10px;color:var(--ink2);font-size:12px;line-height:1.55}.company-card-meta{display:flex;flex-wrap:wrap;gap:7px 12px;min-height:20px;color:var(--ink3);font-size:10.5px}.company-card-meta span,.company-card-jobs,.company-card-action{display:inline-flex;align-items:center;gap:5px}.company-card-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:13px;border-top:1px solid var(--border)}.company-card-jobs{color:var(--brand);font-size:10.5px;font-weight:800}.company-card-action{color:var(--ink2);font-size:10.5px;font-weight:800;white-space:nowrap}.company-card:hover .company-card-action{color:var(--brand)}
    .company-verified svg{display:block}
    @media(max-width:620px){.company-grid{grid-template-columns:1fr;gap:10px}.company-card{min-height:0;padding:14px}.company-card-footer{padding-top:11px}}
  </style>`;
}

export function companyEmptyState(title = 'No companies found', message = 'Try changing your search or clearing a filter.') {
  return `<div class="empty company-empty-state"><div class="e-icon">${iconBuilding({ size: 24 })}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`;
}
