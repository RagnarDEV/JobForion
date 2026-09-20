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


// ════════════════════════════════════════════════════════════════
// SCHEMA VERSION GATE — bump SCHEMA_VERSION whenever a CREATE TABLE /
// ensureColumn / CREATE INDEX statement is added anywhere below.
//
// WHY THIS EXISTS (root cause of a real site-wide outage):
// ensureTable() + ensureAccountTables() + ensureAiTables() together now
// issue roughly 280+ individual D1 statements (CREATE TABLE, PRAGMA
// table_info, ALTER TABLE, CREATE INDEX, seed INSERTs) — this schema
// started small (17 round-trips, see the comment below) and grew with
// every new feature, but the "only run once per isolate" in-memory flags
// (schemaEnsured / accountSchemaEnsured / aiSchemaEnsured) only help
// while an isolate stays warm. Cloudflare recycles idle isolates
// constantly, especially on lower-traffic sites, so in practice this
// 280+-statement cascade was re-running on a large fraction of requests
// — comfortably blowing past the free plan's 50-subrequest-per-invocation
// ceiling (and even a meaningful chunk of the paid plan's 1000). Once
// that ceiling is hit mid-request, D1 calls start throwing, which is
// exactly what was crashing the site "constantly": not a one-time bug,
// but a structural cost that scaled with every feature added.
//
// FIX: persist a single version string in a tiny, permanent table.
// On a warm isolate we still short-circuit instantly via the in-memory
// flags (zero D1 calls, unchanged from before). On a COLD isolate, we
// now pay just 2 cheap D1 calls (create-if-missing + one SELECT) to
// confirm the schema is already current, instead of 280+. The full
// migration cascade only ever runs for real when SCHEMA_VERSION has
// actually changed (i.e. right after a deploy that added something) —
// exactly the "rare, self-healing, one-time" behavior the original
// comment below intended, now actually delivered.
const SCHEMA_VERSION = '2026-09-20.1';

// ════════════════════════════════════════════════════════════════
// MIGRATION BUDGET — the missing piece: on Cloudflare's Workers Free
// plan, a single invocation gets a hard ceiling of 50 subrequests
// TOTAL (D1 calls count against this). The full first-time migration
// below issues 280+ D1 calls by itself — meaning it is STRUCTURALLY
// IMPOSSIBLE for it to finish inside one request on that plan, no
// matter how the SCHEMA_VERSION gate is arranged. Every attempt would
// run partway, hit the platform's real ceiling, throw, get caught by
// index.js's top-level safety net (so the visitor sees the friendly
// fallback page, not Cloudflare's raw error) — but the request never
// succeeds, forever.
//
// FIX: wrap env.DB in a small counting proxy for the duration of the
// migration only. Once a safe number of calls has been spent this
// invocation, it stops CLEANLY (throws a private sentinel BEFORE
// starting the next statement — never mid-statement) instead of
// letting the platform cut it off mid-flight. Every statement in
// ensureTable()/ensureAccountTables()/ensureAiTables() is already
// idempotent (CREATE TABLE IF NOT EXISTS, ensureColumn()'s own
// existence check, INSERT OR IGNORE seeds) — none of that code needed
// to change. The NEXT request (any visitor, any fresh isolate) simply
// re-runs the same sequence from the top: everything already applied
// is now a fast no-op (and, for ensureColumn(), one cheaper PRAGMA-only
// check instead of PRAGMA+ALTER), so each successive request makes
// real forward progress until the whole migration is done — typically
// within a handful of ordinary page loads, fully automatically, with
// zero manual steps and zero site-wide downtime for any single
// request (each one still renders normally with whatever schema
// exists at that moment).
const SCHEMA_MIGRATION_BUDGET_DEFAULT = 35;
const SCHEMA_MARKER_CACHE_TTL_SECONDS = 300;
let schemaEnsurePromise = null;

import { schemaState } from './schema/state.js';
import { SchemaBudgetExceeded, makeSkippableDB } from './schema/migration-kit.js';
import { ensureTable } from './schema/core-tables.js';
import { ensureAiTables } from './schema/ai-tables.js';
import { ensureAccountTables } from './schema/account-tables.js';

// Public API — every existing importer keeps using '../db/schema.js'.
export { ensureTable, ensureAiTables, ensureAccountTables };

// ════════════════════════════════════════════════════════════════
// ensureAllSchema() — THIS is what index.js calls on every request.
// See the SCHEMA_VERSION comment at the top of this file for why it
// exists. It is a strict superset of calling ensureTable() +
// ensureAccountTables() directly — same end result, same tables, same
// columns — just gated behind a cheap persisted version check first.
// ════════════════════════════════════════════════════════════════
async function ensureAllSchemaOnce(env) {
  if (schemaState.versionConfirmed) return; // warm isolate — zero D1 calls

  // Same-request guard: index.js's own top-level call is only ONE of
  // several call sites across the codebase that (correctly, per the fix
  // above) now all route through ensureAllSchema() instead of calling
  // ensureTable()/ensureAccountTables() directly. If a single request
  // reaches more than one of them (e.g. index.js's call, then home.js's
  // own call while rendering the homepage), each would otherwise spend
  // its own FULL migration budget — stacking multiple ~35-call rounds
  // into one request and risking the exact subrequest-ceiling crash this
  // whole mechanism exists to prevent. `env` is the same object
  // reference threaded through one request's entire call chain, so
  // stamping it here safely limits the ENTIRE request to at most one
  // migration attempt, regardless of how many places call this.
  if (env.__schemaMigrationAttemptedThisRequest) return;
  env.__schemaMigrationAttemptedThisRequest = true;

  // Cache API marker avoids even the two-call D1 version probe on most cold
  // isolates. It is an optimization only: a cache miss always falls back to
  // the authoritative D1 version check below.
  if (await readSchemaCacheMarker()) {
    schemaState.core = true;
    schemaState.account = true;
    schemaState.ai = true;
    schemaState.versionConfirmed = true;
    return;
  }

  try {
    // Single tiny permanent table, never touched by the rest of the app.
    // Two cheap calls (create-if-missing + read) replace 280+ when the
    // schema is already current, which is true for the overwhelming
    // majority of requests.
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS _schema_meta (k TEXT PRIMARY KEY, v TEXT)`).run();
    const row = await env.DB.prepare(`SELECT v FROM _schema_meta WHERE k = 'version'`).first();
    if (row && row.v === SCHEMA_VERSION) {
      // Schema already current — also flip the individual flags so the
      // ~20 other call sites across the codebase (sync.js, cleanup.js,
      // admin pages, home.js, ai lib modules, ...) that call
      // ensureTable()/ensureAccountTables()/ensureAiTables() directly
      // short-circuit instantly too, instead of re-checking on their own.
      schemaState.core = true;
      schemaState.account = true;
      schemaState.ai = true;
      schemaState.versionConfirmed = true;
      await writeSchemaCacheMarker();
      return;
    }
  } catch (e) {
    // If even this lightweight check fails (e.g. transient D1 error),
    // fall through to the full migration below rather than silently
    // skipping schema setup — self-healing takes priority over speed.
    console.error('[ensureAllSchema] version check failed, running full migration:', e && e.message || e);
  }

  // Schema is missing or out of date (fresh database, or first request
  // after a deploy that changed the schema) — run the real migration,
  // capped by the budget above so this can NEVER throw due to hitting
  // Cloudflare's real per-invocation subrequest ceiling, AND resumable
  // via a persisted cursor so it makes GUARANTEED forward progress every
  // single invocation (see makeSkippableDB()/ensureColumn() above) —
  // not just "safe to retry", but structurally guaranteed to finish
  // within a bounded number of requests regardless of plan tier.
  let startCursor = 0;
  try {
    const cursorRow = await env.DB.prepare(`SELECT v FROM _schema_meta WHERE k = 'migration_cursor'`).first();
    startCursor = cursorRow ? (parseInt(cursorRow.v, 10) || 0) : 0;
  } catch (e) { /* table was just created above; a missing cursor row just means "start from 0" */ }

  const budget = (env.SCHEMA_MIGRATION_BUDGET && Number(env.SCHEMA_MIGRATION_BUDGET) > 0)
    ? Number(env.SCHEMA_MIGRATION_BUDGET)
    : SCHEMA_MIGRATION_BUDGET_DEFAULT;
  let callsUsed = 0;
  function budgetGuard() {
    callsUsed++;
    if (callsUsed > budget) throw new SchemaBudgetExceeded(`Schema migration paused after ${budget} D1 calls this request (resuming from unit #${startCursor}) — will continue on the next request.`);
  }
  const migCtx = { position: 0, cursor: startCursor };
  const budgetedEnv = {
    ...env,
    DB: makeSkippableDB(env.DB, migCtx, budgetGuard),
    __realDB: env.DB,
    __migCtx: migCtx,
    __budgetGuard: budgetGuard,
  };

  try {
    await ensureTable(budgetedEnv);
    await ensureAccountTables(budgetedEnv); // also calls ensureAiTables() internally
  } catch (e) {
    if (e instanceof SchemaBudgetExceeded) {
      // Real progress was made and already durably committed to D1 (every
      // unit up to migCtx.position - 1 either ran for real or was
      // confirmed already-done). Persist that as the new resume point —
      // never move the cursor backward even if something raced — and
      // stop cleanly. Do NOT write SCHEMA_VERSION yet, do NOT set the
      // in-memory flags, do NOT let this propagate: the current request
      // continues rendering normally with whatever schema exists right
      // now, exactly like any other request.
      const newCursor = Math.max(startCursor, migCtx.position - 1);
      console.error(`[ensureAllSchema] ${e.message} (progress: unit ${newCursor})`);
      try {
        await env.DB.prepare(
          `INSERT INTO _schema_meta (k, v) VALUES ('migration_cursor', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`
        ).bind(String(newCursor)).run();
      } catch (e2) { /* worst case the next request re-derives progress from scratch — still safe, just slower */ }
      return;
    }
    // A genuinely different error (bad SQL, real D1 outage, etc.) —
    // this is NOT the budget guard, so surface it exactly as before:
    // let index.js's top-level safety net catch it, log the full
    // stack, and show the branded fallback page (with ?jf_debug=
    // revealing the real cause if the admin password is supplied).
    throw e;
  }

  // Fully completed in this invocation (or already had enough of a
  // cursor head start to finish within budget) — record the version and
  // clean up the now-irrelevant cursor.
  try {
    await env.DB.prepare(
      `INSERT INTO _schema_meta (k, v) VALUES ('version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`
    ).bind(SCHEMA_VERSION).run();
    await env.DB.prepare(`DELETE FROM _schema_meta WHERE k = 'migration_cursor'`).run();
  } catch (e) {
    // Non-fatal: worst case, the next cold isolate re-runs the full
    // (idempotent, safe, now-instant-since-already-done) migration once
    // more instead of taking the fast path. Never worth failing the
    // request over.
  }
  schemaState.versionConfirmed = true;
  await writeSchemaCacheMarker();
}

function schemaMarkerRequest() {
  return new Request(`https://jobforion-schema-cache.invalid/${encodeURIComponent(SCHEMA_VERSION)}`);
}

async function readSchemaCacheMarker() {
  try {
    const cache = globalThis.caches?.default;
    if (!cache) return false;
    const response = await cache.match(schemaMarkerRequest());
    return !!response && (await response.text()) === SCHEMA_VERSION;
  } catch (e) {
    return false;
  }
}

async function writeSchemaCacheMarker() {
  try {
    const cache = globalThis.caches?.default;
    if (!cache) return;
    await cache.put(
      schemaMarkerRequest(),
      new Response(SCHEMA_VERSION, {
        headers: { 'Cache-Control': `public, max-age=${SCHEMA_MARKER_CACHE_TTL_SECONDS}` },
      }),
    );
  } catch (e) {
    // Cache API availability is an optimization only; D1 remains authoritative.
  }
}

// Coalesce simultaneous cold-start requests in the same isolate. Without
// this promise, a burst of visitors can make every request run the D1 version
// probe before the first one finishes and sets the module flag.
export async function ensureAllSchema(env) {
  if (schemaState.versionConfirmed) return;
  if (schemaState.ensurePromise) return schemaState.ensurePromise;
  schemaState.ensurePromise = ensureAllSchemaOnce(env).finally(() => {
    schemaState.ensurePromise = null;
  });
  return schemaState.ensurePromise;
}
