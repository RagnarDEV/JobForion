// src/lib/platform/rotation.js
// ════════════════════════════════════════════════════════════════
// Fair rotation helpers shared by the sync orchestrator and the providers.
//
// WHY THIS EXISTS: the previous rotation used `Math.floor(Date.now() / 1h)`
// as its slot counter. That is only correct when the job runs EVERY hour.
// With a 3-hour cadence the slot advances by 3 per run, so
// `(slot * size) % length` revisits the SAME window whenever `3 * size` is a
// multiple of `length` (e.g. 15 boards at 5 per run) — the other windows were
// never reached. The slot is now derived from the real sync interval, so it
// advances by exactly 1 per scheduled run.
// ════════════════════════════════════════════════════════════════

export const SYNC_INTERVAL_HOURS = 3;
export const SYNC_INTERVAL_MS = SYNC_INTERVAL_HOURS * 60 * 60 * 1000;

// Monotonic run counter: +1 for every scheduled sync window.
export function syncSlot(now = Date.now(), intervalMs = SYNC_INTERVAL_MS) {
  return Math.floor(Number(now) / intervalMs);
}

// Returns `size` consecutive items (wrapping) starting at the window that
// belongs to `slot`. Every item is visited once every ceil(n / size) runs.
export function pickRotatingWindow(items, size, slot = syncSlot()) {
  const list = Array.isArray(items) ? items : [];
  const take = Math.max(1, Number(size) | 0);
  if (list.length <= take) return list.slice();
  const windows = Math.ceil(list.length / take);
  const start = ((Number(slot) % windows) + windows) % windows * take;
  const out = [];
  for (let i = 0; i < take; i++) out.push(list[(start + i) % list.length]);
  return out;
}
