// src/lib/nav-buttons.js
// ════════════════════════════════════════════════════════════════
// CUSTOM MENU BUTTONS — arbitrary extra links/buttons an admin can add
// to the site's mobile menu (and desktop nav) without a code edit:
// label, destination (internal path or full external URL), an emoji
// icon, and a custom color. Backed by the `nav_buttons` table (see
// db/schema.js).
//
// This is deliberately separate from the `pages` CMS system
// (lib/pages-cms.js) — a "page" always renders content at /<slug> on
// this site; a "nav button" just points somewhere (which might be an
// existing page, a category, or a completely external URL) and carries
// its own icon/color. Use pages-cms's `show_in_menu` flag to put a CMS
// page in the menu, and nav_buttons for everything else.
// ════════════════════════════════════════════════════════════════

export async function getNavButtons(env) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM nav_buttons WHERE active = 1 ORDER BY sort_order ASC, id ASC'
    ).all();
    return results || [];
  } catch (e) {
    return [];
  }
}

export async function getAllNavButtons(env) {
  const { results } = await env.DB.prepare('SELECT * FROM nav_buttons ORDER BY sort_order ASC, id ASC').all();
  return results || [];
}

export async function createNavButton(env, { label, url, icon, color }) {
  const cleanLabel = String(label || '').trim().slice(0, 40);
  const cleanUrl = String(url || '').trim().slice(0, 300);
  if (!cleanLabel) throw new Error('Button label is required.');
  if (!cleanUrl) throw new Error('Button destination (URL or path) is required.');
  const { results } = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM nav_buttons').all();
  const nextOrder = (results?.[0]?.m ?? -1) + 1;
  await env.DB.prepare(
    `INSERT INTO nav_buttons (label, url, icon, color, active, sort_order) VALUES (?, ?, ?, ?, 1, ?)`
  ).bind(cleanLabel, cleanUrl, String(icon || '🔗').trim().slice(0, 8), String(color || '#2563EB').trim().slice(0, 20), nextOrder).run();
}

export async function updateNavButton(env, id, { label, url, icon, color, active }) {
  const cleanLabel = String(label || '').trim().slice(0, 40);
  const cleanUrl = String(url || '').trim().slice(0, 300);
  if (!cleanLabel) throw new Error('Button label is required.');
  if (!cleanUrl) throw new Error('Button destination (URL or path) is required.');
  await env.DB.prepare(
    `UPDATE nav_buttons SET label = ?, url = ?, icon = ?, color = ?, active = ? WHERE id = ?`
  ).bind(cleanLabel, cleanUrl, String(icon || '🔗').trim().slice(0, 8), String(color || '#2563EB').trim().slice(0, 20), active ? 1 : 0, id).run();
}

export async function deleteNavButton(env, id) {
  await env.DB.prepare('DELETE FROM nav_buttons WHERE id = ?').bind(id).run();
}

export async function moveNavButton(env, id, direction) {
  const { results } = await env.DB.prepare('SELECT id, sort_order FROM nav_buttons ORDER BY sort_order ASC, id ASC').all();
  const rows = results || [];
  const idx = rows.findIndex(r => String(r.id) === String(id));
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= rows.length) return;
  const a = rows[idx], b = rows[swapIdx];
  await env.DB.batch([
    env.DB.prepare('UPDATE nav_buttons SET sort_order = ? WHERE id = ?').bind(b.sort_order, a.id),
    env.DB.prepare('UPDATE nav_buttons SET sort_order = ? WHERE id = ?').bind(a.sort_order, b.id),
  ]);
}
