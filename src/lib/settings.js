// src/lib/settings.js
// ════════════════════════════════════════════════════════════════
// DYNAMIC SITE SETTINGS — single source of truth is Cloudflare D1
// (the `site_settings` key/value table, see db/schema.js), NOT
// hardcoded JS constants. This is the foundation the admin "Settings"
// page (pages/admin/settings.js) writes to, and every public page
// reads from — so changing the site name, tagline, social links, or
// turning on maintenance mode NEVER requires editing a file or
// redeploying the Worker.
//
// Every key has a hardcoded fallback in DEFAULTS below, so a brand
// new/empty database (or a transient D1 error) never breaks
// rendering — the site always has a sane value to fall back to, even
// before an admin ever opens /admin/settings for the first time.
//
// PERFORMANCE: settings are read on nearly every request (site name,
// GA id, maintenance flag...). A D1 round-trip per request for values
// that rarely change would be wasteful — the same problem ensureTable()
// solved for schema checks (see db/schema.js). Unlike that "once per
// isolate" flag, settings DO change at runtime via /admin/settings, so
// a permanent flag would never pick up a save until the isolate
// recycled. This uses a short-TTL (60s) in-memory cache per Worker
// isolate instead: fast enough that a saved change goes live almost
// immediately on the isolate that served the save, cheap enough that
// it doesn't add a D1 query to every single request, and a forced
// cache-clear on every write (see setSettings) makes the save feel
// instant on that same isolate while other isolates catch up within
// the 60s window.
// ════════════════════════════════════════════════════════════════

export const SETTINGS_DEFAULTS = {
  site_name: 'JobForion',
  site_tagline: 'Find Your Next Remote Job',
  site_description: 'JobForion is a curated remote job board with verified positions in development, design, marketing, data and more. Updated every few hours.',
  contact_email: 'hello@jobforion.dev',
  social_twitter: '',
  social_linkedin: '',
  social_facebook: '',
  ga_measurement_id: 'G-NQJM1B95TS',
  maintenance_mode: '0',
  maintenance_message: 'JobForion is currently undergoing scheduled maintenance. We will be back online shortly — thank you for your patience.',
  ads_enabled: '1',
  // Sync warm-up governor (see db/sync.js) — protects the site from a mass
  // job dump the first time sources are added. While total jobs in D1 stay
  // below `sync_warmup_threshold`, each provider is capped at
  // `sync_warmup_cap_per_provider` new jobs per run; `sync_hard_cap_per_provider`
  // stays in effect permanently as a general per-run ceiling.
  sync_warmup_threshold: '150',
  sync_warmup_cap_per_provider: '15',
  sync_hard_cap_per_provider: '100',

  // ── HOT PAY — high-salary job indicator ─────────────────────────────
  // The threshold is stored as annual USD after the shared salary parser
  // normalizes salary_min_usd/salary_max_usd at sync/backfill time.
  hot_pay_enabled: '1',
  hot_pay_threshold_usd: '150000',

  // ── AI Foundation (Phase 12.1) ───────────────────────────────────
  // The binding/model remain code/config controlled; this switch provides
  // the minimum safe runtime kill-switch without exposing AI to the browser.
  ai_enabled: '1',

  // ── Hero section customization (homepage) ─────────────────────────
  // Every field here is rendered by pages/home.js's hero block. Colors
  // are plain hex strings so they can feed straight into <input
  // type="color"> on the admin form without any parsing/formatting step.
  hero_title_line1: 'Find the work you love.',
  hero_title_line2: 'Anywhere in the world.',
  hero_subtitle: 'Discover flexible remote work from trusted companies, with global opportunities curated for the way you want to work.',
  hero_gradient_start: '#2563EB',
  hero_gradient_mid: '#1D4ED8',
  hero_gradient_end: '#1E3A8A',
  hero_search_placeholder: 'Job title, skill, or company...',
  hero_search_button_text: 'Search Jobs',
  hero_search_button_color: '#FF5C7A',
  // One of the curated options in HERO_FONT_OPTIONS below — anything else
  // silently falls back to the first option, so a bad/stale value can
  // never break the Google Fonts <link> or leave the heading unstyled.
  hero_heading_font: 'Plus Jakarta Sans',

  // ── Feature Flags (Admin Dashboard V2 — Phase 1 + 2 + 3) ───────────
  // Same '1'/'0' convention as ads_enabled/maintenance_mode above. As of
  // Phase 3, every flag below has real route/render-level enforcement —
  // none are placeholders anymore:
  //   feature_blog            → index.js 404s /blog and /blog/:id when off
  //   feature_job_alerts      → /api/subscribe returns a disabled message when off
  //   feature_company_pages   → seo-pages.router.js 404s /companies* when off
  //   feature_country_pages   → seo-pages.router.js 404s /countries* when off
  //   feature_skill_pages     → seo-pages.router.js 404s /skills* when off
  //   feature_featured_jobs   → admin pin/unpin blocked server-side AND the
  //                             "Pinned" badge + blue tint hidden everywhere
  //                             jobCardSSR renders (home, job detail,
  //                             directory pages, both SSR and client JS)
  feature_blog: '1',
  feature_job_alerts: '1',
  feature_company_pages: '1',
  feature_country_pages: '1',
  feature_skill_pages: '1',
  feature_featured_jobs: '1',

  // ── Blog Automation (Data-Driven Blog System — no AI) ──────────────
  // Read by src/lib/blog-automation/* and written from
  // /admin/blog-automation (see routes/admin/blog-automation.router.js).
  // Every value here is a plain string (same '1'/'0' convention as the
  // feature flags above) so it round-trips through D1's site_settings
  // key/value table and HTML form fields with zero parsing surprises.

  // General
  blog_auto_enabled: '1',
  blog_auto_articles_per_week: '4',
  blog_auto_publish: '1',           // '1' = publish immediately, '0' = save as draft for manual review
  blog_auto_lifetime_days: '45',
  blog_auto_delete: '1',            // global auto-expiration kill switch
  blog_auto_min_jobs: '3',          // minimum jobs a topic needs before it's eligible at all

  // Schedule — days are JS getUTCDay() values, comma-separated
  // (0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat). Default: Sun/Tue/Thu/Sat.
  blog_auto_schedule_days: '0,2,4,6',
  blog_auto_schedule_hour: '9',     // UTC hour the daily generation cron checks against (informational — the cron itself is fixed in wrangler.toml)
  blog_auto_timezone_label: 'UTC',  // display-only label shown in the admin UI

  // Topics — one toggle per template in src/lib/blog-automation/templates/
  blog_auto_topics_category: '1',
  blog_auto_topics_skill: '1',
  blog_auto_topics_country: '1',
  blog_auto_topics_company: '1',
  blog_auto_topics_salary: '1',
  blog_auto_topics_trends: '1',
  blog_auto_topics_weekly: '1',

  // Content
  blog_auto_min_content_length: '600',   // words
  blog_auto_max_content_length: '2200',  // words
  blog_auto_jobs_per_article: '8',
  blog_auto_companies_per_article: '6',
  blog_auto_duplicate_cooldown_days: '21',
};

// Curated so the admin picker is a safe dropdown, never free text — a
// mistyped font name would silently fall back to the browser default with
// no visible error. Each entry is exactly what's needed to build both the
// Google Fonts URL and the CSS font-family declaration.
export const HERO_FONT_OPTIONS = [
  { name: 'Plus Jakarta Sans', googleParam: 'Plus+Jakarta+Sans:wght@700;800' },
  { name: 'Space Grotesk', googleParam: 'Space+Grotesk:wght@700;800' },
  { name: 'Poppins', googleParam: 'Poppins:wght@700;800' },
  { name: 'Inter', googleParam: 'Inter:wght@700;800' },
  { name: 'Sora', googleParam: 'Sora:wght@700;800' },
  { name: 'Manrope', googleParam: 'Manrope:wght@700;800' },
  { name: 'Outfit', googleParam: 'Outfit:wght@700;800' },
];

// Keys the general Settings form is allowed to write. Kept as an
// explicit allow-list (rather than accepting any posted field name) so
// a future admin-page bug or malicious form submission can't smuggle
// arbitrary keys into the table.
export const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS);

// Subset of SETTINGS_KEYS that render as HTML checkboxes (maintenance_mode
// + every feature_* flag). Checkboxes are only present in form-encoded
// POST bodies when CHECKED — an unchecked box simply isn't submitted at
// all — so these need `form.get(key) ? '1' : '0'` in the update handler
// instead of the `if (form.has(key))` pattern used for text fields.
// Centralized here (rather than hardcoded in admin.router.js) so a new
// checkbox-style setting only needs to be added to this one list.
export const CHECKBOX_SETTINGS_KEYS = [
  'maintenance_mode',
  'feature_blog',
  'feature_job_alerts',
  'feature_company_pages',
  'feature_country_pages',
  'feature_skill_pages',
  'feature_featured_jobs',
  'hot_pay_enabled',
  'ai_enabled',
  'blog_auto_enabled',
  'blog_auto_publish',
  'blog_auto_delete',
  'blog_auto_topics_category',
  'blog_auto_topics_skill',
  'blog_auto_topics_country',
  'blog_auto_topics_company',
  'blog_auto_topics_salary',
  'blog_auto_topics_trends',
  'blog_auto_topics_weekly',
];

// Weekday options for the Blog Automation schedule form — value matches
// JS Date#getUTCDay() so isTodayScheduledDay() in generator.js can compare
// directly with zero translation.
export const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' }, { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const TTL_MS = 60000;
let cache = null; // { values: {...}, loadedAt: number }

async function loadFromDb(env) {
  const values = { ...SETTINGS_DEFAULTS };
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM site_settings').all();
    for (const row of results || []) {
      if (row.value !== null && row.value !== undefined) values[row.key] = row.value;
    }
  } catch (e) {
    // Table may not exist yet on a very first cold request before
    // ensureTable() has run — defaults above are enough to render.
  }
  return values;
}

// Returns the full resolved settings object (DB values merged over
// DEFAULTS). Safe to call on every request.
export async function getSettings(env) {
  const now = Date.now();
  if (cache && (now - cache.loadedAt) < TTL_MS) return cache.values;
  const values = await loadFromDb(env);
  cache = { values, loadedAt: now };
  return values;
}

export async function getSetting(env, key) {
  const all = await getSettings(env);
  return all[key] ?? SETTINGS_DEFAULTS[key] ?? '';
}

// Bulk upsert. Only keys present in SETTINGS_KEYS are written — anything
// else in `updates` is silently ignored (defense in depth, see note above).
export async function setSettings(env, updates) {
  const entries = Object.entries(updates).filter(([k]) => SETTINGS_KEYS.includes(k));
  if (!entries.length) return;
  const stmts = entries.map(([k, v]) =>
    env.DB.prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    ).bind(k, String(v))
  );
  await env.DB.batch(stmts);
  cache = null; // force a fresh read on this isolate's next getSettings() call
}
