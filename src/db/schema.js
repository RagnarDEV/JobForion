// src/db/schema.js
// Table creation only — never drops or mutates existing jobs/subscribers data.
//
// UPDATE: added a safe column-migration helper. `CREATE TABLE IF NOT EXISTS`
// only helps on a brand-new database — if a table already exists with an
// older/different set of columns (as happened with api_sources missing
// `label`), it silently does nothing and later INSERTs fail with
// "D1_ERROR: table X has no column named Y". ensureColumn() checks the
// live schema via PRAGMA table_info and adds only what's missing, via
// ALTER TABLE ADD COLUMN — existing rows and data are never touched.

import { CATEGORY_META } from '../config/constants.js';
import { STATIC_PAGES } from '../data/static-content.js';
import { BLOG_POSTS } from '../data/blog-posts.js';
import { slugify } from '../lib/entities.js';

async function ensureColumn(env, table, column, definition) {
  try {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    const exists = (results || []).some(r => r.name === column);
    if (!exists) {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  } catch (e) {
    // If the table itself doesn't exist yet, CREATE TABLE IF NOT EXISTS
    // below handles it — safe to ignore here.
  }
}

// PERFORMANCE: ensureTable() used to run its full set of CREATE TABLE +
// PRAGMA-based column checks (17 D1 round-trips) on EVERY single request to
// the entire site — including /sitemap.xml, which made an already-slow
// endpoint even slower. The schema only actually changes across a
// deployment, not between requests, so this in-memory flag makes the real
// checks run once per Worker isolate (isolates are reused across many
// requests) instead of once per request. A fresh isolate (cold start, or
// after a new deploy) simply re-runs the cheap idempotent checks once —
// still fully self-healing, just no longer wastefully repeated.
let schemaEnsured = false;

export async function ensureTable(env) {
  if (schemaEnsured) return;
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
  // jobs.salary_min_usd / jobs.salary_max_usd since lib/salary.js was
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

  // Daily cleanup run history — mirrors sync_logs's shape so the future
  // stats dashboard can reuse the same rendering pattern for both.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS cleanup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deleted INTEGER, reason_breakdown TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Backs lib/rate-limit.js — coarse, best-effort per-key (e.g. per-IP,
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
  // in code (see lib/homepage-sections.js), with admin-controlled visibility
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
  // Backs lib/activity-log.js — WHO changed WHAT and WHEN across the admin
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
  // Backs lib/settings.js. Plain key/value store — deliberately NOT a
  // fixed-column table, so adding a new admin-editable setting in the
  // future is a one-line addition to SETTINGS_DEFAULTS in settings.js,
  // never a schema migration here. See lib/settings.js for the full
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
  // Backs lib/categories.js. Replaces the old hardcoded CATEGORY_META
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
  // Backs lib/directory-overrides.js. Countries/cities/skills have no
  // independent existence — they're aggregated live from free-text
  // `jobs.location` / `jobs.skills` (see the NOTE at the top of
  // lib/entities.js). This table lets /admin/directory rename or hide
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
  // Backs lib/pages-cms.js. Replaces the old hardcoded STATIC_PAGES
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

  // ── Custom menu buttons (see lib/nav-buttons.js) ──────────────────
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
  // Backs lib/blog-cms.js. Replaces the old hardcoded BLOG_POSTS
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
  // nullable/defaulted, so the existing manual Blog CMS (lib/blog-cms.js,
  // routes/admin/content.router.js) keeps working completely unchanged
  // for every post that isn't auto-generated (auto_generated defaults to
  // 0 for every pre-existing and every manually-created row).
  await ensureColumn(env, 'blog_posts', 'created_at', 'DATETIME');
  await ensureColumn(env, 'blog_posts', 'seo_title', 'TEXT');
  await ensureColumn(env, 'blog_posts', 'seo_description', 'TEXT');
  await ensureColumn(env, 'blog_posts', 'canonical_url', 'TEXT');
  // auto_generated: 0 for every hand-written post (manual Blog CMS) and
  // every seeded legacy post above; 1 only for posts created by
  // lib/blog-cms.js's createAutoPost() (see generator.js).
  await ensureColumn(env, 'blog_posts', 'auto_generated', 'INTEGER DEFAULT 0');
  // auto_expire: whether THIS post is subject to the 45-day (configurable)
  // lifecycle. Independent of auto_generated so an admin can "pin" a
  // specific auto-generated article as permanent from /admin/blog without
  // it losing its auto_generated=1 provenance flag.
  await ensureColumn(env, 'blog_posts', 'auto_expire', 'INTEGER DEFAULT 0');
  // expires_at: computed as published_at + lifetime_days at PUBLISH time
  // (see createAutoPost in lib/blog-cms.js) — recomputed if a scheduled
  // post is later actually published, never derived from created_at.
  await ensureColumn(env, 'blog_posts', 'expires_at', 'DATETIME');
  // source_type: which template generated this post (category / skill /
  // country / company / salary / trends / weekly) — see
  // lib/blog-automation/templates/index.js. NULL for manual posts.
  await ensureColumn(env, 'blog_posts', 'source_type', 'TEXT');
  // source_data: small JSON snapshot of the exact data the article was
  // built from (topic key, job count at generation time) — kept for
  // transparency/debugging, never re-parsed by any render path.
  await ensureColumn(env, 'blog_posts', 'source_data', 'TEXT');
  // topic_key: stable identifier for WHAT this post is about (e.g.
  // "category:developer", "salary:2026-W34") — the single field
  // lib/blog-automation/duplicate-check.js checks to stop the same topic
  // being regenerated inside the configured cooldown window.
  await ensureColumn(env, 'blog_posts', 'topic_key', 'TEXT');

  // Generation pipeline log — every step from "generation started" through
  // "article published"/"article expired"/"generation failed" (see
  // lib/blog-automation/logger.js). Append-only; powers the stats cards
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
  // Backs lib/job-card-styles.js. Per-tier (Free/Featured/Premium/
  // Sponsored) card background/border/logo-size/padding/badge colors,
  // fully admin-controlled at /admin/card-styles. Deliberately NOT
  // seeded — lib/job-card-styles.js's DEFAULT_CARD_STYLES supplies the
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ── Ad Slot Manager ────────────────────────────────────────────
  // Backs lib/ad-slots.js. Per-slot ad embed code, enabled state, and
  // box size — /admin/ads. Deliberately NOT seeded, same reasoning as
  // job_card_styles above: lib/ad-slots.js's DEFAULT_AD_CONFIG (the
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

  schemaEnsured = true;
}

// ── AI feature tables ─────────────────────────────────────────────
// All AI persistence is declared here, alongside the rest of the D1 schema.
// Feature modules call ensureAiTables() as a defensive no-op, but they no
// longer own separate runtime DDL definitions. This keeps the four tables,
// indexes, and lifecycle reviewable in one place without destructive changes.
let aiSchemaEnsured = false;
export async function ensureAiTables(env) {
  if (aiSchemaEnsured) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS job_intelligence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE,
      source_fingerprint TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      service_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      result_json TEXT,
      error_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_job_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      profile_fingerprint TEXT NOT NULL,
      candidate_fingerprint TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      service_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      result_json TEXT,
      error_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS career_assistant_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS career_assistant_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_career_assistant_messages_user ON career_assistant_messages(user_id, id DESC)`,
    `CREATE TABLE IF NOT EXISTS content_intelligence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_type TEXT NOT NULL,
      content_id INTEGER NOT NULL,
      source_fingerprint TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      service_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      result_json TEXT,
      error_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(content_type, content_id)
    )`,
  ];
  if (typeof env.DB.batch === 'function') await env.DB.batch(statements.map(sql => env.DB.prepare(sql)));
  else for (const sql of statements) await env.DB.prepare(sql).run();
  aiSchemaEnsured = true;
}

// ════════════════════════════════════════════════════════════════
// ACCOUNTS & IDENTITY SYSTEM (Users, Sessions, Companies, Memberships)
// ════════════════════════════════════════════════════════════════
// Deliberately a SEPARATE function from ensureTable(), called
// independently from index.js right after it. Two reasons:
//   1. Isolation — a mistake in a brand-new, larger subsystem can't take
//      down table creation for the existing job board (ensureTable's
//      early-return isolate cache means ensureTable() itself is called
//      on every request; keeping account tables here means a bug here
//      is easy to reason about/roll back without touching the proven
//      code path above).
//   2. It matches the file's own established pattern — job lifecycle
//      (Phase: Job Lifecycle Management), Blog Automation, Job Card
//      Style Manager, and Ad Slot Manager are all additive column/table
//      blocks layered onto the same ensureTable() function; the account
//      system is simply large enough (11 tables) to warrant its own
//      named function for readability, while still using the exact same
//      ensureColumn()/CREATE TABLE IF NOT EXISTS idioms as everything
//      above — so it reads as "more of the same", not a parallel system.
//
// NOTHING here ever touches admin_activity_log's cousin, the Admin
// Dashboard's own auth (auth/admin-auth.js's single ADMIN_PASSWORD
// secret + jn_admin cookie) — that system is completely untouched and
// stays the only way into /admin. This block is exclusively for public
// user accounts (job seekers) and company accounts (employers).
let accountSchemaEnsured = false;

export async function ensureAccountTables(env) {
  if (accountSchemaEnsured) return;

  // ── users ───────────────────────────────────────────────────────
  // Identity only — no profile fields here (see user_profiles below).
  // password_hash is PBKDF2-SHA256, salt+iterations encoded inline in
  // the stored string (see lib/accounts/password.js) — never a plain
  // password, never reversible.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email_verified INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending_verification',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`).run();
  // Notification Settings (Account Settings, plan §27) — a single
  // top-level toggle a user can flip to stop ALL transactional/job-alert
  // emails without deleting their alerts (lib/job-alerts-dispatcher.js
  // checks this on every dispatch run). Verification/password-reset
  // emails are always sent regardless — those are security-critical, not
  // a "notification" the user opted into.
  await ensureColumn(env, 'users', 'email_notifications_enabled', 'INTEGER DEFAULT 1');

  // ── user_profiles ───────────────────────────────────────────────
  // 1:1 with users, split out deliberately (see plan §5) so the hot,
  // frequently-read identity row (users) never carries the heavier
  // optional profile payload. skills/experience/education/languages are
  // stored as JSON arrays (same convention as jobs.skills) — structured
  // enough for future AI job-matching (plan §31) without a rigid
  // multi-table skill taxonomy today.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      full_name TEXT,
      avatar_url TEXT,
      country TEXT,
      city TEXT,
      job_title TEXT,
      bio TEXT,
      skills TEXT DEFAULT '[]',
      experience TEXT DEFAULT '[]',
      education TEXT DEFAULT '[]',
      languages TEXT DEFAULT '[]',
      linkedin_url TEXT,
      portfolio_url TEXT,
      resume_url TEXT,
      job_preferences TEXT DEFAULT '{}',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ── user_sessions ───────────────────────────────────────────────
  // id = SHA-256 hash of the random bearer token that actually lives in
  // the HttpOnly cookie (see lib/accounts/session.js) — the raw token is
  // NEVER stored, so a read of this table (backup leak, SQLi) cannot be
  // turned into a valid session by itself.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_agent TEXT,
      ip_hash TEXT
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id)`).run();

  // ── email_verifications / password_resets ──────────────────────
  // Same shape, same reasoning: token_hash only (SHA-256 of the random
  // token emailed to the user), single-use (used_at), time-limited.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id)`).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_pw_resets_user ON password_resets(user_id)`).run();

  // ── saved_jobs ──────────────────────────────────────────────────
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS saved_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, job_id)
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_saved_jobs_user ON saved_jobs(user_id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_saved_jobs_job ON saved_jobs(job_id)`).run();

  // ── job_alerts ──────────────────────────────────────────────────
  // Account-bound version of the existing anonymous `subscribers` table
  // (email + keywords only, still used as-is for non-account visitors —
  // see lib/entities.js / api.router.js's /api/subscribe, left
  // completely untouched). This is the richer, dashboard-managed version.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS job_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      keywords TEXT,
      category TEXT,
      skills TEXT,
      country TEXT,
      remote_type TEXT,
      employment_type TEXT,
      salary_min INTEGER,
      frequency TEXT DEFAULT 'daily',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_job_alerts_user ON job_alerts(user_id)`).run();
  // Tracks when each alert last actually emailed matches — the dispatcher
  // (lib/job-alerts-dispatcher.js) uses this both to only ever email jobs
  // posted SINCE the last send (never re-sending the same job twice) and
  // to respect each alert's own frequency (daily/weekly) without a
  // separate scheduling table.
  await ensureColumn(env, 'job_alerts', 'last_notified_at', 'DATETIME');

  // ── applications ────────────────────────────────────────────────
  // application_type distinguishes a job whose provider/employer accepts
  // applying THROUGH JobForion ('internal' — reserved for future use,
  // see plan §18) from the overwhelming majority today, where "applying"
  // means JobForion recorded the click-through to the employer's own
  // site ('external'). No code currently assumes 'internal' has a real
  // in-app application form — this column just keeps the two concepts
  // from being conflated once one exists.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      status TEXT DEFAULT 'saved',
      application_type TEXT DEFAULT 'external',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, job_id)
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id)`).run();

  // ── companies ───────────────────────────────────────────────────
  // Previously "companies" were just the free-text `jobs.company` column
  // (see the note on hidden_companies above) — this is the first real
  // Company entity. Provider-synced jobs are NOT required to have a row
  // here (see jobs.company_id below, nullable) so Greenhouse/Lever/etc.
  // integrations are entirely unaffected; a companies row only exists
  // once a real user account claims/creates that company.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      logo_url TEXT,
      website TEXT,
      description TEXT,
      industry TEXT,
      country TEXT,
      city TEXT,
      company_size TEXT,
      linkedin_url TEXT,
      status TEXT DEFAULT 'pending',
      verified INTEGER DEFAULT 0,
      created_by_user_id INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug)`).run();

  // ── Company System (Stage 3) — additive profile columns ───────────
  // Every column below is added via ensureColumn (PRAGMA-checked
  // ALTER TABLE), never a fresh CREATE TABLE, so every company row that
  // already exists from Stage 1 (Authentication & Accounts) keeps all its
  // data untouched — these simply default to NULL/0 for existing rows.
  await ensureColumn(env, 'companies', 'cover_image_url', 'TEXT');
  await ensureColumn(env, 'companies', 'founded_year', 'INTEGER');
  await ensureColumn(env, 'companies', 'headquarters', 'TEXT');
  await ensureColumn(env, 'companies', 'contact_email', 'TEXT');
  await ensureColumn(env, 'companies', 'phone', 'TEXT');
  await ensureColumn(env, 'companies', 'twitter_url', 'TEXT');
  await ensureColumn(env, 'companies', 'facebook_url', 'TEXT');
  // `featured` is intentionally separate from `verified` — a company can
  // be verified (identity confirmed) without being featured (an editorial/
  // monetization decision an admin makes independently — plan §9).
  await ensureColumn(env, 'companies', 'featured', 'INTEGER DEFAULT 0');
  // Indexes for the filter/search columns the public directory and admin
  // panel query on (plan §16). idx_companies_slug already existed; the
  // rest are new.
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_companies_user ON companies(created_by_user_id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_companies_verified ON companies(verified)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_companies_featured ON companies(featured)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_companies_country ON companies(country)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry)`).run();

  // ── company_members ─────────────────────────────────────────────
  // The users ↔ companies join table with a role, exactly as the plan
  // requires (§13) — permissions are resolved by looking up THIS table
  // per-request (see lib/accounts/permissions.js), never by a single
  // global `users.role` column, so one user can hold different roles at
  // different companies and remain a Job Seeker everywhere at the same
  // time.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS company_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      role TEXT DEFAULT 'member',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, user_id)
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_company_members_user ON company_members(user_id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_company_members_company ON company_members(company_id)`).run();

  // ── Link jobs → companies (additive, nullable) ─────────────────
  // company_id is nullable and source_type defaults to 'provider' so
  // EVERY existing job (all 9 ATS providers) is completely unaffected —
  // this migration adds zero constraints on the ~all rows that predate
  // it. Only newly-approved employer submissions (see
  // routes/admin.router.js's postings/approve handler) ever set
  // company_id + source_type='employer'.
  await ensureColumn(env, 'jobs', 'company_id', 'INTEGER REFERENCES companies(id)');
  await ensureColumn(env, 'jobs', 'source_type', "TEXT DEFAULT 'provider'");
  await ensureColumn(env, 'jobs', 'submitted_by_user_id', 'INTEGER REFERENCES users(id)');
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs(company_id)`).run();

  // ── Link job_postings → an authenticated company submission ────
  // Also additive/nullable — the existing anonymous "Post a Job" modal
  // (components/post-job-modal.js, /api/post-job) keeps working exactly
  // as before and simply leaves these NULL. Only the new authenticated
  // /company/post-job flow sets them (see routes/company.router.js).
  await ensureColumn(env, 'job_postings', 'user_id', 'INTEGER REFERENCES users(id)');
  await ensureColumn(env, 'job_postings', 'company_id', 'INTEGER REFERENCES companies(id)');

  // ── Professional Post a Job (Stage 4) — additive structured fields ──
  // Only the authenticated /company/post-job form (routes/company.router.js)
  // ever writes these; the original anonymous "Post a Job" modal
  // (components/post-job-modal.js, /api/post-job) is untouched and simply
  // leaves them NULL, exactly like user_id/company_id above.
  await ensureColumn(env, 'job_postings', 'skills', 'TEXT');
  await ensureColumn(env, 'job_postings', 'seniority', 'TEXT');

  // ── Job Management (Stage 5) — additive ─────────────────────────
  // Admin's chosen reason when rejecting a job_postings row (plan §10).
  // NULL for the vast majority of rows (approved, or rejected before this
  // column existed) — never touches jobs already approved into `jobs`.
  await ensureColumn(env, 'job_postings', 'rejection_reason', 'TEXT');

  // Indexes for the query patterns Job Management actually runs:
  // admin/company filtering by status, cleanup's source/expiry scan, and
  // the new company-jobs page's "my jobs, this status" lookup.
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_status_id ON jobs(status, id DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON jobs(status, updated_at DESC, id DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON jobs(expires_at)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_job_postings_company_status ON job_postings(company_id, status)`).run();
  // Powers per-job view counts on the company dashboard (COUNT(*) FROM
  // visits WHERE path = '/job/:id') — visits has no index at all today,
  // and this table only ever grows, so this is worth adding now rather
  // than waiting for it to show up as a slow query later.
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_visits_path ON visits(path)`).run();

  // ── Database & Performance (Stage 7) ──────────────────────────────
  // Composite (company_id, status) replaces the old single-column
  // idx_jobs_company_id: every real query filtering on company_id ALSO
  // filters on status in the same WHERE (company-jobs dashboard page,
  // COMPANY_JOB_MATCH_SQL in lib/companies.js) — a composite index serves
  // both that combined filter AND plain company_id-only lookups via
  // left-prefix matching, so keeping the old single-column index around
  // too would just be redundant write overhead on every INSERT/UPDATE
  // for no read benefit. DROP is safe here: an index is a derived lookup
  // structure, dropping and recreating it never touches the underlying
  // row data.
  await env.DB.prepare(`DROP INDEX IF EXISTS idx_jobs_company_id`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_company_status ON jobs(company_id, status)`).run();
  // Exact-match company lookups (lib/entities.js's jobsByCompany +
  // companySnapshot, both `WHERE company = ?`) — these predate the real
  // `companies` table/company_id and still run on every company profile
  // page view for provider-synced jobs (which have no company_id, only
  // the free-text name). NOT a composite with status: the two current
  // callers either already scope status separately in the same WHERE
  // (SQLite can still use just the company prefix efficiently) or don't
  // filter status at all, so a plain single-column index is the correct,
  // simpler choice here — not every index needs to be composite.
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company)`).run();

  await ensureAiTables(env);
  accountSchemaEnsured = true;
}
