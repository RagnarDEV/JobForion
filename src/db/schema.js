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

  // ── Indexes ────────────────────────────────────────────────────
  // PERFORMANCE: the visits table grows unbounded (bot/scanner traffic is
  // filtered out at the source now — see db/analytics.js — but real
  // traffic still accumulates indefinitely) and several dashboard queries
  // filter/group on created_at and path. Without an index those become
  // full-table scans that get slower every day. jobs(status) and
  // jobs(created_at) get the same treatment since cleanup/dashboard
  // queries filter on both constantly.
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_visits_path ON visits(path)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_api_sources_provider_active ON api_sources(provider, active)`).run();

  schemaEnsured = true;
}
