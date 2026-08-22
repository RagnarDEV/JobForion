// src/config/constants.js
// Site-wide constants: category taxonomy, featured companies, canonical base URL.

export const CATEGORY_META = {
  developer: { label: 'Development',       emoji: '💻', color: '#2563EB' },
  designer:  { label: 'Design',             emoji: '🎨', color: '#D6489B' },
  marketing: { label: 'Marketing',          emoji: '📣', color: '#F59E0B' },
  data:      { label: 'Data & AI',          emoji: '📊', color: '#38BDF8' },
  devops:    { label: 'DevOps',             emoji: '⚙️', color: '#059669' },
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
export const ASSET_VERSION = '20260816';

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

// ════════════════════════════════════════════════════════════════
// JOB STATUS LIFECYCLE (Job Management, Stage 5) — single source of
// truth, same pattern as JOB_TYPE_SORT_SQL above.
//
// The underlying DB value stays 'active' for a live/published job —
// deliberately NOT renamed to 'published', since that string is already
// hardcoded in dozens of places across sync.js, db/schema.js's column
// default, every admin/company approval handler, and every provider's
// saveJobs() call from before this stage existed. Renaming the stored
// value would need a data migration touching every existing row for a
// purely cosmetic difference; JOB_STATUS_META below is what makes the
// admin/company UI still SAY "Published" without that risk. Anywhere
// this file says "active", read it as "published and publicly visible".
//
// New statuses added in this stage: paused, closed (both employer/
// admin-initiated, reversible), expired, archived (both lifecycle-
// initiated by db/cleanup.js, a one-way trip toward eventual deletion).
// job_postings (pre-approval) has its own separate, disjoint status
// values (draft/pending/approved/rejected) — never confuse the two
// tables' status columns; a job_postings row never has 'active' and a
// jobs row never has 'pending'.
// ════════════════════════════════════════════════════════════════
export const JOB_STATUS_META = {
  active: { label: 'Published', color: '#0FAE79' },
  paused: { label: 'Paused', color: '#F5A623' },
  closed: { label: 'Closed', color: '#8890A4' },
  expired: { label: 'Expired', color: '#FF5C7A' },
  archived: { label: 'Archived', color: '#525A72' },
};
export const JOB_STATUS_ORDER = ['active', 'paused', 'closed', 'expired', 'archived'];

// The ONE filter every public-facing job query must apply — home page,
// /api/jobs, category/company/skill/country pages, search, sitemap, RSS.
// A job leaves public visibility the instant its status changes to
// anything else (paused/closed by its owner, or expired/archived by
// db/cleanup.js's lifecycle) without needing a second "is this visible"
// flag anywhere. Admin and company-owned-jobs queries intentionally do
// NOT use this — they need to see every status to manage it.
export const PUBLIC_JOB_STATUS_SQL = "jobs.status = 'active'";

// job_postings.status values (pre-approval pipeline — see
// routes/company.router.js and routes/admin/jobs.router.js). Kept
// separate from JOB_STATUS_META above on purpose (see comment there).
export const POSTING_STATUS_META = {
  draft: { label: 'Draft', color: '#8890A4' },
  pending: { label: 'Pending Review', color: '#F5A623' },
  approved: { label: 'Approved', color: '#0FAE79' },
  rejected: { label: 'Rejected', color: '#FF5C7A' },
};
export const REJECTION_REASONS = [
  'Incomplete information',
  'Invalid company',
  'Invalid job',
  'Duplicate',
  'Suspicious content',
  'Broken application link',
  'Other',
];

