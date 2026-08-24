// src/lib/pages-cms.js
// ════════════════════════════════════════════════════════════════
// STATIC PAGES CMS — single source of truth is Cloudflare D1 (the
// `pages` table, see db/schema.js), seeded once from the old
// STATIC_PAGES constant so /privacy, /terms, /disclaimer keep working
// unchanged. From here on, /admin/pages can edit those AND create
// entirely new pages (About, FAQ, Cookie Policy, Advertise With Us...)
// at any slug — no code edit, no redeploy. routes/pages.router.js
// matches ANY slug against this table as a catch-all, after every
// fixed route has had a chance to claim the path first.
//
// PUBLISHING STATUS: a page is one of 'published', 'draft', or
// 'scheduled'. Rather than relying on a cron job to flip a scheduled
// page to published at the right moment (fragile — a missed/delayed
// cron run means the page stays hidden past its scheduled time), the
// EFFECTIVE status is computed at read time: 'published', OR
// 'scheduled' with scheduled_at in the past. This is evaluated in SQL
// so it's correct regardless of when a request happens to arrive.
// ════════════════════════════════════════════════════════════════

const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,49}$/;

// Paths that already mean something else in this app — a page can never
// claim one of these, or it would silently break (or be unreachable
// behind) an existing route. Kept as a flat list rather than trying to
// be clever with regexes, so it's obvious at a glance what's protected.
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'job', 'jobs', 'blog', 'categories', 'companies', 'skills',
  'countries', 'search', 'remote-jobs', 'resources', 'sitemap.xml', 'sitemap-static.xml', 'feed.rss',
  'robots.txt', 'manifest.json', 'favicon.ico', 'favicon.svg',
  'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'icon-512.png',
]);

function validateSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw new Error('Slug must be 2–50 lowercase letters/numbers/hyphens, starting with a letter (e.g. "about-us").');
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new Error(`"${slug}" is a reserved path and can't be used as a page slug.`);
  }
}

const EFFECTIVE_STATUS_SQL = `(status = 'published' OR (status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')))`;

// Public-facing: only effectively-published pages, footer-eligible ones
// first in sort_order. `includeUnpublished` is for the admin list view.
export async function getPages(env, { includeUnpublished = false } = {}) {
  const where = includeUnpublished ? '' : `WHERE ${EFFECTIVE_STATUS_SQL}`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM pages ${where} ORDER BY sort_order ASC, title ASC`
  ).all();
  return results || [];
}

export async function getFooterPages(env) {
  const { results } = await env.DB.prepare(
    `SELECT slug, title FROM pages WHERE ${EFFECTIVE_STATUS_SQL} AND show_in_footer = 1 ORDER BY sort_order ASC, title ASC`
  ).all();
  return results || [];
}

// Same idea as getFooterPages(), for the site's mobile/nav menu instead —
// see the show_in_menu column added in db/schema.js. A page can appear in
// the footer, the menu, both, or neither, independently.
export async function getMenuPages(env) {
  const { results } = await env.DB.prepare(
    `SELECT slug, title FROM pages WHERE ${EFFECTIVE_STATUS_SQL} AND show_in_menu = 1 ORDER BY sort_order ASC, title ASC`
  ).all();
  return results || [];
}

export async function getPageBySlug(env, slug, { includeUnpublished = false } = {}) {
  const where = includeUnpublished ? 'slug = ?' : `slug = ? AND ${EFFECTIVE_STATUS_SQL}`;
  const { results } = await env.DB.prepare(`SELECT * FROM pages WHERE ${where}`).bind(slug).all();
  return results?.[0] || null;
}

export async function createPage(env, { slug, title, meta_description, body, status, scheduled_at, show_in_footer, show_in_menu }) {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  validateSlug(cleanSlug);
  const cleanTitle = String(title || '').trim().slice(0, 150);
  if (!cleanTitle) throw new Error('Title is required.');
  const existing = await env.DB.prepare('SELECT slug FROM pages WHERE slug = ?').bind(cleanSlug).all();
  if (existing.results?.length) throw new Error(`A page with slug "${cleanSlug}" already exists.`);
  const { results } = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM pages').all();
  const nextOrder = (results?.[0]?.m ?? -1) + 1;
  await env.DB.prepare(
    `INSERT INTO pages (slug, title, meta_description, body, status, scheduled_at, show_in_footer, show_in_menu, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    cleanSlug, cleanTitle, String(meta_description || '').slice(0, 300), String(body || ''),
    ['published', 'draft', 'scheduled'].includes(status) ? status : 'draft',
    status === 'scheduled' ? (scheduled_at || null) : null,
    show_in_footer ? 1 : 0, show_in_menu ? 1 : 0, nextOrder
  ).run();
}

export async function updatePage(env, slug, { title, meta_description, body, status, scheduled_at, show_in_footer, show_in_menu }) {
  validateSlug(slug);
  const cleanTitle = String(title || '').trim().slice(0, 150);
  if (!cleanTitle) throw new Error('Title is required.');
  await env.DB.prepare(
    `UPDATE pages SET title = ?, meta_description = ?, body = ?, status = ?, scheduled_at = ?, show_in_footer = ?, show_in_menu = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?`
  ).bind(
    cleanTitle, String(meta_description || '').slice(0, 300), String(body || ''),
    ['published', 'draft', 'scheduled'].includes(status) ? status : 'draft',
    status === 'scheduled' ? (scheduled_at || null) : null,
    show_in_footer ? 1 : 0, show_in_menu ? 1 : 0, slug
  ).run();
}

export async function deletePage(env, slug) {
  validateSlug(slug);
  await env.DB.prepare('DELETE FROM pages WHERE slug = ?').bind(slug).run();
}

export async function movePage(env, slug, direction) {
  const { results } = await env.DB.prepare('SELECT slug, sort_order FROM pages ORDER BY sort_order ASC, title ASC').all();
  const rows = results || [];
  const idx = rows.findIndex(r => r.slug === slug);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= rows.length) return;
  const a = rows[idx], b = rows[swapIdx];
  await env.DB.batch([
    env.DB.prepare('UPDATE pages SET sort_order = ? WHERE slug = ?').bind(b.sort_order, a.slug),
    env.DB.prepare('UPDATE pages SET sort_order = ? WHERE slug = ?').bind(a.sort_order, b.slug),
  ]);
}
