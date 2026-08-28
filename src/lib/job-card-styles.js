// src/lib/job-card-styles.js
// ════════════════════════════════════════════════════════════════
// JOB CARD STYLE MANAGER — per-tier (Free / Featured / Premium /
// Sponsored) visual control: card background (solid color OR two-color
// gradient with adjustable angle), border (style/color/width), company
// logo size, card padding, shadow intensity, and badge colors. Single
// source of truth is D1 (`job_card_styles` table) with the CURRENT
// hand-tuned look as the hardcoded DEFAULT for each tier, so an empty
// table renders pixel-identical to before this feature existed —
// nothing changes visually until an admin actually edits a tier at
// /admin/card-styles.
//
// Applied as INLINE styles at render time (components/job-card.js),
// not as injected <style> blocks — this keeps every job-rendering
// surface (home page SSR, home page's client-side re-render after a
// filter, the job detail hero, related-job rows) trivially in sync by
// construction: they all call the same buildCardStyleAttr()/
// buildBadgeStyleAttr() helpers below on the same resolved style
// object, so there's no separate CSS file that could drift out of
// sync with the data.
// ════════════════════════════════════════════════════════════════

import { iconTierStar, iconTierCrown, iconTierRocket } from '../assets/icons.js';

export const CARD_STYLE_JOB_TYPES = ['Free', 'Featured', 'Premium', 'Sponsored'];
export const CARD_STYLE_TEMPLATES = Object.freeze(['classic', 'highlight', 'spotlight', 'promoted']);
export const CARD_STYLE_ACCENT_POSITIONS = Object.freeze(['none', 'top', 'left', 'both']);
export const CARD_STYLE_ICON_KEYS = Object.freeze(['none', 'star', 'crown', 'rocket']);

// Matches the site's existing hand-tuned tier look exactly (see the old
// .jt-card-* / .jt-badge-* rules this feature replaces in
// styles/shared-css.js) — this is what every tier looks like until an
// admin changes it.
export const DEFAULT_CARD_STYLES = {
  Free: {
    bg_type: 'solid', bg_color1: '#FFFFFF', bg_color2: '#FFFFFF', gradient_angle: 135,
    border_style: 'solid', border_color: '#E2E8F0', border_width: 1,
    logo_size: 54, card_padding: 14, shadow: 'none',
    badge_bg_color: '#EEF1FF', badge_text_color: '#2563EB', badge_border_color: '#DDE4F0', badge_radius: 20,
    template: 'classic', accent_color: '#E2E8F0', accent_position: 'none', hover_effect: 'none', icon_key: 'none',
    title_color: '#17132D', company_color: '#6B7280', meta_color: '#7C8192', salary_color: '#2B9D68',
  },
  Featured: {
    bg_type: 'solid', bg_color1: '#FFFFFF', bg_color2: '#FFFFFF', gradient_angle: 135,
    border_style: 'solid', border_color: '#2563EB', border_width: 1,
    logo_size: 54, card_padding: 14, shadow: 'soft',
    badge_bg_color: '#EEF1FF', badge_text_color: '#2563EB', badge_border_color: '#C8D8FF', badge_radius: 20,
    template: 'highlight', accent_color: '#2563EB', accent_position: 'left', hover_effect: 'glow', icon_key: 'star',
    title_color: '#17132D', company_color: '#514A70', meta_color: '#6E6A82', salary_color: '#2475D1',
  },
  Premium: {
    bg_type: 'gradient', bg_color1: '#FFFDF7', bg_color2: '#FBEDC7', gradient_angle: 135,
    border_style: 'solid', border_color: '#D4A12A', border_width: 2,
    logo_size: 60, card_padding: 16, shadow: 'strong',
    badge_bg_color: '#FBEDC7', badge_text_color: '#8A6416', badge_border_color: '#E7C86D', badge_radius: 20,
    template: 'spotlight', accent_color: '#D4A12A', accent_position: 'top', hover_effect: 'glow', icon_key: 'crown',
    title_color: '#3E2D0B', company_color: '#735A20', meta_color: '#806F4B', salary_color: '#9A6C0A',
  },
  Sponsored: {
    bg_type: 'gradient', bg_color1: '#F4FDF9', bg_color2: '#D9F3E7', gradient_angle: 180,
    border_style: 'solid', border_color: '#059669', border_width: 2,
    logo_size: 62, card_padding: 16, shadow: 'strong',
    badge_bg_color: '#D9F3E7', badge_text_color: '#0B7A50', badge_border_color: '#A9DFC4', badge_radius: 20,
    template: 'promoted', accent_color: '#059669', accent_position: 'top', hover_effect: 'glow', icon_key: 'rocket',
    title_color: '#123D2E', company_color: '#28654F', meta_color: '#4E7768', salary_color: '#087A53',
  },
};

// Fixed, curated shadow presets rather than a free-form shadow input —
// keeps every admin-chosen combination looking intentional and
// on-brand instead of admins being able to produce something visually
// broken (per the standing "professional look" requirement).
const SHADOWS = {
  none: 'none',
  soft: '0 4px 18px rgba(18,22,43,.10)',
  strong: '0 8px 26px rgba(18,22,43,.18)',
};
const HOVER_EFFECTS = Object.freeze({ none: 'none', lift: 'lift', glow: 'glow' });

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const TTL_MS = 60000;
let cache = null; // { styles: {Free:{...},...}, loadedAt }

function clamp(n, min, max, fallback) {
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function sanitizeCardStyle(jobType, fields = {}) {
  const d = DEFAULT_CARD_STYLES[jobType] || DEFAULT_CARD_STYLES.Free;
  return {
    bg_type: fields.bg_type === 'gradient' ? 'gradient' : 'solid',
    bg_color1: HEX_PATTERN.test(String(fields.bg_color1 || '')) ? String(fields.bg_color1) : d.bg_color1,
    bg_color2: HEX_PATTERN.test(String(fields.bg_color2 || '')) ? String(fields.bg_color2) : d.bg_color2,
    gradient_angle: clamp(fields.gradient_angle, 0, 360, d.gradient_angle),
    border_style: ['solid', 'dashed', 'none'].includes(fields.border_style) ? fields.border_style : d.border_style,
    border_color: HEX_PATTERN.test(String(fields.border_color || '')) ? String(fields.border_color) : d.border_color,
    border_width: clamp(fields.border_width, 0, 6, d.border_width),
    logo_size: clamp(fields.logo_size, 28, 96, d.logo_size),
    card_padding: clamp(fields.card_padding, 8, 28, d.card_padding),
    shadow: ['none', 'soft', 'strong'].includes(fields.shadow) ? fields.shadow : d.shadow,
    badge_bg_color: HEX_PATTERN.test(String(fields.badge_bg_color || '')) ? String(fields.badge_bg_color) : d.badge_bg_color,
    badge_text_color: HEX_PATTERN.test(String(fields.badge_text_color || '')) ? String(fields.badge_text_color) : d.badge_text_color,
    badge_border_color: HEX_PATTERN.test(String(fields.badge_border_color || '')) ? String(fields.badge_border_color) : d.badge_border_color,
    badge_radius: clamp(fields.badge_radius, 4, 30, d.badge_radius),
    template: CARD_STYLE_TEMPLATES.includes(fields.template) ? fields.template : d.template,
    accent_color: HEX_PATTERN.test(String(fields.accent_color || '')) ? String(fields.accent_color) : d.accent_color,
    accent_position: CARD_STYLE_ACCENT_POSITIONS.includes(fields.accent_position) ? fields.accent_position : d.accent_position,
    title_color: HEX_PATTERN.test(String(fields.title_color || '')) ? String(fields.title_color) : d.title_color,
    company_color: HEX_PATTERN.test(String(fields.company_color || '')) ? String(fields.company_color) : d.company_color,
    meta_color: HEX_PATTERN.test(String(fields.meta_color || '')) ? String(fields.meta_color) : d.meta_color,
    salary_color: HEX_PATTERN.test(String(fields.salary_color || '')) ? String(fields.salary_color) : d.salary_color,
    icon_key: CARD_STYLE_ICON_KEYS.includes(fields.icon_key) ? fields.icon_key : d.icon_key,
    hover_effect: Object.hasOwn(HOVER_EFFECTS, fields.hover_effect) ? fields.hover_effect : d.hover_effect,
  };
}

async function loadFromDb(env) {
  const styles = {};
  for (const type of CARD_STYLE_JOB_TYPES) styles[type] = { ...DEFAULT_CARD_STYLES[type] };
  try {
    const { results } = await env.DB.prepare('SELECT * FROM job_card_styles').all();
    for (const row of results || []) {
      if (!styles[row.job_type]) continue;
      styles[row.job_type] = sanitizeCardStyle(row.job_type, row);
    }
  } catch (e) {
    // table not created yet on a very first cold request — defaults above are enough
  }
  return styles;
}

export async function getCardStyles(env) {
  const now = Date.now();
  if (cache && (now - cache.loadedAt) < TTL_MS) return cache.styles;
  const styles = await loadFromDb(env);
  cache = { styles, loadedAt: now };
  return styles;
}

export async function updateCardStyle(env, jobType, fields) {
  if (!CARD_STYLE_JOB_TYPES.includes(jobType)) throw new Error(`Unknown job type: ${jobType}`);
  const clean = sanitizeCardStyle(jobType, fields);
  await env.DB.prepare(
    `INSERT INTO job_card_styles (job_type, bg_type, bg_color1, bg_color2, gradient_angle, border_style, border_color, border_width, logo_size, card_padding, shadow, badge_bg_color, badge_text_color, template, accent_color, accent_position, title_color, company_color, meta_color, salary_color, badge_border_color, badge_radius, icon_key, hover_effect, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(job_type) DO UPDATE SET
       bg_type=excluded.bg_type, bg_color1=excluded.bg_color1, bg_color2=excluded.bg_color2, gradient_angle=excluded.gradient_angle,
       border_style=excluded.border_style, border_color=excluded.border_color, border_width=excluded.border_width,
       logo_size=excluded.logo_size, card_padding=excluded.card_padding, shadow=excluded.shadow,
       badge_bg_color=excluded.badge_bg_color, badge_text_color=excluded.badge_text_color,
       template=excluded.template, accent_color=excluded.accent_color, accent_position=excluded.accent_position,
       title_color=excluded.title_color, company_color=excluded.company_color, meta_color=excluded.meta_color, salary_color=excluded.salary_color,
       badge_border_color=excluded.badge_border_color, badge_radius=excluded.badge_radius, icon_key=excluded.icon_key, hover_effect=excluded.hover_effect,
       updated_at=CURRENT_TIMESTAMP`
  ).bind(
    jobType, clean.bg_type, clean.bg_color1, clean.bg_color2, clean.gradient_angle,
    clean.border_style, clean.border_color, clean.border_width,
    clean.logo_size, clean.card_padding, clean.shadow,
    clean.badge_bg_color, clean.badge_text_color, clean.template, clean.accent_color, clean.accent_position,
    clean.title_color, clean.company_color, clean.meta_color, clean.salary_color, clean.badge_border_color, clean.badge_radius,
    clean.icon_key, clean.hover_effect
  ).run();
  cache = null;
}

export async function resetCardStyle(env, jobType) {
  if (!CARD_STYLE_JOB_TYPES.includes(jobType)) throw new Error(`Unknown job type: ${jobType}`);
  await env.DB.prepare('DELETE FROM job_card_styles WHERE job_type = ?').bind(jobType).run();
  cache = null;
}

// ── Rendering helpers — the ONLY place that turns a style object into
// CSS, shared by every server-rendered card AND injected as JSON for
// the client-side re-render in pages/home.js, so both stay in sync.
export function buildCardStyleAttr(style = DEFAULT_CARD_STYLES.Free) {
  const s = { ...DEFAULT_CARD_STYLES.Free, ...(style || {}) };
  const bg = s.bg_type === 'gradient'
    ? `linear-gradient(${s.gradient_angle}deg, ${s.bg_color1}, ${s.bg_color2})`
    : s.bg_color1;
  const border = s.border_style === 'none' ? 'none' : `${s.border_width}px ${s.border_style} ${s.border_color}`;
  const shadow = SHADOWS[s.shadow] || SHADOWS.none;
  return `background:${bg};border:${border};box-shadow:${shadow};--card-title-color:${s.title_color};--card-company-color:${s.company_color};--card-meta-color:${s.meta_color};--card-salary-color:${s.salary_color};--card-accent-color:${s.accent_color}`;
}

export function buildBadgeStyleAttr(style = DEFAULT_CARD_STYLES.Free) {
  const s = { ...DEFAULT_CARD_STYLES.Free, ...(style || {}) };
  return `background:${s.badge_bg_color};color:${s.badge_text_color};border-color:${s.badge_border_color};border-radius:${s.badge_radius}px`;
}

export function jobTypeIconHtml(jobType, style = null, options = {}) {
  const type = CARD_STYLE_JOB_TYPES.includes(jobType) ? jobType : 'Free';
  const iconKey = style?.icon_key || DEFAULT_CARD_STYLES[type]?.icon_key || 'none';
  const size = Number.isFinite(Number(options.size)) ? Math.max(10, Math.min(24, Number(options.size))) : 13;
  const cls = options.cls ? ` ${String(options.cls).replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
  const iconMap = { star: iconTierStar, crown: iconTierCrown, rocket: iconTierRocket };
  const renderIcon = iconMap[iconKey];
  return renderIcon ? renderIcon({ size, cls: cls.trim() }) : '';
}
