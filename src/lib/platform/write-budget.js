// src/lib/platform/write-budget.js
// ════════════════════════════════════════════════════════════════
// Daily D1 "rows written" governor for the job sync.
//
// Cloudflare D1 (free plan) allows 100,000 rows written per day, and an
// INSERT/UPDATE/DELETE counts one row for the table PLUS one for every index
// entry it touches. A job row carries ~14 indexes, so one new job costs about
// 15 written rows — the sync must therefore be paced, not just capped.
//
// The governor keeps a tiny counter in `site_settings` (internal `_sync_*`
// keys, never shown in the Settings UI):
//   _sync_day    UTC date the counter belongs to
//   _sync_used   estimated rows written by sync so far today
//   _sync_cursor index of the next source to start with (fair rotation)
// and spreads the remaining daily allowance over the remaining runs of the
// day, so a single run can never burn the whole day's budget.
// ════════════════════════════════════════════════════════════════

import { SYNC_INTERVAL_HOURS } from './rotation.js';

// Estimated D1 rows written per operation (table row + touched index entries).
export const WRITE_COST = Object.freeze({
  insert: 15,   // new job: row + ~14 index entries
  update: 6,    // changed job: row + indexes whose key columns changed
  touch: 4,     // lifecycle refresh: updated_at / expires_at / status only
});

// 55% of the 100k free-plan limit: the rest is reserved for page-view logging,
// analytics aggregation, cleanup deletes, blog automation, accounts and admin edits.
export const DEFAULT_DAILY_SYNC_BUDGET = 55000;
export const MIN_DAILY_SYNC_BUDGET = 1000;
export const MAX_DAILY_SYNC_BUDGET = 95000;

export function parseDailyBudget(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_SYNC_BUDGET;
  return Math.min(MAX_DAILY_SYNC_BUDGET, Math.max(MIN_DAILY_SYNC_BUDGET, n));
}

export function utcDayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

// Scheduled sync slots are 00,03,...,21 UTC. For hour h (scheduled or manual)
// this is the number of runs still ahead INCLUDING the current one.
export function syncRunsLeftToday(now = Date.now()) {
  const hour = new Date(now).getUTCHours();
  return Math.max(1, Math.floor((24 - hour - 1) / SYNC_INTERVAL_HOURS) + 1);
}

export function runAllowance({ dailyBudget, usedToday, now = Date.now() }) {
  const remaining = Math.max(0, Number(dailyBudget) - Math.max(0, Number(usedToday) || 0));
  return Math.floor(remaining / syncRunsLeftToday(now));
}

const KEYS = ['_sync_day', '_sync_used', '_sync_cursor'];

export async function loadSyncState(env, now = Date.now()) {
  const state = { day: utcDayKey(now), used: 0, cursor: 0 };
  try {
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM site_settings WHERE key IN (?,?,?)`
    ).bind(...KEYS).all();
    const map = Object.fromEntries((results || []).map((r) => [r.key, r.value]));
    state.cursor = Math.max(0, parseInt(map._sync_cursor, 10) || 0);
    if (map._sync_day === state.day) state.used = Math.max(0, parseInt(map._sync_used, 10) || 0);
  } catch (e) { /* first run / table not ready — start from a clean counter */ }
  return state;
}

// One batch (= one subrequest) writing three tiny rows.
export async function saveSyncState(env, { day, used, cursor }) {
  try {
    const upsert = `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`;
    await env.DB.batch([
      env.DB.prepare(upsert).bind('_sync_day', String(day)),
      env.DB.prepare(upsert).bind('_sync_used', String(Math.max(0, Math.round(used)))),
      env.DB.prepare(upsert).bind('_sync_cursor', String(Math.max(0, cursor | 0))),
    ]);
  } catch (e) { /* bookkeeping must never fail a sync */ }
}
