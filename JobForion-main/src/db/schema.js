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
  // key. Existing rows (created before this column existed) default to
  // 'jobdatalake' — the original single-provider behavior — so nothing
  // breaks for keys already in use.
  await ensureColumn(env, 'api_sources', 'provider', "TEXT DEFAULT 'jobdatalake'");

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
  // source: which provider this job came from (arbeitnow, greenhouse, ...)
  // — lets the stats dashboard and cleanup logic reason per-provider.
  await ensureColumn(env, 'jobs', 'source', 'TEXT');
  // status: 'active' | 'expired' | 'deleted'. Rows are only ever hard-deleted
  // by the daily cleanup cron; this column exists so a job disappearing
  // from the public site (status != 'active') and a job being physically
  // removed from D1 are two independently reasoned-about steps.
  await ensureColumn(env, 'jobs', 'status', "TEXT DEFAULT 'active'");

  // Daily cleanup run history — mirrors sync_logs's shape so the future
  // stats dashboard can reuse the same rendering pattern for both.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS cleanup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deleted INTEGER, reason_breakdown TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  schemaEnsured = true;
}
