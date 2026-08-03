// src/config/constants.js
// Site-wide constants: category taxonomy, featured companies, canonical base URL.

export const CATEGORY_META = {
  developer: { label: 'Development',       emoji: '💻', color: '#3556FF' },
  designer:  { label: 'Design',             emoji: '🎨', color: '#D6489B' },
  marketing: { label: 'Marketing',          emoji: '📣', color: '#F5A623' },
  data:      { label: 'Data & AI',          emoji: '📊', color: '#0EA5C4' },
  devops:    { label: 'DevOps',             emoji: '⚙️', color: '#0FAE79' },
  writer:    { label: 'Writing',            emoji: '✍️', color: '#7C3AED' },
  sales:     { label: 'Sales',              emoji: '💼', color: '#F97316' },
  support:   { label: 'Customer Support',   emoji: '🎧', color: '#14B8A6' },
  product:   { label: 'Product Management', emoji: '📦', color: '#6366F1' },
  finance:   { label: 'Finance & Accounting', emoji: '💰', color: '#059669' },
  recruit:   { label: 'HR & Recruiting',    emoji: '🤝', color: '#C026D3' },
  quality:   { label: 'QA & Testing',       emoji: '🔍', color: '#0891B2' },
  manager:   { label: 'Management',         emoji: '👔', color: '#FF5C7A' },
};
export const CATEGORY_ORDER = Object.keys(CATEGORY_META);

export const BASE_URL = 'https://jobforion.com';

// ════════════════════════════════════════════════════════════════
// ASSET_VERSION — single source of truth for cache-busting every
// self-hosted brand asset (favicon.svg/.ico, favicon-32/16.png,
// apple-touch-icon.png, icon-512.png). All six are served with a
// long, aggressive Cache-Control (see routes/assets.router.js) for
// performance — which means a phone that already loaded the old
// logo will keep serving it from its local cache for days, even
// after the Worker starts returning new bytes at the exact same
// URL, because the browser never re-requests a URL it considers
// still fresh. Appending `?v=${ASSET_VERSION}` to every reference
// to these assets (nav, footer, admin shell, <head> icon links,
// manifest.json, OG/schema logo URLs) turns each edit into a brand
// new URL, forcing every device — desktop and mobile alike — to
// fetch the new file immediately instead of waiting out the cache.
// Bump this (date-based is simplest) any time the logo/icons change.
// ════════════════════════════════════════════════════════════════
export const ASSET_VERSION = '20260804';

// ════════════════════════════════════════════════════════════════
// JOB TYPE TIERS — Free / Featured / Premium / Sponsored
// Single source of truth for priority order, labels, and icons. No
// payment system yet (deliberately deferred) — this only controls
// sort order and badge/card styling. `job_type` on the jobs table
// defaults to 'Free' for every job (see db/schema.js).
// ════════════════════════════════════════════════════════════════
export const JOB_TYPE_META = {
  Sponsored: { label: 'Sponsored', icon: '🚀', priority: 0 },
  Premium: { label: 'Premium', icon: '👑', priority: 1 },
  Featured: { label: 'Featured', icon: '⭐', priority: 2 },
  Free: { label: 'Free', icon: '', priority: 3 },
};
export const JOB_TYPE_ORDER = ['Sponsored', 'Premium', 'Featured', 'Free'];

// Reused by every job-listing query (home page, /api/jobs, category/
// company/skill/country pages, admin) so the tier priority only ever
// needs to change in this one place. Falls back to the 'Free' priority
// (3) for any unexpected/legacy value via the ELSE branch, so a bad or
// missing job_type never breaks sorting.
export const JOB_TYPE_SORT_SQL = "CASE job_type WHEN 'Sponsored' THEN 0 WHEN 'Premium' THEN 1 WHEN 'Featured' THEN 2 ELSE 3 END";

