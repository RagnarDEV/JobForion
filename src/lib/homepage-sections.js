// src/lib/homepage-sections.js
// ════════════════════════════════════════════════════════════════
// HOMEPAGE SECTIONS BUILDER — lets an admin enable/disable and reorder
// the homepage's composable blocks from /admin/homepage, with zero
// redeploy. Deliberately NOT a general-purpose page builder (no custom
// HTML injection, no arbitrary new sections) — see the project's own
// "Phase 4" spec: "لا أريد نظام Page Builder معقد... Sections قابلة
// للتفعيل/التعطيل وإعادة الترتيب."
//
// Mirrors the exact same fixed-set + D1-override + in-memory-cache
// pattern as lib/ad-slots.js: SECTION KEYS are fixed in code and each
// rendered Homepage block has an explicit definition here. Visibility and
// order are admin-controlled and persisted in `homepage_sections`; custom
// code blocks are managed separately in homepage-custom-sections.js.
//
// AUDIT NOTE: the homepage is a cohesive SSR/SPA render, so definitions
// below map to actual visible blocks in home.js rather than invented routes.
// The job listing owns the search/filter interaction, while the sidebar cards
// are split into independently controllable blocks at render time.
// ════════════════════════════════════════════════════════════════

export const HOMEPAGE_SECTION_DEFS = [
  { key: 'hero', label: 'Hero + Search', description: 'Headline, subtitle, and the main search box. Carries the site\u2019s primary search entry point.', required: true },
  { key: 'featured_companies', label: 'Featured Companies Strip', description: 'Logos of the companies with the most active listings right now.', required: false },
  { key: 'categories_grid', label: 'Browse by Category', description: 'Quick-link grid to the top job categories.', required: false },
  { key: 'job_listing', label: 'Job Listing', description: 'The core paginated, filterable job list — the product itself.', required: true },
  { key: 'job_alerts', label: 'Job Alerts Card', description: 'Sidebar card inviting visitors to create a personalized job alert.', required: false },
  { key: 'career_boost', label: 'Boost Your Career Card', description: 'Sidebar card inviting job seekers to complete their profile.', required: false },
  { key: 'career_resources', label: 'Career Resources Card', description: 'Sidebar links to advice, interview tips, skills, and countries.', required: false },
  { key: 'career_insights', label: 'Career Insights', description: 'Blog and career guidance cards shown below the job listing.', required: false },
  { key: 'trust_strip', label: 'Trust Strip', description: 'Remote jobs, verified companies, daily updates, and free-for-job-seekers claims.', required: false },
  { key: 'employer_cta', label: 'Employer CTA Banner', description: 'Hiring banner with the Post a Job action.', required: false },
];

const DEFAULT_ORDER = Object.fromEntries(HOMEPAGE_SECTION_DEFS.map((s, i) => [s.key, i]));
const LEGACY_SECTION_ALIASES = Object.freeze({
  cta_banner: ['career_insights', 'trust_strip', 'employer_cta'],
});

const TTL_MS = 60000; // same 60s per-isolate cache convention as lib/ad-slots.js and lib/settings.js
let cache = null; // { sections, loadedAt }

async function loadFromDb(env) {
  const map = {};
  for (const def of HOMEPAGE_SECTION_DEFS) {
    map[def.key] = { ...def, enabled: true, sort_order: DEFAULT_ORDER[def.key] };
  }
  try {
    const { results } = await env.DB.prepare('SELECT * FROM homepage_sections').all();
    for (const row of results || []) {
      const keys = map[row.section_key] ? [row.section_key] : (LEGACY_SECTION_ALIASES[row.section_key] || []);
      for (const key of keys) {
        if (!map[key]) continue; // stale row for a removed section — ignore, never crash
        map[key].enabled = !!row.enabled;
        if (key === row.section_key) map[key].sort_order = row.sort_order;
      }
    }
  } catch (e) {
    // table not created yet on a very first cold request — defaults
    // (current live homepage behavior) are enough.
  }
  return Object.values(map).sort((a, b) => a.sort_order - b.sort_order);
}

// Every defined section (enabled or not), sorted — for the admin builder UI.
export async function getAllHomepageSections(env) {
  const now = Date.now();
  if (cache && (now - cache.loadedAt) < TTL_MS) return cache.sections;
  const sections = await loadFromDb(env);
  cache = { sections, loadedAt: now };
  return sections;
}

// Only ENABLED sections, sorted — home.js iterates this directly to
// decide what to render and in what order.
export async function getEnabledHomepageSections(env) {
  return (await getAllHomepageSections(env)).filter(s => s.enabled);
}

export async function setHomepageSectionEnabled(env, key, enabled) {
  const def = HOMEPAGE_SECTION_DEFS.find(s => s.key === key);
  if (!def) throw new Error(`Unknown homepage section: ${key}`);
  // Validation & Safety: required sections (hero, job_listing) can never
  // be disabled — enforced HERE, at the data layer, not just hidden in
  // the admin UI, so a forged/replayed request can't bypass it and
  // "brick" the homepage down to nothing.
  const finalEnabled = def.required ? true : !!enabled;
  const current = await getAllHomepageSections(env);
  const existing = current.find(s => s.key === key);
  await env.DB.prepare(
    `INSERT INTO homepage_sections (section_key, enabled, sort_order) VALUES (?, ?, ?)
     ON CONFLICT(section_key) DO UPDATE SET enabled = excluded.enabled`
  ).bind(key, finalEnabled ? 1 : 0, existing ? existing.sort_order : DEFAULT_ORDER[key]).run();
  cache = null;
}

// Swap-with-neighbor reorder — identical approach to
// lib/nav-buttons.js's moveNavButton(), for the same reason: simple,
// touch-friendly up/down buttons instead of drag-and-drop, which is far
// more reliable on mobile (see the project's own "Mobile First" rule).
export async function moveHomepageSection(env, key, direction) {
  const sections = await getAllHomepageSections(env); // already sorted
  const idx = sections.findIndex(s => s.key === key);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sections.length) return;
  const a = sections[idx], b = sections[swapIdx];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO homepage_sections (section_key, enabled, sort_order) VALUES (?, ?, ?)
       ON CONFLICT(section_key) DO UPDATE SET sort_order = excluded.sort_order`
    ).bind(a.key, a.enabled ? 1 : 0, b.sort_order),
    env.DB.prepare(
      `INSERT INTO homepage_sections (section_key, enabled, sort_order) VALUES (?, ?, ?)
       ON CONFLICT(section_key) DO UPDATE SET sort_order = excluded.sort_order`
    ).bind(b.key, b.enabled ? 1 : 0, a.sort_order),
  ]);
  cache = null;
}
