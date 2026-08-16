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

export const CARD_STYLE_JOB_TYPES = ['Free', 'Featured', 'Premium', 'Sponsored'];

// Matches the site's existing hand-tuned tier look exactly (see the old
// .jt-card-* / .jt-badge-* rules this feature replaces in
// styles/shared-css.js) — this is what every tier looks like until an
// admin changes it.
export const DEFAULT_CARD_STYLES = {
  Free: {
    bg_type: 'solid', bg_color1: '#FFFFFF', bg_color2: '#FFFFFF', gradient_angle: 135,
    border_style: 'solid', border_color: '#E2E8F0', border_width: 1,
    logo_size: 54, card_padding: 14, shadow: 'none',
    badge_bg_color: '#EEF1FF', badge_text_color: '#2563EB',
  },
  Featured: {
    bg_type: 'solid', bg_color1: '#FFFFFF', bg_color2: '#FFFFFF', gradient_angle: 135,
    border_style: 'solid', border_color: '#2563EB', border_width: 1,
    logo_size: 54, card_padding: 14, shadow: 'soft',
    badge_bg_color: '#EEF1FF', badge_text_color: '#2563EB',
  },
  Premium: {
    bg_type: 'gradient', bg_color1: '#FFFDF7', bg_color2: '#FBEDC7', gradient_angle: 135,
    border_style: 'solid', border_color: '#D4A12A', border_width: 2,
    logo_size: 60, card_padding: 16, shadow: 'strong',
    badge_bg_color: '#FBEDC7', badge_text_color: '#8A6416',
  },
  Sponsored: {
    bg_type: 'gradient', bg_color1: '#F4FDF9', bg_color2: '#D9F3E7', gradient_angle: 180,
    border_style: 'solid', border_color: '#059669', border_width: 2,
    logo_size: 62, card_padding: 16, shadow: 'strong',
    badge_bg_color: '#D9F3E7', badge_text_color: '#0B7A50',
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

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const TTL_MS = 60000;
let cache = null; // { styles: {Free:{...},...}, loadedAt }

function clamp(n, min, max, fallback) {
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

async function loadFromDb(env) {
  const styles = {};
  for (const type of CARD_STYLE_JOB_TYPES) styles[type] = { ...DEFAULT_CARD_STYLES[type] };
  try {
    const { results } = await env.DB.prepare('SELECT * FROM job_card_styles').all();
    for (const row of results || []) {
      if (!styles[row.job_type]) continue;
      styles[row.job_type] = {
        bg_type: row.bg_type, bg_color1: row.bg_color1, bg_color2: row.bg_color2, gradient_angle: row.gradient_angle,
        border_style: row.border_style, border_color: row.border_color, border_width: row.border_width,
        logo_size: row.logo_size, card_padding: row.card_padding, shadow: row.shadow,
        badge_bg_color: row.badge_bg_color, badge_text_color: row.badge_text_color,
      };
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
  const d = DEFAULT_CARD_STYLES[jobType];
  const clean = {
    bg_type: fields.bg_type === 'gradient' ? 'gradient' : 'solid',
    bg_color1: HEX_PATTERN.test(fields.bg_color1 || '') ? fields.bg_color1 : d.bg_color1,
    bg_color2: HEX_PATTERN.test(fields.bg_color2 || '') ? fields.bg_color2 : d.bg_color2,
    gradient_angle: clamp(fields.gradient_angle, 0, 360, d.gradient_angle),
    border_style: ['solid', 'dashed', 'none'].includes(fields.border_style) ? fields.border_style : d.border_style,
    border_color: HEX_PATTERN.test(fields.border_color || '') ? fields.border_color : d.border_color,
    border_width: clamp(fields.border_width, 0, 6, d.border_width),
    logo_size: clamp(fields.logo_size, 28, 96, d.logo_size),
    card_padding: clamp(fields.card_padding, 8, 28, d.card_padding),
    shadow: ['none', 'soft', 'strong'].includes(fields.shadow) ? fields.shadow : d.shadow,
    badge_bg_color: HEX_PATTERN.test(fields.badge_bg_color || '') ? fields.badge_bg_color : d.badge_bg_color,
    badge_text_color: HEX_PATTERN.test(fields.badge_text_color || '') ? fields.badge_text_color : d.badge_text_color,
  };
  await env.DB.prepare(
    `INSERT INTO job_card_styles (job_type, bg_type, bg_color1, bg_color2, gradient_angle, border_style, border_color, border_width, logo_size, card_padding, shadow, badge_bg_color, badge_text_color, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(job_type) DO UPDATE SET
       bg_type=excluded.bg_type, bg_color1=excluded.bg_color1, bg_color2=excluded.bg_color2, gradient_angle=excluded.gradient_angle,
       border_style=excluded.border_style, border_color=excluded.border_color, border_width=excluded.border_width,
       logo_size=excluded.logo_size, card_padding=excluded.card_padding, shadow=excluded.shadow,
       badge_bg_color=excluded.badge_bg_color, badge_text_color=excluded.badge_text_color, updated_at=CURRENT_TIMESTAMP`
  ).bind(
    jobType, clean.bg_type, clean.bg_color1, clean.bg_color2, clean.gradient_angle,
    clean.border_style, clean.border_color, clean.border_width,
    clean.logo_size, clean.card_padding, clean.shadow,
    clean.badge_bg_color, clean.badge_text_color
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
export function buildCardStyleAttr(style) {
  const bg = style.bg_type === 'gradient'
    ? `linear-gradient(${style.gradient_angle}deg, ${style.bg_color1}, ${style.bg_color2})`
    : style.bg_color1;
  const border = style.border_style === 'none' ? 'none' : `${style.border_width}px ${style.border_style} ${style.border_color}`;
  const shadow = SHADOWS[style.shadow] || SHADOWS.none;
  return `background:${bg};border:${border};box-shadow:${shadow}`;
}

export function buildBadgeStyleAttr(style) {
  return `background:${style.badge_bg_color};color:${style.badge_text_color}`;
}
