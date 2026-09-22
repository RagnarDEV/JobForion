// src/db/schema/account-tables.js
// ensureAccountTables(): public user accounts + company accounts (users,
// sessions, profiles, saved jobs, alerts, applications, companies, analytics
// queue, ...). Also runs ensureAiTables().

import { schemaState } from './state.js';
import { ensureColumn } from './migration-kit.js';
import { ensureAiTables } from './ai-tables.js';

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

export async function ensureAccountTables(env) {
  // BOOTSTRAP IS OWNED BY ensureAllSchema() (db/schema.js), which calls this
  // with a budgeted env carrying __migCtx. Called from anywhere else — dozens of
  // pages and libraries still do `await ensureAccountTables(env)` defensively — this
  // MUST be a no-op: while a schema change is pending the per-isolate flag is
  // still false, and running the full DDL here (hundreds of D1 calls) blew the
  // 50-subrequest ceiling and produced the site-wide fallback error page.
  // (Inside a migration the flag is also ignored so unit positions stay
  // deterministic — see db/schema/state.js.)
  if (!env.__migCtx) return;

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
  // emails without deleting their alerts (lib/jobs/job-alerts-dispatcher.js
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
  // see lib/directory/entities.js / api.router.js's /api/subscribe, left
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
  // (lib/jobs/job-alerts-dispatcher.js) uses this both to only ever email jobs
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
  // ROW-READ BUDGET (D1 free tier): job_count/remote_job_count are DENORMALIZED
  // from `jobs` — persisted here (kept current by lib/platform/site-cache.js's
  // refresh) so the public /companies directory can ORDER BY job_count without a
  // correlated-subquery-per-company scan of the whole jobs table on every page
  // load. NULL until the first refresh has run (see listPublicCompanies fallback).
  await ensureColumn(env, 'companies', 'job_count', 'INTEGER');
  await ensureColumn(env, 'companies', 'remote_job_count', 'INTEGER');
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_companies_status_featured_jobcount ON companies(status, featured DESC, job_count DESC)`).run();
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
  // COMPANY_JOB_MATCH_SQL in lib/companies/companies.js) — a composite index serves
  // both that combined filter AND plain company_id-only lookups via
  // left-prefix matching, so keeping the old single-column index around
  // too would just be redundant write overhead on every INSERT/UPDATE
  // for no read benefit. DROP is safe here: an index is a derived lookup
  // structure, dropping and recreating it never touches the underlying
  // row data.
  await env.DB.prepare(`DROP INDEX IF EXISTS idx_jobs_company_id`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_company_status ON jobs(company_id, status)`).run();
  // Exact-match company lookups (lib/directory/entities.js's jobsByCompany +
  // companySnapshot, both `WHERE company = ?`) — these predate the real
  // `companies` table/company_id and still run on every company profile
  // page view for provider-synced jobs (which have no company_id, only
  // the free-text name). NOT a composite with status: the two current
  // callers either already scope status separately in the same WHERE
  // (SQLite can still use just the company prefix efficiently) or don't
  // filter status at all, so a plain single-column index is the correct,
  // simpler choice here — not every index needs to be composite.
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company)`).run();
  // Public listings combine the active-status predicate with recency, source
  // and salary-tier filters. These three bounded composites improve the
  // common paths without adding an index for every free-text search column.
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at DESC, id DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_status_source_type ON jobs(status, source_type, created_at DESC)`).run();
  // Row-read budget: the default listing order is `featured DESC, id DESC`
  // (JOB_MANUAL_PIN_SORT_SQL). Without an index that matches it SQLite reads
  // AND sorts every active job to return 20 — ~20,000 rows per homepage,
  // /jobs and /api/jobs request. With it, LIMIT 20 reads 20 rows.
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_status_featured_id ON jobs(status, featured DESC, id DESC)`).run();
  // /admin/jobs with no filters (admin sees every status) sorts by featured/id
  // without a status predicate — without this index that scanned and sorted
  // every row in the table.
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_featured_id ON jobs(featured DESC, id DESC)`).run();
  // Company pages / related jobs: `WHERE company = ? AND status = 'active' ORDER BY featured DESC, id DESC`
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_company_status_id ON jobs(company, status, id DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_status_salary_tier ON jobs(status, salary_tier, created_at DESC)`).run();

  // Retain only the minimum tombstone needed to return an accurate 410 for a
  // URL that really existed and was later hard-deleted. This is additive and
  // contains no description, applicant, employer, or payment data.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS job_tombstones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE,
      job_handle TEXT,
      url TEXT,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_job_tombstones_deleted_at ON job_tombstones(deleted_at)`).run();

  // ── Analytics & Business Intelligence (Phase 14) ────────────────
  // High-volume client events land in a bounded queue first; aggregation
  // converts them into compact daily rows. No payment/user secrets belong
  // in either table. Both tables are additive and safe on old D1 databases.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS analytics_event_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      session_id TEXT,
      user_id INTEGER,
      job_id INTEGER,
      company_id INTEGER,
      country TEXT,
      device_type TEXT,
      browser TEXT,
      os TEXT,
      referrer TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      landing_page TEXT,
      page TEXT,
      metadata TEXT,
      metric_date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS analytics_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_date TEXT NOT NULL,
      event_type TEXT NOT NULL,
      job_id INTEGER NOT NULL DEFAULT 0,
      company_id INTEGER NOT NULL DEFAULT 0,
      country TEXT NOT NULL DEFAULT 'XX',
      device_type TEXT NOT NULL DEFAULT 'unknown',
      source TEXT NOT NULL DEFAULT 'direct',
      medium TEXT NOT NULL DEFAULT 'none',
      event_count INTEGER DEFAULT 0,
      unique_count INTEGER DEFAULT 0,
      metadata TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(metric_date,event_type,job_id,company_id,country,device_type,source,medium)
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_queue_pending ON analytics_event_queue(processed_at, id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_queue_created ON analytics_event_queue(created_at)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_daily_date ON analytics_daily(metric_date, event_type)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_daily_job ON analytics_daily(job_id, metric_date)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_daily_company ON analytics_daily(company_id, metric_date)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_daily_source ON analytics_daily(source, metric_date)`).run();
  // Daily visitor fingerprints are HMACs, never raw browser session IDs. The
  // unique key prevents the hourly aggregator from adding the same visitor
  // repeatedly when events for one day arrive in different batches.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS analytics_daily_uniques (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_date TEXT NOT NULL,
      event_type TEXT NOT NULL,
      dimension_key TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(metric_date,event_type,dimension_key,visitor_hash)
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_uniques_date ON analytics_daily_uniques(metric_date, event_type)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_uniques_hash ON analytics_daily_uniques(visitor_hash, metric_date)`).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS analytics_search_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_date TEXT NOT NULL,
      query TEXT NOT NULL,
      searches INTEGER DEFAULT 0,
      zero_result_searches INTEGER DEFAULT 0,
      result_clicks INTEGER DEFAULT 0,
      unique_searches INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(metric_date,query)
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_search_date ON analytics_search_daily(metric_date, searches DESC)`).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS analytics_filter_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_date TEXT NOT NULL,
      filter_name TEXT NOT NULL,
      filter_value TEXT NOT NULL,
      uses INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(metric_date,filter_name,filter_value)
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_filter_date ON analytics_filter_daily(metric_date,filter_name,uses DESC)`).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS analytics_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      status TEXT NOT NULL DEFAULT 'open',
      threshold REAL,
      actual_value REAL,
      period TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_alerts_status ON analytics_alerts(status, created_at DESC)`).run();

  await ensureAiTables(env);
  schemaState.account = true;
}
