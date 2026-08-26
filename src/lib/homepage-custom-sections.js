// Admin-created Homepage Sections. Unlike the fixed built-in sections in
// homepage-sections.js, these records are intentionally content-driven. Their
// HTML/CSS/JavaScript is only ever rendered through pageCodeFrameHtml(), which
// creates an opaque-origin sandboxed iframe.

export const HOMEPAGE_CUSTOM_SECTION_LIMITS = Object.freeze({
  title: 120,
  description: 300,
  html: 120000,
  css: 60000,
  js: 60000,
});

const clean = (value, limit) => String(value || '').trim().slice(0, limit);
const cleanCode = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const toId = value => Number.parseInt(String(value || ''), 10);

function validateId(value) {
  const id = toId(value);
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid homepage section id.');
  return id;
}

function validateTitle(value) {
  const title = clean(value, HOMEPAGE_CUSTOM_SECTION_LIMITS.title);
  if (!title) throw new Error('Section title is required.');
  return title;
}

export async function getAllHomepageCustomSections(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM homepage_custom_sections ORDER BY sort_order ASC, id ASC'
  ).all();
  return results || [];
}

export async function getEnabledHomepageCustomSections(env) {
  const rows = await getAllHomepageCustomSections(env);
  return rows.filter(row => !!row.enabled);
}

export async function getHomepageCustomSectionById(env, value) {
  const id = validateId(value);
  const { results } = await env.DB.prepare(
    'SELECT * FROM homepage_custom_sections WHERE id = ?'
  ).bind(id).all();
  return results?.[0] || null;
}

export async function createHomepageCustomSection(env, { title, description, custom_html, custom_css, custom_js, enabled = true }) {
  const cleanTitle = validateTitle(title);
  const { results } = await env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM homepage_custom_sections'
  ).all();
  const nextOrder = Number(results?.[0]?.max_order ?? -1) + 1;
  await env.DB.prepare(
    `INSERT INTO homepage_custom_sections
      (title, description, custom_html, custom_css, custom_js, enabled, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    cleanTitle,
    clean(description, HOMEPAGE_CUSTOM_SECTION_LIMITS.description),
    cleanCode(custom_html, HOMEPAGE_CUSTOM_SECTION_LIMITS.html),
    cleanCode(custom_css, HOMEPAGE_CUSTOM_SECTION_LIMITS.css),
    cleanCode(custom_js, HOMEPAGE_CUSTOM_SECTION_LIMITS.js),
    enabled ? 1 : 0,
    nextOrder,
  ).run();
}

export async function updateHomepageCustomSection(env, value, { title, description, custom_html, custom_css, custom_js, enabled = true }) {
  const id = validateId(value);
  const cleanTitle = validateTitle(title);
  const result = await env.DB.prepare(
    `UPDATE homepage_custom_sections
     SET title = ?, description = ?, custom_html = ?, custom_css = ?, custom_js = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(
    cleanTitle,
    clean(description, HOMEPAGE_CUSTOM_SECTION_LIMITS.description),
    cleanCode(custom_html, HOMEPAGE_CUSTOM_SECTION_LIMITS.html),
    cleanCode(custom_css, HOMEPAGE_CUSTOM_SECTION_LIMITS.css),
    cleanCode(custom_js, HOMEPAGE_CUSTOM_SECTION_LIMITS.js),
    enabled ? 1 : 0,
    id,
  ).run();
  if (!result?.meta?.changes) throw new Error('Homepage section not found.');
}

export async function setHomepageCustomSectionEnabled(env, value, enabled) {
  const id = validateId(value);
  const result = await env.DB.prepare(
    'UPDATE homepage_custom_sections SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(enabled ? 1 : 0, id).run();
  if (!result?.meta?.changes) throw new Error('Homepage section not found.');
}

export async function deleteHomepageCustomSection(env, value) {
  const id = validateId(value);
  const result = await env.DB.prepare(
    'DELETE FROM homepage_custom_sections WHERE id = ?'
  ).bind(id).run();
  if (!result?.meta?.changes) throw new Error('Homepage section not found.');
}

export async function moveHomepageCustomSection(env, value, direction) {
  const id = validateId(value);
  if (direction !== 'up' && direction !== 'down') return;
  const rows = await getAllHomepageCustomSections(env);
  const index = rows.findIndex(row => Number(row.id) === id);
  if (index === -1) return;
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= rows.length) return;
  const a = rows[index];
  const b = rows[swapIndex];
  await env.DB.batch([
    env.DB.prepare('UPDATE homepage_custom_sections SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(b.sort_order, a.id),
    env.DB.prepare('UPDATE homepage_custom_sections SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(a.sort_order, b.id),
  ]);
}
