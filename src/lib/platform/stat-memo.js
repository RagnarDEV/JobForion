// src/lib/platform/stat-memo.js
// Per-isolate TTL memo for EXPENSIVE ADMIN STATISTICS (table row counts, aggregates over the
// visits/queue tables). Unlike config-memo.js it is NOT invalidated by admin edits — these are
// dashboards, not configuration — so reloading an admin page 20 times costs one computation.
// Add ?refresh=1 to any admin page that uses it (or press its Refresh button) to force a recount.
const store = new Map();
export const STAT_TTL_MS = 10 * 60 * 1000;

export async function memoStat(key, loader, { ttl = STAT_TTL_MS, force = false } = {}) {
  const hit = store.get(key);
  const now = Date.now();
  if (!force && hit && now - hit.at < ttl) return hit.value;
  const value = await loader();
  store.set(key, { at: now, value });
  return value;
}
export function clearStatMemo() { store.clear(); }
