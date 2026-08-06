// src/lib/ad-slots.js
// ════════════════════════════════════════════════════════════════
// AD SLOT MANAGER — full admin control over every ad placement's code,
// on/off state, and box size, from /admin/ads. Single source of truth
// is D1 (`ad_slots` table); the site's current hand-configured Adsterra
// codes/sizes are the DEFAULT for each slot, so an empty table renders
// identically to before this feature existed.
//
// Ad SLOTS themselves (the 5 fixed placements below) are NOT admin-
// creatable, unlike Pages/Categories/etc. — a slot only does anything
// if some page template actually calls adSlot('that-id'), so a new,
// code-less slot id would just be inert. What IS fully admin-
// controlled per existing slot: the embed code, enabled/disabled, and
// the box's width/height.
//
// GLOBAL KILL SWITCH: site_settings.ads_enabled ('1'/'0', see
// lib/settings.js) — when off, EVERY ad slot site-wide renders nothing
// at all (not even the dev placeholder box), instantly, without
// touching a single page.
// ════════════════════════════════════════════════════════════════

export const AD_SLOT_DEFS = [
  { id: 'homepage-results-top', label: 'Homepage — above job list' },
  { id: 'job-detail-inline', label: 'Job Detail — after description' },
  { id: 'job-detail-footer', label: 'Job Detail — after Similar Jobs' },
  { id: 'blog-index-top', label: 'Blog Index — above article grid' },
  { id: 'blog-article-footer', label: 'Blog Article — after body' },
];

// The site's current live Adsterra configuration — preserved as the
// default so nothing about existing ad revenue changes until an admin
// actively edits a slot at /admin/ads.
const ADSTERRA_320x50 = `<script>
atOptions = {
  'key' : '136b80686b183d9484dc35c4136e3b57',
  'format' : 'iframe',
  'height' : 50,
  'width' : 320,
  'params' : {}
};
</script>
<script src="https://www.highperformanceformat.com/136b80686b183d9484dc35c4136e3b57/invoke.js"></script>`;

const ADSTERRA_300x250 = `<script>
atOptions = {
  'key' : '69d7d3b2e8807dbd363b797829276c0c',
  'format' : 'iframe',
  'height' : 250,
  'width' : 300,
  'params' : {}
};
</script>
<script src="https://www.highperformanceformat.com/69d7d3b2e8807dbd363b797829276c0c/invoke.js"></script>`;

export const DEFAULT_AD_CONFIG = {
  'homepage-results-top': { code: ADSTERRA_320x50, enabled: true, width: 320, height: 50 },
  'job-detail-inline': { code: ADSTERRA_320x50, enabled: true, width: 320, height: 50 },
  'job-detail-footer': { code: ADSTERRA_300x250, enabled: true, width: 300, height: 250 },
  'blog-index-top': { code: ADSTERRA_300x250, enabled: true, width: 300, height: 250 },
  'blog-article-footer': { code: ADSTERRA_300x250, enabled: true, width: 300, height: 250 },
};

const TTL_MS = 60000;
let cache = null; // { config: {...}, loadedAt }

async function loadFromDb(env) {
  const config = {};
  for (const { id } of AD_SLOT_DEFS) config[id] = { ...DEFAULT_AD_CONFIG[id] };
  try {
    const { results } = await env.DB.prepare('SELECT * FROM ad_slots').all();
    for (const row of results || []) {
      if (!config[row.slot_id]) continue;
      config[row.slot_id] = {
        code: row.code ?? config[row.slot_id].code,
        enabled: !!row.enabled,
        width: row.width || config[row.slot_id].width,
        height: row.height || config[row.slot_id].height,
      };
    }
  } catch (e) {
    // table not created yet on a very first cold request — defaults are enough
  }
  return config;
}

export async function getAdSlotsConfig(env) {
  const now = Date.now();
  if (cache && (now - cache.loadedAt) < TTL_MS) return cache.config;
  const config = await loadFromDb(env);
  cache = { config, loadedAt: now };
  return config;
}

export async function updateAdSlot(env, slotId, { code, enabled, width, height }) {
  if (!AD_SLOT_DEFS.some(s => s.id === slotId)) throw new Error(`Unknown ad slot: ${slotId}`);
  const cleanCode = String(code || '').slice(0, 10000);
  const cleanWidth = Math.min(1000, Math.max(50, parseInt(width, 10) || DEFAULT_AD_CONFIG[slotId].width));
  const cleanHeight = Math.min(1000, Math.max(50, parseInt(height, 10) || DEFAULT_AD_CONFIG[slotId].height));
  await env.DB.prepare(
    `INSERT INTO ad_slots (slot_id, code, enabled, width, height, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(slot_id) DO UPDATE SET code = excluded.code, enabled = excluded.enabled, width = excluded.width, height = excluded.height, updated_at = CURRENT_TIMESTAMP`
  ).bind(slotId, cleanCode, enabled ? 1 : 0, cleanWidth, cleanHeight).run();
  cache = null;
}

export async function resetAdSlot(env, slotId) {
  if (!AD_SLOT_DEFS.some(s => s.id === slotId)) throw new Error(`Unknown ad slot: ${slotId}`);
  await env.DB.prepare('DELETE FROM ad_slots WHERE slot_id = ?').bind(slotId).run();
  cache = null;
}
