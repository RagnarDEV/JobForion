// src/lib/blog-cms.js
// ════════════════════════════════════════════════════════════════
// BLOG CMS — single source of truth is Cloudflare D1 (the `blog_posts`
// table, see db/schema.js), seeded once from the old BLOG_POSTS
// constant with the SAME numeric ids (1..6), so every already-shared
// /blog/1 .. /blog/6 URL keeps resolving. New posts get slug-based URLs
// (/blog/some-post-slug) going forward — routes/pages.router.js tries a
// numeric id lookup first, then falls back to slug.
//
// Same effective-status-at-read-time approach as lib/pages-cms.js for
// draft/scheduled/published — see that file's header comment for the
// rationale.
// ════════════════════════════════════════════════════════════════

const EFFECTIVE_STATUS_SQL = `(status = 'published' OR (status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')))`;

function slugify(str) {
  return (str || '').toString().toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 80) || 'post';
}

export async function getPosts(env, { includeUnpublished = false, limit = 100 } = {}) {
  const where = includeUnpublished ? '' : `WHERE ${EFFECTIVE_STATUS_SQL}`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM blog_posts ${where} ORDER BY published_at DESC, id DESC LIMIT ?`
  ).bind(limit).all();
  return (results || []).map(parseTags);
}

export async function getPostById(env, id, { includeUnpublished = false } = {}) {
  const where = includeUnpublished ? 'id = ?' : `id = ? AND ${EFFECTIVE_STATUS_SQL}`;
  const { results } = await env.DB.prepare(`SELECT * FROM blog_posts WHERE ${where}`).bind(id).all();
  return results?.[0] ? parseTags(results[0]) : null;
}

export async function getPostBySlug(env, slug, { includeUnpublished = false } = {}) {
  const where = includeUnpublished ? 'slug = ?' : `slug = ? AND ${EFFECTIVE_STATUS_SQL}`;
  const { results } = await env.DB.prepare(`SELECT * FROM blog_posts WHERE ${where}`).bind(slug).all();
  return results?.[0] ? parseTags(results[0]) : null;
}

function parseTags(row) {
  let tags = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch (e) {}
  return { ...row, tags };
}

async function uniqueSlug(env, base, excludeId = null) {
  let candidate = slugify(base);
  let n = 2;
  while (true) {
    const { results } = await env.DB.prepare(
      excludeId ? 'SELECT id FROM blog_posts WHERE slug = ? AND id != ?' : 'SELECT id FROM blog_posts WHERE slug = ?'
    ).bind(...(excludeId ? [candidate, excludeId] : [candidate])).all();
    if (!results?.length) return candidate;
    candidate = `${slugify(base)}-${n++}`;
  }
}

export async function createPost(env, { title, excerpt, body, category, tags, cover_image_url, status, scheduled_at, read_time }) {
  const cleanTitle = String(title || '').trim().slice(0, 150);
  if (!cleanTitle) throw new Error('Title is required.');
  const slug = await uniqueSlug(env, cleanTitle);
  await env.DB.prepare(
    `INSERT INTO blog_posts (slug, title, excerpt, body, category, tags, cover_image_url, status, scheduled_at, read_time, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    slug, cleanTitle, String(excerpt || '').slice(0, 300), String(body || ''),
    String(category || 'General').slice(0, 60),
    JSON.stringify((Array.isArray(tags) ? tags : []).slice(0, 20).map(t => String(t).slice(0, 30))),
    String(cover_image_url || '').slice(0, 500),
    ['published', 'draft', 'scheduled'].includes(status) ? status : 'draft',
    status === 'scheduled' ? (scheduled_at || null) : null,
    String(read_time || '5 min read').slice(0, 30)
  ).run();
}

export async function updatePost(env, id, { title, excerpt, body, category, tags, cover_image_url, status, scheduled_at, read_time }) {
  const cleanTitle = String(title || '').trim().slice(0, 150);
  if (!cleanTitle) throw new Error('Title is required.');
  const slug = await uniqueSlug(env, cleanTitle, id);
  await env.DB.prepare(
    `UPDATE blog_posts SET slug = ?, title = ?, excerpt = ?, body = ?, category = ?, tags = ?, cover_image_url = ?, status = ?, scheduled_at = ?, read_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(
    slug, cleanTitle, String(excerpt || '').slice(0, 300), String(body || ''),
    String(category || 'General').slice(0, 60),
    JSON.stringify((Array.isArray(tags) ? tags : []).slice(0, 20).map(t => String(t).slice(0, 30))),
    String(cover_image_url || '').slice(0, 500),
    ['published', 'draft', 'scheduled'].includes(status) ? status : 'draft',
    status === 'scheduled' ? (scheduled_at || null) : null,
    String(read_time || '5 min read').slice(0, 30),
    id
  ).run();
}

export async function deletePost(env, id) {
  await env.DB.prepare('DELETE FROM blog_posts WHERE id = ?').bind(id).run();
}
