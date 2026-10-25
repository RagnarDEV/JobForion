// Reusable SSR UI primitives for JobForion.
// These components intentionally render plain HTML so they work across every
// Cloudflare Worker page without introducing a client-side framework.

import { escapeHtml } from '../../lib/directory/entities.js';
import { iconExternalLink } from '../../assets/icons.js';

const SAFE_VARIANTS = new Set(['primary', 'secondary', 'quiet', 'danger']);
const SAFE_SIZES = new Set(['sm', 'md', 'lg']);

function safeToken(value, fallback = '') {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '');
}

function safeClasses(value) {
  return String(value || '').split(/\s+/).map(token => safeToken(token)).filter(Boolean).join(' ');
}

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

/**
 * Render a link or button with consistent touch sizing, focus treatment and
 * semantic variants. `content` is trusted SVG/HTML from project components;
 * labels and attributes are escaped here.
 */
export function uiButton({
  label,
  href = '',
  type = 'button',
  variant = 'primary',
  size = 'md',
  icon = '',
  className = '',
  ariaLabel = '',
  target = '',
  rel = '',
  onclick = '',
  disabled = false,
} = {}) {
  const cleanVariant = SAFE_VARIANTS.has(variant) ? variant : 'primary';
  const cleanSize = SAFE_SIZES.has(size) ? size : 'md';
  const classes = classNames('ui-btn', `ui-btn-${cleanVariant}`, `ui-btn-${cleanSize}`, className);
  const safeLabel = escapeHtml(label || 'Continue');
  const content = `${icon ? `<span class="ui-btn-icon" aria-hidden="true">${icon}</span>` : ''}<span>${safeLabel}</span>`;
  const aria = ariaLabel ? ` aria-label="${escapeHtml(ariaLabel)}"` : '';
  const click = onclick ? ` onclick="${escapeHtml(onclick)}"` : '';
  const disabledAttr = disabled ? ' disabled aria-disabled="true"' : '';

  if (href) {
    const safeHref = escapeHtml(href);
    const safeTarget = target === '_blank' ? ' target="_blank"' : '';
    const safeRel = rel ? ` rel="${escapeHtml(rel)}"` : '';
    return `<a class="${classes}" href="${safeHref}"${safeTarget}${safeRel}${aria}${click}${disabled ? ' aria-disabled="true"' : ''}>${content}</a>`;
  }

  return `<button class="${classes}" type="${escapeHtml(type)}"${aria}${click}${disabledAttr}>${content}</button>`;
}

/** Render the canonical external application CTA. */
export function applyButton({ href, jobId, label = 'Apply now', className = '', mobile = false } = {}) {
  if (!href) return '';
  const tracking = Number.isFinite(Number(jobId))
    ? `recordApplyClick(${Number(jobId)})`
    : '';
  return uiButton({
    label,
    href,
    variant: 'primary',
    size: 'lg',
    className: classNames('ui-apply-btn', mobile && 'ui-apply-btn-mobile', className),
    icon: iconExternalLink({ size: 16 }),
    target: '_blank',
    rel: 'noopener noreferrer',
    onclick: tracking,
    ariaLabel: `${label} — opens the employer application in a new tab`,
  });
}

/** Render a semantic surface/card around trusted server-rendered content. */
export function uiCard({ content = '', heading = '', className = '', as = 'section', labelledBy = '' } = {}) {
  const tag = ['article', 'div', 'section', 'aside'].includes(as) ? as : 'section';
  const safeClass = safeClasses(className);
  const headingId = labelledBy || (heading ? `ui-card-heading-${safeToken(heading).toLowerCase()}` : '');
  const aria = headingId ? ` aria-labelledby="${escapeHtml(headingId)}"` : '';
  const title = heading ? `<h2 class="ui-card-title" id="${escapeHtml(headingId)}">${escapeHtml(heading)}</h2>` : '';
  return `<${tag} class="ui-card${safeClass ? ` ${safeClass}` : ''}"${aria}>${title}${content}</${tag}>`;
}

/** Shared CSS for the primitives above. Injected by the existing layouts. */
export const UI_COMPONENTS_CSS = `
.ui-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;border:1px solid transparent;border-radius:8px;padding:0 16px;font:800 13px/1 var(--font-body,inherit);text-decoration:none;cursor:pointer;touch-action:manipulation;transition:background-color var(--transition-fast,.18s) ease,border-color var(--transition-fast,.18s) ease,color var(--transition-fast,.18s) ease,box-shadow var(--transition-fast,.18s) ease,transform var(--transition-fast,.18s) ease;white-space:nowrap;-webkit-tap-highlight-color:transparent}
.ui-btn:hover{transform:translateY(var(--motion-hover-distance,-1px))}
.ui-btn:active{transform:translateY(0)}
.ui-btn:focus-visible{outline:3px solid var(--brand-soft);outline-offset:2px}
.ui-btn[aria-disabled="true"],.ui-btn:disabled{opacity:.58;cursor:not-allowed;pointer-events:none}
.ui-btn-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.ui-btn-primary{background:var(--brand);color:#fff;box-shadow:0 7px 16px rgba(37,99,235,.18)}
.ui-btn-primary:hover{background:var(--brand2);color:#fff;box-shadow:0 10px 22px rgba(37,99,235,.24)}
.ui-btn-secondary{background:var(--surface);color:var(--brand);border-color:var(--brand)}
.ui-btn-secondary:hover{background:var(--brand-soft)}
.ui-btn-quiet{background:transparent;color:var(--ink2);border-color:var(--border)}
.ui-btn-quiet:hover{background:var(--surface2);color:var(--brand);border-color:var(--brand)}
.ui-btn-danger{background:var(--surface);color:var(--error,#dc2626);border-color:var(--error,#dc2626)}
.ui-btn-danger:hover{background:rgba(220,38,38,.06)}
.ui-btn-sm{min-height:40px;padding:0 12px;font-size:12px}.ui-btn-md{min-height:44px}.ui-btn-lg{min-height:48px;padding:0 20px;font-size:14px;border-radius:9px}
.ui-apply-btn{width:100%;letter-spacing:.01em}.ui-apply-btn-mobile{width:auto}
.ui-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card,var(--r,12px));padding:var(--space-card,16px);box-shadow:var(--shadow-card);color:var(--ink)}
.ui-card-title{margin:0 0 10px;color:var(--ink);font:800 14px/1.3 var(--font-heading,sans-serif)}
@media (hover:none){.ui-btn:hover{transform:none}}
@media (prefers-reduced-motion:reduce){.ui-btn{transition:none!important}.ui-btn:hover,.ui-btn:active{transform:none!important}}
@media(max-width:640px){.ui-btn-lg{min-height:46px}.ui-apply-btn-mobile{position:fixed;left:14px;right:14px;bottom:76px;z-index:340;display:inline-flex;box-shadow:0 10px 24px rgba(37,99,235,.25)}}
`;
