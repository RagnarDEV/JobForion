// src/components/affiliate-block.js
// Public "Recommended resources" card(s). Pure HTML builder — no I/O.
// Every link goes through /go/<slug> (tracked server-side redirect) and carries
// rel="sponsored nofollow noopener" as Google requires for paid/affiliate links.
// A visible disclosure line is always rendered with the block.

import { escapeHtml } from '../lib/directory/entities.js';
import {
  iconTag, iconBriefcase, iconSparkle, iconTrendingUp, iconShieldCheck,
  iconCoins, iconGraduationCap, iconLaptop, iconExternalLink,
} from '../assets/icons.js';

const ICONS = { tag: iconTag, briefcase: iconBriefcase, sparkle: iconSparkle, trending: iconTrendingUp, shield: iconShieldCheck, coins: iconCoins, graduation: iconGraduationCap, laptop: iconLaptop };

export const AFFILIATE_CSS = `
.aff-block{margin:20px 0;border:1px solid var(--border);border-radius:var(--r,12px);background:var(--surface);padding:16px 18px}
.aff-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.aff-title{font-family:var(--font-heading,sans-serif);font-size:15px;font-weight:700;color:var(--ink)}
.aff-label{font-size:11.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--ink3)}
.aff-list{display:grid;gap:10px}
.aff-item{display:flex;align-items:center;gap:14px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;text-decoration:none;color:inherit;transition:border-color .15s ease;-webkit-tap-highlight-color:transparent}
.aff-item:hover{border-color:var(--brand)}
.aff-ico{width:42px;height:42px;border-radius:10px;background:var(--brand-soft);color:var(--brand);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.aff-body{flex:1;min-width:0}
.aff-name{font-size:14.5px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.aff-badge{font-size:11px;font-weight:800;color:var(--brand);background:var(--brand-soft);padding:2px 8px;border-radius:20px}
.aff-desc{font-size:13px;color:var(--ink2);margin-top:2px;line-height:1.5}
.aff-cta{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--brand);white-space:nowrap}
.aff-note{margin-top:10px;font-size:12px;color:var(--ink3);line-height:1.5}
@media(max-width:640px){.aff-item{flex-wrap:wrap}.aff-cta{width:100%;justify-content:flex-end}}
`;

export function affiliateBlockHtml(offers, { placement, disclosure = '', heading = 'Recommended resources' } = {}) {
  if (!Array.isArray(offers) || !offers.length) return '';
  const items = offers.map((o) => {
    const icon = (ICONS[o.icon_key] || iconTag)({ size: 20 });
    const href = `/go/${encodeURIComponent(o.slug)}?p=${encodeURIComponent(placement || '')}`;
    return `<a class="aff-item" href="${escapeHtml(href)}" target="_blank" rel="sponsored nofollow noopener">
      <span class="aff-ico">${icon}</span>
      <span class="aff-body"><span class="aff-name">${escapeHtml(o.title)}${o.badge ? `<span class="aff-badge">${escapeHtml(o.badge)}</span>` : ''}</span>${o.description ? `<span class="aff-desc">${escapeHtml(o.description)}</span>` : ''}</span>
      <span class="aff-cta">${escapeHtml(o.cta_label || 'Learn more')} ${iconExternalLink({ size: 14 })}</span>
    </a>`;
  }).join('');
  return `<style>${AFFILIATE_CSS}</style><aside class="aff-block" aria-label="${escapeHtml(heading)}" data-placement="${escapeHtml(placement || '')}">
    <div class="aff-head"><span class="aff-title">${escapeHtml(heading)}</span><span class="aff-label">Sponsored</span></div>
    <div class="aff-list">${items}</div>
    ${disclosure ? `<p class="aff-note">${escapeHtml(disclosure)}</p>` : ''}
  </aside>`;
}
