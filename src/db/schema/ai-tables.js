// src/db/schema/ai-tables.js
// ensureAiTables(): all AI persistence (job intelligence, matching, career
// assistant, content intelligence) declared next to the rest of the schema.

import { schemaState } from './state.js';

// ── AI feature tables ─────────────────────────────────────────────
// All AI persistence is declared here, alongside the rest of the D1 schema.
// Feature modules call ensureAiTables() as a defensive no-op, but they no
// longer own separate runtime DDL definitions. This keeps the four tables,
// indexes, and lifecycle reviewable in one place without destructive changes.
export async function ensureAiTables(env) {
  // BOOTSTRAP IS OWNED BY ensureAllSchema() (db/schema.js), which calls this
  // with a budgeted env carrying __migCtx. Called from anywhere else — dozens of
  // pages and libraries still do `await ensureAiTables(env)` defensively — this
  // MUST be a no-op: while a schema change is pending the per-isolate flag is
  // still false, and running the full DDL here (hundreds of D1 calls) blew the
  // 50-subrequest ceiling and produced the site-wide fallback error page.
  // (Inside a migration the flag is also ignored so unit positions stay
  // deterministic — see db/schema/state.js.)
  if (!env.__migCtx) return;
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
  // FIX (site-wide outage — Error 1101 "Worker threw exception" on every
  // page): this used to build the whole statement list with
  // `statements.map(sql => env.DB.prepare(sql))` and hand the array to
  // `env.DB.batch()`. env.DB.prepare() COMPILES the SQL immediately — it
  // does not wait for batch() to run it — so `.map()` was calling
  // `prepare()` on the `CREATE INDEX ... ON career_assistant_messages(...)`
  // statement before the earlier `CREATE TABLE career_assistant_messages`
  // statement had actually been EXECUTED (only prepared, still queued).
  // On any database where that table didn't already exist, D1/SQLite
  // rejects preparing an index against a table it can't yet see, throwing
  // "no such table: career_assistant_messages". Because ensureAiTables()
  // runs on every request (via ensureAccountTables() in index.js) and
  // never got past this line, the table was NEVER created and EVERY
  // request kept re-throwing the same error forever — a permanent,
  // site-wide outage, not a transient one. Fix: execute each statement
  // sequentially and awaited (prepare AND run one at a time), so the
  // CREATE TABLE is fully committed before the CREATE INDEX that depends
  // on it is ever prepared. This matches the same sequential pattern
  // already used for every other CREATE TABLE in this file.
  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
  schemaState.ai = true;
}
