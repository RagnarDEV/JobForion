// src/db/schema/core-tables.js
// ensureTable(): the original site tables (jobs, sync_logs, visits, settings,
// categories, blog/pages CMS, providers, analytics, monetization, ...).
// Additive only — never drops or rewrites existing data.

import { CATEGORY_META } from '../../config/constants.js';
import { STATIC_PAGES } from '../../data/static-content.js';
import { BLOG_POSTS } from '../../data/blog-posts.js';
import { slugify } from '../../lib/directory/entities.js';
import { schemaState } from './state.js';
import { ensureColumn } from './migration-kit.js';

// PERFORMANCE: ensureTable() used to run its full set of CREATE TABLE +
// PRAGMA-based column checks (17 D1 round-trips) on EVERY single request to
// the entire site — including /sitemap.xml, which made an already-slow
// endpoint even slower. The schema only actually changes across a
// deployment, not between requests, so this in-memory flag makes the real
// checks run once per Worker isolate (isolates are reused across many
// requests) instead of once per request. A fresh isolate (cold start, or
// after a new deploy) simply re-runs the cheap idempotent checks once —
// still fully self-healing, just no longer wastefully repeated.
// (NOTE: this in-memory-only guarantee is now backed up by the persisted
// SCHEMA_VERSION gate above — see ensureAllSchema() at the bottom of this
// file, which is what index.js actually calls.)

export async function ensureTable(env) {
  // FIX (phase 1): during a resumable migration (env.__migCtx present) the
  // module-level flag MUST be ignored. Unit positions are counted from the
  // start of every migration run; if a warm isolate short-circuits here the
  // positions shift and the persisted cursor silently skips units that never
  // ran (tables missing while the schema is marked complete).
  if (schemaState.core && !env.__migCtx) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      title TEXT, company TEXT, location TEXT,
      url TEXT UNIQUE, description TEXT,
      salary TEXT, remote_type TEXT, skills TEXT,
      seniority TEXT, employment_type TEXT,
      job_handle TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE, keywords TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inserted INTEGER, skipped INTEGER, errors TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  // Per-provider breakdown (provider name, jobs inserted, duration) for
  // each sync run — added for the multi-provider architecture.
  await ensureColumn(env, 'sync_logs', 'details', 'TEXT');
  // Some historical deployments of this table predate `created_at` (which
  // is why timestamps showed as "Invalid Date" in the dashboard — the
  // column simply wasn't there for SELECT * to return).
  await ensureColumn(env, 'sync_logs', 'created_at', 'DATETIME');
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT, referrer TEXT, country TEXT, ua TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS api_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT, api_key TEXT, active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  // Migration safety net: if api_sources already existed with an older
  // schema (missing one or more of these columns), add whatever is missing
  // without touching existing rows.
  await ensureColumn(env, 'api_sources', 'label', 'TEXT');
  await ensureColumn(env, 'api_sources', 'api_key', 'TEXT');
  await ensureColumn(env, 'api_sources', 'active', 'INTEGER DEFAULT 1');
  await ensureColumn(env, 'api_sources', 'created_at', 'DATETIME');
  // Some earlier deployments created this table with a `name` column
  // (NOT NULL, no default) instead of `label`. We can't drop a NOT NULL
  // constraint in SQLite without recreating the table, so instead we keep
  // `name` around and always write the same value into both columns —
  // see the INSERT in admin.router.js.
  await ensureColumn(env, 'api_sources', 'name', 'TEXT');
  // `provider` tells syncJobs() which fetch/mapping logic to use for this
  // source. Every current provider (see src/providers/index.js) is a
  // per-company/tenant ATS board — Greenhouse, Lever, Ashby,
  // SmartRecruiters, Workable, Teamtailor, Recruitee, Workday, iCIMS.
  await ensureColumn(env, 'api_sources', 'provider', "TEXT DEFAULT 'greenhouse'");

  // ── Providers Improvements (Stage 6) — persisted per-source health ──
  // Previously "is this provider healthy?" had to be RE-DERIVED on every
  // dashboard load by scanning the latest sync_logs row's `details` JSON
  // for this provider's name — which only ever reflected the SINGLE most
  // recent sync run, with no memory of a genuinely failing source vs one
  // that had one bad run. These columns are written directly by
  // db/sync.js after every attempt (success or failure) for every source,
  // giving each one its own persistent, queryable history.
  await ensureColumn(env, 'api_sources', 'last_synced_at', 'DATETIME');
  await ensureColumn(env, 'api_sources', 'last_success_at', 'DATETIME');
  await ensureColumn(env, 'api_sources', 'last_error', 'TEXT');
  // Machine-readable classification of last_error (see classifyError() in
  // db/sync.js) — RATE_LIMITED / UNAUTHORIZED / NOT_FOUND / SERVER_ERROR /
  // NETWORK_ERROR / TIMEOUT / INVALID_RESPONSE / UNKNOWN. Lets the admin
  // UI show a distinct "Rate Limited" badge instead of a generic "Failed"
  // one, without re-parsing the error message string every render.
  await ensureColumn(env, 'api_sources', 'last_error_type', 'TEXT');
  // Resets to 0 on every success; only a source with 3+ CONSECUTIVE
  // failures is shown as genuinely "Failed" in the admin UI — a single
  // transient blip on an otherwise-healthy source shouldn't read the same
  // as one that's been broken for days (plan §3's Active/Failed
  // distinction).
  await ensureColumn(env, 'api_sources', 'consecutive_failures', 'INTEGER DEFAULT 0');

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS job_postings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, company TEXT, email TEXT, url TEXT,
      location TEXT, category TEXT, employment_type TEXT,
      remote_type TEXT, salary TEXT, description TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Phase 2 (Admin: Job Management) — manual "pin to top" flag, independent
  // of the automatic salary-based "Hot" badge already used on the public site.
  await ensureColumn(env, 'jobs', 'featured', 'INTEGER DEFAULT 0');

  // Phase 2 (Admin: Company Management) — there is no separate `companies`
  // table (companies are just a text column on `jobs`), so "hide a company"
  // is modeled as a small exclusion list rather than a company record.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS hidden_companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_lower TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Legacy/admin-managed logos for provider-only company names. The real
  // `companies.logo_url` column remains authoritative for active company
  // profiles; this table is the existing compatibility path used when a
  // provider job has no linked companies row yet.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS company_logos (
      company_lower TEXT PRIMARY KEY,
      logo_url TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ── Job Lifecycle Management ──────────────────────────────────
  // updated_at: bumped on every successful sync touch (new insert OR
  // refresh of an existing row) — this is what "not updated in 30 days"
  // cleanup keys off, not created_at, so a job that's still present at the
  // source keeps getting its clock reset indefinitely.
  await ensureColumn(env, 'jobs', 'updated_at', 'DATETIME');
  // expires_at: none of the 9 providers send a real expiry date, so this
  // is computed by us at insert time (created_at + 45 days) as a
  // best-effort default rather than authoritative source data.
  await ensureColumn(env, 'jobs', 'expires_at', 'DATETIME');
  // source: which provider this job came from (greenhouse, lever, ashby,
  // smartrecruiters, workable, teamtailor, recruitee, workday, icims) —
  // lets the stats dashboard and cleanup logic reason per-provider.
  await ensureColumn(env, 'jobs', 'source', 'TEXT');
  // status: 'active' | 'expired' | 'deleted'. Rows are only ever hard-deleted
  // by the daily cleanup cron; this column exists so a job disappearing
  // from the public site (status != 'active') and a job being physically
  // removed from D1 are two independently reasoned-about steps.
  await ensureColumn(env, 'jobs', 'status', "TEXT DEFAULT 'active'");

  // ── Job Type tiers (Free / Featured / Premium / Sponsored) ──────
  // Monetization display tier — separate from the existing `featured`
  // boolean above (that one is a simple admin "pin to top" toggle used
  // within a tier; this is the paid-tier system requested for the
  // Free/Featured/Premium/Sponsored badge + ordering feature). Both are
  // kept: sort order uses job_type as the primary key and the old
  // `featured` flag as a secondary tiebreaker within each tier, so
  // existing pinned jobs keep working exactly as before.
  //
  // DEFAULT 'Free' applies to every row retroactively the moment this
  // column is added (SQLite backfills ALTER TABLE ADD COLUMN...DEFAULT
  // immediately), so no separate UPDATE/backfill step is needed for
  // existing jobs.
  await ensureColumn(env, 'jobs', 'job_type', "TEXT DEFAULT 'Free'");
  // Optional short one-liner shown for higher tiers (e.g. Sponsored's
  // "Sponsored Company" blurb) — nullable, rendered only when present.
  // Admin-editable; not tied to any specific tier at the schema level so
  // it stays reusable if future tiers want the same treatment.
  await ensureColumn(env, 'jobs', 'job_type_note', 'TEXT');

  // BUG FIX (found during audit): db/sync.js has written to
  // jobs.salary_min_usd / jobs.salary_max_usd since lib/jobs/salary.js was
  // introduced (see the INSERT/UPDATE statements in db/sync.js, and the
  // backfill query in the same file), and pages/admin/jobs.js +
  // pages/admin/system.js both already SELECT the column — but no
  // migration ever actually created it. Every job sync and salary
  // backfill run was silently failing with "D1_ERROR: table jobs has no
  // column named salary_min_usd" until this line existed. Safe to add
  // retroactively: existing rows simply backfill NULL, which
  // db/sync.js's salary-backfill pass (see backfillSalaryUsd) already
  // handles by design.
  await ensureColumn(env, 'jobs', 'salary_min_usd', 'INTEGER');
  await ensureColumn(env, 'jobs', 'salary_max_usd', 'INTEGER');
  // Salary Tier classification is derived centrally from the normalized annual
  // USD values. Existing rows start as UNKNOWN until the bounded admin
  // backfill runs; no job or unrelated field is deleted or rewritten.
  await ensureColumn(env, 'jobs', 'salary_tier', 'TEXT');
  await ensureColumn(env, 'jobs', 'salary_tier_confidence', 'TEXT');

  // Daily cleanup run history — mirrors sync_logs's shape so the future
  // stats dashboard can reuse the same rendering pattern for both.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS cleanup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deleted INTEGER, reason_breakdown TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Backs lib/platform/rate-limit.js — coarse, best-effort per-key (e.g. per-IP,
  // per-endpoint) request counting to deter spam on public write
  // endpoints (/api/subscribe, /api/post-job). See that file for details.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      rl_key TEXT PRIMARY KEY,
      count INTEGER DEFAULT 1,
      window_start DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ── Homepage Sections Builder (Admin Dashboard V2, Phase 4) ────────
  // The original table mirrors ad_slots: a FIXED set of section keys defined
  // in code (see lib/content/homepage-sections.js), with admin-controlled visibility
  // and order. Missing rows mean "use the default" so a fresh install keeps
  // the original homepage. Admin-created code sections live in the separate
  // homepage_custom_sections table below and never alter these built-ins.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS homepage_sections (
      section_key TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    )
  `).run();
  await ensureColumn(env, 'homepage_sections', 'custom_html', 'TEXT');
  await ensureColumn(env, 'homepage_sections', 'custom_css', 'TEXT');
  await ensureColumn(env, 'homepage_sections', 'custom_js', 'TEXT');

  // Custom Homepage Sections — admin-created blocks live in their own
  // additive table so the original fixed homepage_sections primary key and
  // ordering behavior remain backwards compatible. Custom code is rendered
  // in the same opaque-origin sandboxed iframe used by the Pages CMS.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS homepage_custom_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      custom_html TEXT DEFAULT '',
      custom_css TEXT DEFAULT '',
      custom_js TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ── Admin Activity Log ────────────────────────────────────────────
  // Backs lib/platform/activity-log.js — WHO changed WHAT and WHEN across the admin
  // panel (login attempts, job deletions, settings changes, source
  // add/remove, ...). Powers the Dashboard's "Recent Activity" panel and
  // the full log at /admin/security. Purely additive/append-only; never
  // read by any business logic, so it can never change site behavior —
  // it exists solely for the admin's own visibility.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS admin_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target TEXT,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ── Dynamic Site Settings ────────────────────────────────────────
  // Backs lib/platform/settings.js. Plain key/value store — deliberately NOT a
  // fixed-column table, so adding a new admin-editable setting in the
  // future is a one-line addition to SETTINGS_DEFAULTS in settings.js,
  // never a schema migration here. See lib/platform/settings.js for the full
  // rationale (this is what lets site name, tagline, socials, GA id,
  // and maintenance mode be edited from /admin/settings with zero
  // redeploy).
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ── Dynamic Job Categories ──────────────────────────────────────
  // Backs lib/content/categories.js. Replaces the old hardcoded CATEGORY_META
  // constant — /admin/categories can now create/edit/reorder/deactivate
  // categories with zero code edits. Seeded ONCE from the original
  // CATEGORY_META so every existing category/URL keeps working exactly
  // as before after this upgrade; INSERT OR IGNORE makes the seed
  // idempotent (safe to run on every cold isolate start).
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS categories (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      emoji TEXT,
      color TEXT,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    )
  `).run();
  const seedEntries = Object.entries(CATEGORY_META);
  if (seedEntries.length) {
    await env.DB.batch(seedEntries.map(([key, v], i) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO categories (key, label, emoji, color, sort_order, active) VALUES (?, ?, ?, ?, ?, 1)`
      ).bind(key, v.label, v.emoji, v.color, i)
    ));
  }

  // ── Directory Overrides (Countries / Cities / Skills) ────────────
  // Backs lib/directory/directory-overrides.js. Countries/cities/skills have no
  // independent existence — they're aggregated live from free-text
  // `jobs.location` / `jobs.skills` (see the NOTE at the top of
  // lib/directory/entities.js). This table lets /admin/directory rename or hide
  // an auto-detected entry (e.g. fix "CA" → "California", or hide a
  // misclassified value) without ever touching job rows.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS directory_overrides (
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      display_name TEXT,
      hidden INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (kind, name)
    )
  `).run();

  // ── CMS: Static Pages ─────────────────────────────────────────
  // Backs lib/content/pages-cms.js. Replaces the old hardcoded STATIC_PAGES
  // constant (src/data/static-content.js) — /admin/pages can now edit
  // Privacy/Terms/Disclaimer AND create brand-new pages (About, FAQ,
  // Cookie Policy, Advertise With Us, ...) at any slug, with zero code
  // edits. Seeded ONCE from STATIC_PAGES so the 3 existing pages and
  // their URLs keep working unchanged after this upgrade.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS pages (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      meta_description TEXT,
      body TEXT,
      status TEXT DEFAULT 'published',
      scheduled_at DATETIME,
      show_in_footer INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  const pageSeedEntries = Object.entries(STATIC_PAGES);
  if (pageSeedEntries.length) {
    await env.DB.batch(pageSeedEntries.map(([slug, p], i) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO pages (slug, title, meta_description, body, status, show_in_footer, sort_order) VALUES (?, ?, ?, ?, 'published', 1, ?)`
      ).bind(slug, p.title, p.description, p.body, i)
    ));
  }
  // Independent of show_in_footer — a page can appear in the footer, the
  // site's mobile/nav menu, both, or neither. Defaults to 0 (off) so
  // existing pages don't suddenly appear in the menu unannounced; an
  // admin opts each one in explicitly from /admin/pages.
  await ensureColumn(env, 'pages', 'show_in_menu', 'INTEGER DEFAULT 0');
  // Optional isolated code blocks for CMS pages. Existing body content remains
  // unchanged; these additive columns let New Page store HTML/CSS/JS separately.
  await ensureColumn(env, 'pages', 'custom_html', 'TEXT');
  await ensureColumn(env, 'pages', 'custom_css', 'TEXT');
  await ensureColumn(env, 'pages', 'custom_js', 'TEXT');

  // ── Custom menu buttons (see lib/content/nav-buttons.js) ──────────────────
  // Arbitrary extra links/buttons for the site's mobile menu (and desktop
  // nav) — label, destination, emoji icon, and a per-button color, fully
  // admin-managed from /admin/pages without any code edit or redeploy.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS nav_buttons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      icon TEXT DEFAULT '🔗',
      color TEXT DEFAULT '#2563EB',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ── CMS: Blog ─────────────────────────────────────────────────
  // Backs lib/content/blog-cms.js. Replaces the old hardcoded BLOG_POSTS
  // constant (src/data/blog-posts.js). `id` keeps the same 1..6
  // AUTOINCREMENT-compatible numbering the static array used, so every
  // existing /blog/1 .. /blog/6 URL (already indexed/shared) keeps
  // resolving unchanged — see routes/pages.router.js, which looks posts
  // up by id OR slug.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE,
      title TEXT NOT NULL,
      excerpt TEXT,
      body TEXT,
      category TEXT,
      tags TEXT DEFAULT '[]',
      cover_image_url TEXT,
      status TEXT DEFAULT 'published',
      scheduled_at DATETIME,
      read_time TEXT,
      published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  if (BLOG_POSTS.length) {
    await env.DB.batch(BLOG_POSTS.map(p =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO blog_posts (id, slug, title, excerpt, body, category, read_time, status, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?)`
      ).bind(p.id, slugify(p.title), p.title, p.excerpt, p.body, p.cat, p.readTime, p.date)
    ));
  }

  // ── Blog Automation (Data-Driven Blog System, no AI) ───────────────
  // Extends the blog_posts table above with everything
  // src/lib/blog-automation/* needs, additively — every column here is
  // nullable/defaulted, so the existing manual Blog CMS (lib/content/blog-cms.js,
  // routes/admin/content.router.js) keeps working completely unchanged
  // for every post that isn't auto-generated (auto_generated defaults to
  // 0 for every pre-existing and every manually-created row).
  await ensureColumn(env, 'blog_posts', 'created_at', 'DATETIME');
  await ensureColumn(env, 'blog_posts', 'seo_title', 'TEXT');
  await ensureColumn(env, 'blog_posts', 'seo_description', 'TEXT');
  await ensureColumn(env, 'blog_posts', 'canonical_url', 'TEXT');
  // auto_generated: 0 for every hand-written post (manual Blog CMS) and
  // every seeded legacy post above; 1 only for posts created by
  // lib/content/blog-cms.js's createAutoPost() (see generator.js).
  await ensureColumn(env, 'blog_posts', 'auto_generated', 'INTEGER DEFAULT 0');
  // auto_expire: whether THIS post is subject to the 45-day (configurable)
  // lifecycle. Independent of auto_generated so an admin can "pin" a
  // specific auto-generated article as permanent from /admin/blog without
  // it losing its auto_generated=1 provenance flag.
  await ensureColumn(env, 'blog_posts', 'auto_expire', 'INTEGER DEFAULT 0');
  // expires_at: computed as published_at + lifetime_days at PUBLISH time
  // (see createAutoPost in lib/content/blog-cms.js) — recomputed if a scheduled
  // post is later actually published, never derived from created_at.
  await ensureColumn(env, 'blog_posts', 'expires_at', 'DATETIME');
  // source_type: which template generated this post (category / skill /
  // country / company / salary / trends / weekly) — see
  // lib/content/blog-automation/templates/index.js. NULL for manual posts.
  await ensureColumn(env, 'blog_posts', 'source_type', 'TEXT');
  // source_data: small JSON snapshot of the exact data the article was
  // built from (topic key, job count at generation time) — kept for
  // transparency/debugging, never re-parsed by any render path.
  await ensureColumn(env, 'blog_posts', 'source_data', 'TEXT');
  // topic_key: stable identifier for WHAT this post is about (e.g.
  // "category:developer", "salary:2026-W34") — the single field
  // lib/content/blog-automation/duplicate-check.js checks to stop the same topic
  // being regenerated inside the configured cooldown window.
  await ensureColumn(env, 'blog_posts', 'topic_key', 'TEXT');

  // Generation pipeline log — every step from "generation started" through
  // "article published"/"article expired"/"generation failed" (see
  // lib/content/blog-automation/logger.js). Append-only; powers the stats cards
  // and activity feed on /admin/blog-automation. Never read by any
  // business logic other than that admin page and the 410-vs-404 slug
  // check in routes/pages.router.js, so it's safe to grow indefinitely
  // (a future cron could prune rows older than N months if desired).
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS blog_automation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ── Job Card Style Manager ────────────────────────────────────
  // Backs lib/jobs/job-card-styles.js. Per-tier (Free/Featured/Premium/
  // Sponsored) card background/border/logo-size/padding/badge colors,
  // fully admin-controlled at /admin/card-styles. Deliberately NOT
  // seeded — lib/jobs/job-card-styles.js's DEFAULT_CARD_STYLES supplies the
  // current hand-tuned look for any row that doesn't exist yet, so an
  // empty table renders identically to before this feature existed.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS job_card_styles (
      job_type TEXT PRIMARY KEY,
      bg_type TEXT DEFAULT 'solid',
      bg_color1 TEXT,
      bg_color2 TEXT,
      gradient_angle INTEGER DEFAULT 135,
      border_style TEXT DEFAULT 'solid',
      border_color TEXT,
      border_width INTEGER DEFAULT 1,
      logo_size INTEGER DEFAULT 54,
      card_padding INTEGER DEFAULT 14,
      shadow TEXT DEFAULT 'none',
            badge_bg_color TEXT,
      badge_text_color TEXT,
      template TEXT DEFAULT 'classic',
      accent_color TEXT,
      accent_position TEXT DEFAULT 'none',
      title_color TEXT,
      company_color TEXT,
      meta_color TEXT,
      salary_color TEXT,
      badge_border_color TEXT,
      badge_radius INTEGER DEFAULT 20,
      icon_key TEXT DEFAULT 'none',
      hover_effect TEXT DEFAULT 'lift',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  // Older job_card_styles tables are upgraded without touching existing rows.
  for (const [column, definition] of [
    ['template', "TEXT DEFAULT 'classic'"], ['accent_color', 'TEXT'], ['accent_position', "TEXT DEFAULT 'none'"],
    ['title_color', 'TEXT'], ['company_color', 'TEXT'], ['meta_color', 'TEXT'], ['salary_color', 'TEXT'],
    ['badge_border_color', 'TEXT'], ['badge_radius', 'INTEGER DEFAULT 20'], ['icon_key', "TEXT DEFAULT 'none'"],
    ['hover_effect', "TEXT DEFAULT 'lift'"],
  ]) await ensureColumn(env, 'job_card_styles', column, definition);
  // ── Ad Slot Manager ────────────────────────────────────────────
  // Backs lib/content/ad-slots.js. Per-slot ad embed code, enabled state, and
  // box size — /admin/ads. Deliberately NOT seeded, same reasoning as
  // job_card_styles above: lib/content/ad-slots.js's DEFAULT_AD_CONFIG (the
  // site's current live Adsterra setup) covers any row that doesn't
  // exist yet.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ad_slots (
      slot_id TEXT PRIMARY KEY,
      code TEXT,
      enabled INTEGER DEFAULT 1,
      width INTEGER,
      height INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ── Monetization domain ────────────────────────────────────────
  // Additive, provider-neutral financial records. No card data, CVV,
  // credentials, or client-supplied payment state is stored here.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monetization_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      price_minor INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      billing_model TEXT NOT NULL DEFAULT 'one_time',
      duration_days INTEGER NOT NULL DEFAULT 30,
      target_audience TEXT NOT NULL DEFAULT 'employer',
      metadata TEXT,
      display_order INTEGER NOT NULL DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_monetization_products_status_order ON monetization_products(status, display_order, id)').run();
  const defaultMonetizationProducts = [
    ['featured-job', 'Featured Job', 'Give one job a highlighted placement for a defined period.', 'featured_job', 900, 'USD', 30, 10],
    ['sponsored-job', 'Sponsored Job', 'Run a clearly labelled sponsored job campaign for a defined period.', 'sponsored_job', 1900, 'USD', 30, 20],
    ['job-boost', 'Job Boost', 'Increase visibility temporarily without bypassing search filters or relevance.', 'job_boost', 500, 'USD', 7, 30],
    ['premium-company', 'Premium Company', 'Foundation for enhanced company profile capabilities backed by an entitlement.', 'premium_company', 4900, 'USD', 30, 40],
  ];
  for (const [slug, name, description, type, price, currency, duration, displayOrder] of defaultMonetizationProducts) {
    await env.DB.prepare(`INSERT OR IGNORE INTO monetization_products (slug,name,description,type,status,price_minor,currency,billing_model,duration_days,target_audience,display_order) VALUES (?,?,?,?, 'active',?,?, 'one_time',?,'employer',?)`).bind(slug, name, description, type, price, currency, duration, displayOrder).run();
  }
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monetization_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_ref TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      company_id INTEGER,
      product_id INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_provider TEXT,
      provider_transaction_id TEXT,
      idempotency_key TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME,
      expired_at DATETIME,
      refund_reserved_minor INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, idempotency_key)
    )
  `).run();
  await ensureColumn(env, 'monetization_orders', 'refund_reserved_minor', 'INTEGER NOT NULL DEFAULT 0');
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_monetization_orders_status_created ON monetization_orders(status, created_at DESC)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_monetization_orders_company ON monetization_orders(company_id, id DESC)').run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monetization_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_reference TEXT NOT NULL UNIQUE,
      gross_amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      provider_fee_minor INTEGER,
      net_amount_minor INTEGER,
      status TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_monetization_transactions_order ON monetization_transactions(order_id, id DESC)').run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monetization_entitlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      company_id INTEGER,
      product_id INTEGER NOT NULL,
      order_id INTEGER,
      job_id INTEGER,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      starts_at DATETIME,
      ends_at DATETIME,
      source TEXT NOT NULL DEFAULT 'payment',
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_monetization_entitlements_owner ON monetization_entitlements(company_id, user_id, status, ends_at)').run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monetization_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      job_id INTEGER,
      company_id INTEGER,
      entitlement_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      starts_at DATETIME,
      ends_at DATETIME,
      budget_minor INTEGER,
      currency TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      placement TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_monetization_campaigns_active ON monetization_campaigns(status, starts_at, ends_at, priority)').run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monetization_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      transaction_id INTEGER,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested',
      reason TEXT,
      admin_user_id INTEGER,
      provider_reference TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_monetization_refunds_order ON monetization_refunds(order_id, id DESC)').run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS affiliate_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      base_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'inactive',
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id INTEGER NOT NULL,
      campaign TEXT,
      source_page TEXT,
      destination TEXT NOT NULL,
      ip_hash TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_program_created ON affiliate_clicks(program_id, created_at DESC)').run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monetization_revenue_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      order_id INTEGER,
      transaction_id INTEGER,
      product_id INTEGER,
      gross_amount_minor INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      provider_fee_minor INTEGER,
      net_amount_minor INTEGER,
      occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
    )
  `).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_monetization_revenue_events_time ON monetization_revenue_events(occurred_at DESC, event_type)').run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monetization_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      payload TEXT,
      error TEXT,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME
    )
  `).run();

  // NEW, appended at the very end on purpose: adding this at the FRONT or
  // middle of this function would shift every statement after it by one
  // position, silently invalidating any `migration_cursor` already
  // persisted in a real, still-catching-up production database (it would
  // start skipping the WRONG statements). Appending at the end keeps
  // every previously-numbered position pointing at exactly the same
  // statement it always did — only brand-new work is added past
  // whatever cursor already exists. This table is the diagnostic
  // safety net itself: index.js's top-level catch writes every
  // unhandled exception here, viewable from /admin without needing the
  // ?jf_debug= URL trick.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT, message TEXT, stack TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  schemaState.core = true;
}
