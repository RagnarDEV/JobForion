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

export const APPEARANCE_DEFAULTS = {
  appearance_primary_color: '#6339E6',
  appearance_secondary_color: '#4F2BD0',
  appearance_accent_color: '#54C4D2',
  appearance_page_background: '#FFFFFF',
  appearance_surface: '#FFFFFF',
  appearance_elevated_surface: '#F8F7FC',
  appearance_text_primary: '#181632',
  appearance_text_secondary: '#45415E',
  appearance_text_muted: '#7D798F',
  appearance_border_color: '#ECEAF2',
  appearance_radius: '12',
  appearance_container_width: '1150',
  appearance_section_spacing: '46',
  appearance_card_gap: '14',
  appearance_density: 'comfortable',
  appearance_font_family: 'Manrope',
  appearance_heading_font: 'Space Grotesk',
};

export const COMPONENT_DEFAULTS = {
  company_card_radius: '14',
  company_card_padding: '17',
  company_card_logo_size: '52',
  company_card_gap: '14',
  company_card_shadow: 'soft',
  company_card_hover: 'lift',
  nav_logo_size: '31',
  nav_header_height: '72',
  nav_gap: '28',
  nav_cta_text: 'Post a job',
  nav_cta_enabled: '1',
};

export const HOMEPAGE_COPY_DEFAULTS = {
  homepage_featured_title: 'Top companies hiring now',
  homepage_categories_title: 'Browse by category',
  homepage_jobs_eyebrow: 'FRESH FOR YOU',
  homepage_jobs_title: 'Latest job opportunities',
  homepage_jobs_cta: 'View all jobs',
  homepage_alerts_title: 'Job alerts',
  homepage_alerts_text: 'Get new roles in your inbox. Set a clear search once and stay in the loop.',
  homepage_alerts_cta: 'Create alert',
  homepage_career_title: 'Boost your career',
  homepage_career_text: 'Build a profile that helps the right companies find you.',
  homepage_career_cta: 'Complete profile',
  homepage_resources_title: 'Career resources',
  homepage_blog_title: 'Career tips and insights',
  homepage_blog_cta: 'View all articles',
};

export const THEME_DEFAULTS = Object.freeze({ ...APPEARANCE_DEFAULTS, ...COMPONENT_DEFAULTS });

export const THEME_SETTING_METADATA = Object.freeze({
  appearance_primary_color: { type: 'color', category: 'appearance', description: 'Primary brand color' },
  appearance_secondary_color: { type: 'color', category: 'appearance', description: 'Secondary brand color' },
  appearance_accent_color: { type: 'color', category: 'appearance', description: 'Accent color' },
  appearance_page_background: { type: 'color', category: 'appearance', description: 'Public page background' },
  appearance_surface: { type: 'color', category: 'appearance', description: 'Surface color' },
  appearance_elevated_surface: { type: 'color', category: 'appearance', description: 'Elevated surface color' },
  appearance_text_primary: { type: 'color', category: 'appearance', description: 'Primary text color' },
  appearance_text_secondary: { type: 'color', category: 'appearance', description: 'Secondary text color' },
  appearance_text_muted: { type: 'color', category: 'appearance', description: 'Muted text color' },
  appearance_border_color: { type: 'color', category: 'appearance', description: 'Border color' },
  appearance_radius: { type: 'integer', min: 6, max: 24, category: 'layout', description: 'Base component radius' },
  appearance_container_width: { type: 'integer', min: 960, max: 1440, category: 'layout', description: 'Public content width in pixels' },
  appearance_section_spacing: { type: 'integer', min: 20, max: 96, category: 'layout', description: 'Section spacing in pixels' },
  appearance_card_gap: { type: 'integer', min: 6, max: 32, category: 'layout', description: 'Card grid gap in pixels' },
  appearance_density: { type: 'enum', values: ['compact', 'comfortable', 'spacious'], category: 'layout', description: 'Public layout density' },
  appearance_font_family: { type: 'font', values: ['Manrope', 'Inter', 'Plus Jakarta Sans', 'Poppins'], category: 'typography', description: 'Body font family' },
  appearance_heading_font: { type: 'font', values: ['Space Grotesk', 'Plus Jakarta Sans', 'Poppins', 'Sora', 'Outfit'], category: 'typography', description: 'Heading font family' },
  company_card_radius: { type: 'integer', min: 8, max: 24, category: 'company_card', description: 'Company Card radius' },
  company_card_padding: { type: 'integer', min: 10, max: 28, category: 'company_card', description: 'Company Card padding' },
  company_card_logo_size: { type: 'integer', min: 36, max: 76, category: 'company_card', description: 'Company Card logo size' },
  company_card_gap: { type: 'integer', min: 6, max: 28, category: 'company_card', description: 'Company Card grid gap' },
  company_card_shadow: { type: 'enum', values: ['none', 'soft', 'strong'], category: 'company_card', description: 'Company Card shadow' },
  company_card_hover: { type: 'enum', values: ['none', 'lift'], category: 'company_card', description: 'Company Card hover behavior' },
  nav_logo_size: { type: 'integer', min: 24, max: 44, category: 'navigation', description: 'Navigation logo size' },
  nav_header_height: { type: 'integer', min: 56, max: 88, category: 'navigation', description: 'Navigation header height' },
  nav_gap: { type: 'integer', min: 8, max: 48, category: 'navigation', description: 'Navigation spacing' },
  nav_cta_text: { type: 'text', max: 40, category: 'navigation', description: 'Navigation CTA label' },
  nav_cta_enabled: { type: 'boolean', category: 'navigation', description: 'Show navigation CTA' },
  ai_foundation_smoke_enabled: { type: 'boolean', category: 'ai', description: 'Enable foundation smoke test' },
  ai_job_intelligence_enabled: { type: 'boolean', category: 'ai', description: 'Enable job intelligence' },
  ai_matching_enabled: { type: 'boolean', category: 'ai', description: 'Enable user matching' },
  ai_career_assistant_enabled: { type: 'boolean', category: 'ai', description: 'Enable career assistant' },
  ai_content_intelligence_enabled: { type: 'boolean', category: 'ai', description: 'Enable content intelligence' },
  ai_admin_assistant_enabled: { type: 'boolean', category: 'ai', description: 'Enable admin assistant' },
  ...Object.fromEntries(Object.keys(HOMEPAGE_COPY_DEFAULTS).map(key => [key, { type: 'text', max: 140, category: 'homepage', description: 'Homepage copy' }])),
});

export const SETTINGS_DEFAULTS = {
  ...THEME_DEFAULTS,
  ...HOMEPAGE_COPY_DEFAULTS,
  site_name: 'JobForion',
  site_tagline: 'Find Your Next Remote Job',
  site_description: 'JobForion is a curated remote job board with verified positions in development, design, marketing, data and more. Updated every few hours.',
  contact_email: 'hello@jobforion.dev',
  social_twitter: '',
  social_linkedin: '',
  social_facebook: '',
  ga_measurement_id: 'G-NQJM1B95TS',
  seo_indexing_enabled: '1',
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
  ai_foundation_smoke_enabled: '1',
  ai_job_intelligence_enabled: '1',
  ai_matching_enabled: '1',
  ai_career_assistant_enabled: '1',
  ai_content_intelligence_enabled: '1',
  ai_admin_assistant_enabled: '1',

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
export const THEME_SETTING_KEYS = Object.keys(THEME_DEFAULTS);

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const FONT_VALUES = new Set(['Manrope', 'Inter', 'Plus Jakarta Sans', 'Poppins', 'Space Grotesk', 'Sora', 'Outfit']);
const DENSITY_VALUES = new Set(['compact', 'comfortable', 'spacious']);

function boundedInteger(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function resolveTheme(settings = {}) {
  const source = { ...THEME_DEFAULTS, ...settings };
  const color = (key) => HEX_PATTERN.test(String(source[key] || '')) ? String(source[key]).toUpperCase() : THEME_DEFAULTS[key];
  const font = (key) => FONT_VALUES.has(String(source[key] || '')) ? String(source[key]) : THEME_DEFAULTS[key];
  const density = DENSITY_VALUES.has(String(source.appearance_density || '')) ? String(source.appearance_density) : THEME_DEFAULTS.appearance_density;
  return {
    primary: color('appearance_primary_color'), secondary: color('appearance_secondary_color'), accent: color('appearance_accent_color'),
    pageBackground: color('appearance_page_background'), surface: color('appearance_surface'), elevatedSurface: color('appearance_elevated_surface'),
    textPrimary: color('appearance_text_primary'), textSecondary: color('appearance_text_secondary'), textMuted: color('appearance_text_muted'),
    border: color('appearance_border_color'), radius: boundedInteger(source.appearance_radius, 12, 6, 24),
    containerWidth: boundedInteger(source.appearance_container_width, 1150, 960, 1440),
    sectionSpacing: boundedInteger(source.appearance_section_spacing, 46, 20, 96),
    cardGap: boundedInteger(source.appearance_card_gap, 14, 6, 32), density,
    fontFamily: font('appearance_font_family'), headingFont: font('appearance_heading_font'),
    companyCardRadius: boundedInteger(source.company_card_radius, 14, 8, 24),
    companyCardPadding: boundedInteger(source.company_card_padding, 17, 10, 28),
    companyCardLogoSize: boundedInteger(source.company_card_logo_size, 52, 36, 76),
    companyCardGap: boundedInteger(source.company_card_gap, 14, 6, 28),
    companyCardShadow: ['none', 'soft', 'strong'].includes(String(source.company_card_shadow)) ? String(source.company_card_shadow) : COMPONENT_DEFAULTS.company_card_shadow,
    companyCardHover: ['none', 'lift'].includes(String(source.company_card_hover)) ? String(source.company_card_hover) : COMPONENT_DEFAULTS.company_card_hover,
    navLogoSize: boundedInteger(source.nav_logo_size, 31, 24, 44),
    navHeaderHeight: boundedInteger(source.nav_header_height, 72, 56, 88),
    navGap: boundedInteger(source.nav_gap, 28, 8, 48),
    navCtaEnabled: String(source.nav_cta_enabled) !== '0',
  };
}

export function themeCssVariables(settings = {}) {
  const theme = resolveTheme(settings);
  const densityScale = theme.density === 'compact' ? 0.85 : theme.density === 'spacious' ? 1.15 : 1;
  const companyShadow = { none: 'none', soft: '0 8px 24px rgba(48,31,121,.10)', strong: '0 14px 34px rgba(48,31,121,.18)' }[theme.companyCardShadow] || '0 8px 24px rgba(48,31,121,.10)';
  const companyHoverTransform = theme.companyCardHover === 'lift' ? 'translateY(-2px)' : 'none';
  return `:root{--brand:${theme.primary};--brand2:${theme.secondary};--cyan:${theme.accent};--brand-soft:color-mix(in srgb, ${theme.primary} 10%, transparent);--bg:${theme.pageBackground};--bg2:${theme.elevatedSurface};--surface:${theme.surface};--surface2:${theme.elevatedSurface};--ink:${theme.textPrimary};--ink2:${theme.textSecondary};--ink3:${theme.textMuted};--border:${theme.border};--border2:${theme.border};--r:${theme.radius}px;--radius-sm:8px;--radius-md:${theme.radius}px;--radius-card:${Math.min(28, theme.radius + 2)}px;--container-width:${theme.containerWidth}px;--section-space:${theme.sectionSpacing}px;--card-gap:${theme.cardGap}px;--space-xs:4px;--space-sm:8px;--space-md:16px;--space-lg:24px;--space-xl:32px;--space-2xl:48px;--density-scale:${densityScale};--transition-fast:180ms;--transition-normal:240ms;--layout-header-height:${theme.navHeaderHeight}px;--nav-logo-size:${theme.navLogoSize}px;--nav-header-height:${theme.navHeaderHeight}px;--nav-gap:${theme.navGap}px;--company-card-radius:${theme.companyCardRadius}px;--company-card-padding:${theme.companyCardPadding}px;--company-card-logo-size:${theme.companyCardLogoSize}px;--company-card-gap:${theme.companyCardGap}px;--company-card-shadow:${companyShadow};--company-card-hover-transform:${companyHoverTransform};--font-body:'${theme.fontFamily}',sans-serif;--font-heading:'${theme.headingFont}',sans-serif}`;
}


// Subset of SETTINGS_KEYS that render as HTML checkboxes (maintenance_mode
// + every feature_* flag). Checkboxes are only present in form-encoded
// POST bodies when CHECKED — an unchecked box simply isn't submitted at
// all — so these need `form.get(key) ? '1' : '0'` in the update handler
// instead of the `if (form.has(key))` pattern used for text fields.
// Centralized here (rather than hardcoded in admin.router.js) so a new
// checkbox-style setting only needs to be added to this one list.
export const CHECKBOX_SETTINGS_KEYS = [
  'maintenance_mode',
  'seo_indexing_enabled',
  'feature_blog',
  'feature_job_alerts',
  'feature_company_pages',
  'feature_country_pages',
  'feature_skill_pages',
  'feature_featured_jobs',
  'hot_pay_enabled',
  'ai_enabled',
  'ai_foundation_smoke_enabled',
  'ai_job_intelligence_enabled',
  'ai_matching_enabled',
  'ai_career_assistant_enabled',
  'ai_content_intelligence_enabled',
  'ai_admin_assistant_enabled',
  'company_card_shadow',
  'company_card_hover',
  'nav_cta_enabled',
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

function sanitizeSettingValue(key, value) {
  const raw = String(value ?? '').trim();
  const meta = THEME_SETTING_METADATA[key];
  if (!meta) return raw.slice(0, 2000);
  if (meta.type === 'color') return HEX_PATTERN.test(raw) ? raw.toUpperCase() : THEME_DEFAULTS[key];
  if (meta.type === 'integer') return String(boundedInteger(raw, parseInt(THEME_DEFAULTS[key], 10), meta.min, meta.max));
  if (meta.type === 'enum') return meta.values.includes(raw) ? raw : THEME_DEFAULTS[key];
  if (meta.type === 'font') return FONT_VALUES.has(raw) ? raw : THEME_DEFAULTS[key];
  if (meta.type === 'boolean') return raw === '1' ? '1' : '0';
  if (meta.type === 'text') return raw.slice(0, meta.max || 2000);
  return THEME_DEFAULTS[key];
}

// Bulk upsert. Only keys present in SETTINGS_KEYS are written — anything
// else in `updates` is silently ignored (defense in depth, see note above).
export async function setSettings(env, updates) {
  const entries = Object.entries(updates)
    .filter(([key]) => SETTINGS_KEYS.includes(key))
    .map(([key, value]) => [key, sanitizeSettingValue(key, value)]);
  if (!entries.length) return;
  const stmts = entries.map(([k, v]) =>
    env.DB.prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    ).bind(k, v)
  );
  await env.DB.batch(stmts);
  cache = null; // force a fresh read on this isolate's next getSettings() call
}
