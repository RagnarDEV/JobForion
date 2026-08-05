// src/lib/directory-overrides.js
// ════════════════════════════════════════════════════════════════
// COUNTRY / CITY / SKILL MANAGEMENT — these three directories are NOT
// independent entities with their own rows; they are aggregates
// derived live from free text on the `jobs` table (see the big NOTE at
// the top of lib/entities.js: location is unstructured text like
// "Austin, TX" or "Penang, Malaysia", skills is a JSON array). There is
// nothing to "create" here — a country with zero jobs simply wouldn't
// appear in the directory regardless of what rows exist in any table.
//
// What an admin CAN usefully do without a full geo-normalization
// project: rename how an auto-detected entry displays (fixing a messy
// raw string like "CA" into "California"), or hide one entirely (e.g.
// the documented "a US state gets misclassified as a country" case, or
// a junk value like "N/A"). This file is that override layer — a
// single small table, `directory_overrides`, keyed by (kind, name)
// where name is the EXACT raw string lib/entities.js would otherwise
// display. Both are applied inside listCountries()/listCities()/
// listSkills() in lib/entities.js, so every caller (public directory
// pages, sitemap, admin filters, "Post a Job" nowhere near this) gets
// the override automatically with zero other code changes.
// ════════════════════════════════════════════════════════════════

export const DIRECTORY_KINDS = ['country', 'city', 'skill'];

const TTL_MS = 60000;
const cacheByKind = {}; // { [kind]: { map: Map<lowerName, {display_name, hidden}>, loadedAt } }

function assertKind(kind) {
  if (!DIRECTORY_KINDS.includes(kind)) throw new Error(`Unknown directory kind: ${kind}`);
}

async function loadFromDb(env, kind) {
  const { results } = await env.DB.prepare(
    'SELECT name, display_name, hidden FROM directory_overrides WHERE kind = ?'
  ).bind(kind).all();
  const map = new Map();
  for (const row of results || []) {
    map.set(row.name.toLowerCase(), { name: row.name, display_name: row.display_name || '', hidden: !!row.hidden });
  }
  return map;
}

// Returns a Map<lowercased raw name, {display_name, hidden}> for the
// given kind. Cached per isolate for TTL_MS (same pattern as
// lib/settings.js / lib/categories.js), cleared on any write below.
export async function getOverrides(env, kind) {
  assertKind(kind);
  const now = Date.now();
  const cached = cacheByKind[kind];
  if (cached && (now - cached.loadedAt) < TTL_MS) return cached.map;
  let map;
  try {
    map = await loadFromDb(env, kind);
  } catch (e) {
    map = new Map(); // table not created yet on a very first cold request
  }
  cacheByKind[kind] = { map, loadedAt: now };
  return map;
}

// Applies overrides to an already-aggregated list of {name, slug, count}
// (as produced by listCountries/listCities/listSkills in entities.js):
// drops hidden entries, substitutes display_name where set, and
// recomputes `slug` for renamed entries via the caller-supplied
// slugify function (kept as a parameter here to avoid a circular
// import between this file and entities.js). If a rename causes two
// different raw entries to collapse onto the same slug (e.g. "ReactJS"
// renamed to "React", which already exists on its own), their counts
// are merged into a single entry rather than showing a visible
// duplicate in the directory.
//
// Every returned item also carries `rawNames`: the original,
// UN-renamed name(s) that still literally appear in job rows. Renaming
// only changes what's DISPLAYED — the underlying jobs.location /
// jobs.skills text is never touched — so any code that queries jobs
// (jobsBySkill, jobsByRegion, jobsByCity) MUST filter using rawNames,
// never the display name, or a renamed entry's detail page would
// silently show zero jobs.
export function applyDirectoryOverrides(items, overridesMap, slugifyFn) {
  const merged = new Map(); // slug -> {name, slug, count, rawNames}
  for (const item of items) {
    const ov = overridesMap.get(item.name.toLowerCase());
    if (ov?.hidden) continue;
    const finalName = ov?.display_name || item.name;
    const finalSlug = ov?.display_name ? slugifyFn(ov.display_name) : item.slug;
    const prev = merged.get(finalSlug);
    if (prev) {
      prev.count += item.count;
      prev.rawNames.push(item.name);
    } else {
      merged.set(finalSlug, { ...item, name: finalName, slug: finalSlug, rawNames: [item.name] });
    }
  }
  return [...merged.values()];
}

// Reverse lookup: given a DISPLAY name (what a user sees and clicks —
// e.g. from a filter dropdown built off listCountries()/listSkills()),
// resolves it back to the raw name(s) that actually appear in
// jobs.location / jobs.skills. Used anywhere a name arrives from
// outside as a filter value rather than via findXBySlug() (which
// already returns rawNames directly) — see routes/api.router.js's
// /api/jobs country & skill filters.
export async function resolveRawNames(env, kind, displayName) {
  const overrides = await getOverrides(env, kind);
  const target = String(displayName || '').trim().toLowerCase();
  if (!target) return [];
  const renamedMatches = [...overrides.values()]
    .filter(ov => !ov.hidden && ov.display_name && ov.display_name.toLowerCase() === target)
    .map(ov => ov.name);
  if (renamedMatches.length) return renamedMatches;
  // No override renames anything TO this value — treat it as a raw name
  // itself (the common, no-override case), unless it's been hidden.
  const selfOverride = overrides.get(target);
  if (selfOverride?.hidden) return [];
  return [displayName];
}

export async function setOverride(env, kind, name, { displayName, hidden }) {
  assertKind(kind);
  const cleanName = String(name || '').trim().slice(0, 120);
  if (!cleanName) throw new Error('Name is required.');
  const cleanDisplay = String(displayName || '').trim().slice(0, 120);
  await env.DB.prepare(
    `INSERT INTO directory_overrides (kind, name, display_name, hidden, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(kind, name) DO UPDATE SET display_name = excluded.display_name, hidden = excluded.hidden, updated_at = CURRENT_TIMESTAMP`
  ).bind(kind, cleanName, cleanDisplay, hidden ? 1 : 0).run();
  delete cacheByKind[kind];
}

// Resets an entry back to its raw auto-detected form (deletes the
// override row entirely, rather than leaving an empty/no-op row behind).
export async function clearOverride(env, kind, name) {
  assertKind(kind);
  await env.DB.prepare('DELETE FROM directory_overrides WHERE kind = ? AND name = ?').bind(kind, String(name || '').trim().slice(0, 120)).run();
  delete cacheByKind[kind];
}
