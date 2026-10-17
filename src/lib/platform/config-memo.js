// src/lib/platform/config-memo.js
// Tiny per-isolate TTL memo for small, rarely-edited configuration reads
// (nav buttons, footer/menu pages, homepage custom sections ...).
//
// D1 ROW-READ BUDGET: these tables were re-read on EVERY page render. Memoising
// them for CONFIG_MEMO_TTL_MS turns N renders into 1 read per isolate per TTL.
// Every admin POST clears the memo of the isolate that handled it
// (see routes/admin.router.js), other isolates converge within the TTL.

import { entryStillValid, revForLoad } from './config-rev.js';

// Soft TTL: inside it nothing is checked at all. After it the entry is revalidated against the
// config revision (1 memoised row) instead of being reloaded — see config-rev.js.
export const CONFIG_MEMO_TTL_MS = 120000;
const store = new Map(); // key -> { at, value }

export function clearConfigMemo() { store.clear(); }

export async function memoConfig(key, loader, ttl = CONFIG_MEMO_TTL_MS) {
  const hit = store.get(key);
  if (hit && await entryStillValid(hit, ttl)) return hit.value;
  const rev = await revForLoad();
  const at = Date.now();
  const value = await loader();
  store.set(key, { at, value, rev });
  return value;
}
