// src/lib/categories.js
// ════════════════════════════════════════════════════════════════
// DYNAMIC JOB CATEGORIES — single source of truth is Cloudflare D1
// (the `categories` table, see db/schema.js), seeded once from the old
// CATEGORY_META constant in config/constants.js so the site's existing
// 13 categories keep working unchanged after this upgrade. From this
// point on, /admin/categories is the only place categories are
// created, edited, reordered, or removed — no code edit, no redeploy.
//
// SECURITY: a category `key` is used elsewhere in the codebase as a
// SQL LIKE pattern fragment (`%${key}%`, always via a bound parameter
// — safe) to classify jobs by matching their title. It must NEVER be
// interpolated directly into a raw SQL string (e.g. as a column alias)
// — see the fix in pages/home.js's getCategoryCounts(), which used to
// do exactly that back when keys were a fixed, trusted whitelist. Now
// that keys are admin-supplied, KEY_PATTERN below is enforced on every
// write, and callers must keep treating `key` as untrusted data, not
// as a safe SQL identifier. The pattern also excludes `%` and `_`
// (SQL LIKE wildcards) so a key can't accidentally widen its own
// matching semantics.
// ════════════════════════════════════════════════════════════════

import { CATEGORY_META as LEGACY_CATEGORY_META } from '../config/constants.js';

const KEY_PATTERN = /^[a-z][a-z0-9]{1,19}$/;
const TTL_MS = 60000;
let cache = null; // { rows: [...], loadedAt: number }

function validateKey(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new Error('Category key must be 2–20 lowercase letters/numbers, starting with a letter (e.g. "developer").');
  }
}

async function loadFromDb(env) {
  const { results } = await env.DB.prepare(
    'SELECT key, label, emoji, color, sort_order, active FROM categories ORDER BY sort_order ASC, key ASC'
  ).all();
  return results || [];
}

// Full row list (includes inactive — the admin list needs to show and
// toggle those). Cached per isolate for TTL_MS, cleared on any write.
export async function getCategoriesRaw(env) {
  const now = Date.now();
  if (cache && (now - cache.loadedAt) < TTL_MS) return cache.rows;
  let rows;
  try {
    rows = await loadFromDb(env);
  } catch (e) {
    // Table not created yet on a very first cold request — fall back to
    // the legacy static list so the site still renders correctly.
    rows = Object.entries(LEGACY_CATEGORY_META).map(([key, v], i) => ({ key, label: v.label, emoji: v.emoji, color: v.color, sort_order: i, active: 1 }));
  }
  cache = { rows, loadedAt: now };
  return rows;
}

// Active categories only, in display order — the shape callers almost
// always want.
export async function getCategories(env) {
  return (await getCategoriesRaw(env)).filter(c => c.active);
}

// Drop-in replacement for the old CATEGORY_ORDER array of keys.
export async function getCategoryOrder(env) {
  return (await getCategories(env)).map(c => c.key);
}

// Drop-in replacement for the old CATEGORY_META object — same
// {label, emoji, color} shape per key — so existing template code that
// does `categoryMap[key].label` keeps working unchanged.
export async function getCategoryMap(env) {
  const map = {};
  for (const c of await getCategories(env)) map[c.key] = { label: c.label, emoji: c.emoji, color: c.color };
  return map;
}

// Convenience combo — the `{order, map}` shape baseLayout()/post-job-modal
// expect. Most callers rendering a page want both at once.
export async function getCategoryData(env) {
  const categories = await getCategories(env);
  return {
    order: categories.map(c => c.key),
    map: Object.fromEntries(categories.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }])),
  };
}
export async function createCategory(env, { key, label, emoji, color }) {
  const cleanKey = String(key || '').trim().toLowerCase();
  validateKey(cleanKey);
  const cleanLabel = String(label || '').trim().slice(0, 60);
  if (!cleanLabel) throw new Error('Label is required.');
  const cleanEmoji = String(emoji || '🏷️').trim().slice(0, 8);
  const cleanColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#3556FF';

  const { results } = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories').all();
  const nextOrder = (results?.[0]?.m ?? -1) + 1;

  await env.DB.prepare(
    `INSERT INTO categories (key, label, emoji, color, sort_order, active) VALUES (?, ?, ?, ?, ?, 1)`
  ).bind(cleanKey, cleanLabel, cleanEmoji, cleanColor, nextOrder).run();
  cache = null;
}

export async function updateCategory(env, key, { label, emoji, color, active }) {
  validateKey(key);
  const cleanLabel = String(label || '').trim().slice(0, 60);
  if (!cleanLabel) throw new Error('Label is required.');
  const cleanEmoji = String(emoji || '🏷️').trim().slice(0, 8);
  const cleanColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#3556FF';
  await env.DB.prepare(
    `UPDATE categories SET label = ?, emoji = ?, color = ?, active = ? WHERE key = ?`
  ).bind(cleanLabel, cleanEmoji, cleanColor, active ? 1 : 0, key).run();
  cache = null;
}

export async function deleteCategory(env, key) {
  validateKey(key);
  await env.DB.prepare('DELETE FROM categories WHERE key = ?').bind(key).run();
  cache = null;
}

// Simple, mobile-friendly reordering: swap sort_order with the adjacent
// row in the requested direction. Deliberately not drag-and-drop (which
// needs JS drag events that work poorly with touch) — two big tap
// targets (▲▼) are more reliable on a phone and just as fast for a list
// of ~13 categories.
export async function moveCategory(env, key, direction) {
  validateKey(key);
  const rows = await loadFromDb(env); // fresh read, not the cache, so swaps are never based on stale order
  const idx = rows.findIndex(r => r.key === key);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= rows.length) return;
  const a = rows[idx], b = rows[swapIdx];
  await env.DB.batch([
    env.DB.prepare('UPDATE categories SET sort_order = ? WHERE key = ?').bind(b.sort_order, a.key),
    env.DB.prepare('UPDATE categories SET sort_order = ? WHERE key = ?').bind(a.sort_order, b.key),
  ]);
  cache = null;
}
