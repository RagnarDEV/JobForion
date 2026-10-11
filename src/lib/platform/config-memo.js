// src/lib/platform/config-memo.js
// Tiny per-isolate TTL memo for small, rarely-edited configuration reads
// (nav buttons, footer/menu pages, homepage custom sections ...).
//
// D1 ROW-READ BUDGET: these tables were re-read on EVERY page render. Memoising
// them for CONFIG_MEMO_TTL_MS turns N renders into 1 read per isolate per TTL.
// Every admin POST clears the memo of the isolate that handled it
// (see routes/admin.router.js), other isolates converge within the TTL.

export const CONFIG_MEMO_TTL_MS = 120000;
const store = new Map(); // key -> { at, value }

export function clearConfigMemo() { store.clear(); }

export async function memoConfig(key, loader, ttl = CONFIG_MEMO_TTL_MS) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl) return hit.value;
  const value = await loader();
  store.set(key, { at: now, value });
  return value;
}
