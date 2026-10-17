// src/lib/platform/config-rev.js
// ════════════════════════════════════════════════════════════════
// Configuration REVISION — the cheap way to keep per-isolate config caches fresh.
//
// PROBLEM (measured with scripts/simulate-warm-isolate.mjs): every warm Worker isolate
// re-read ALL of `site_settings` (~150 rows) every 5 minutes, plus categories / nav /
// footer pages every 2–5 minutes, whether or not anything had changed. That is a
// STANDING cost of ~55k rows/day per isolate — it grows with the number of isolates
// Cloudflare keeps warm (bots + many regions), independent of real traffic, and was the
// largest single consumer of the 5M rows/day free read budget.
//
// FIX: configuration changes are rare, so each cache entry remembers the revision it was
// loaded under. When it ages out of its short "soft" TTL the isolate does NOT reload; it
// asks for the current revision — ONE row, itself memoised for 60 s per isolate — and only
// reloads if the revision moved (or the entry reached the 15-minute "hard" limit, a safety
// net for writers that do not bump the revision).
//
// WHO BUMPS: setSettings() and every successful authenticated admin POST. A bump is one
// tiny upsert; readers on other isolates notice within PROBE_MS.
// ════════════════════════════════════════════════════════════════

const REV_KEY = '_config_rev';
export const REV_PROBE_MS = 60 * 1000;
export const CONFIG_HARD_TTL_MS = 15 * 60 * 1000;

let envRef = null;
let probe = { at: 0, rev: null };

// Called once per request from the Worker entry point (the DB binding never changes).
export function useConfigEnv(env) { if (env && env.DB) envRef = env; }

export async function currentConfigRev(env = envRef) {
  if (!env || !env.DB) return null;
  const now = Date.now();
  if (probe.rev !== null && now - probe.at < REV_PROBE_MS) return probe.rev;
  try {
    const row = await env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(REV_KEY).first();
    probe = { at: now, rev: row && row.value != null ? String(row.value) : '0' };
    return probe.rev;
  } catch (e) { return null; } // table not ready: callers fall back to plain TTL behaviour
}

// SQL for the upsert so setSettings() can put it in the same batch as its own writes.
export function bumpRevStatement(env) {
  const rev = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  probe = { at: Date.now(), rev }; // this isolate sees its own change immediately
  return env.DB.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).bind(REV_KEY, rev);
}

export async function bumpConfigRev(env) {
  try { await bumpRevStatement(env).run(); } catch (e) { /* never block an admin action over bookkeeping */ }
}

// Is a cache entry { at, rev } still valid? Fresh inside `softMs`; between soft and hard it is
// revalidated against the revision (1 memoised row) and its clock is renewed; past hard → reload.
export async function entryStillValid(entry, softMs, hardMs = CONFIG_HARD_TTL_MS, env = envRef) {
  if (!entry) return false;
  const age = Date.now() - entry.at;
  if (age < softMs) return true;
  if (age >= hardMs || entry.rev === null || entry.rev === undefined) return false;
  const rev = await currentConfigRev(env);
  if (rev !== null && rev === entry.rev) { entry.at = Date.now() - 0; return true; }
  return false;
}

// Revision to stamp on an entry that is about to be (re)loaded. Read BEFORE the loader runs so a
// bump that lands mid-load makes the entry look stale instead of being silently missed.
export async function revForLoad(env = envRef) { return currentConfigRev(env); }

export function resetConfigRevProbe() { probe = { at: 0, rev: null }; } // tests only
