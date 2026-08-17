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

export async function createPost(env, { title, excerpt, body, category, tags, cover_image_url, status, scheduled_at, read_time, slug: slugOverride }) {
  const cleanTitle = String(title || '').trim().slice(0, 150);
  if (!cleanTitle) throw new Error('Title is required.');
  const slug = await uniqueSlug(env, slugOverride || cleanTitle);
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

// ════════════════════════════════════════════════════════════════
// BLOG AUTOMATION — additive extension of the CMS above, used only by
// src/lib/blog-automation/generator.js. Deliberately a SEPARATE function
// (rather than overloading createPost()) so the manual admin Blog CMS
// form (routes/admin/content.router.js) and its param shape are never at
// risk of being affected by automation-only fields. Both ultimately write
// to the same `blog_posts` table and are indistinguishable to every
// public-facing reader (blog index, article page, sitemap, RSS, search)
// except for the `auto_generated` flag itself.
// ════════════════════════════════════════════════════════════════

export async function createAutoPost(env, {
  title, slug: slugBase, excerpt, body, category, tags, read_time,
  status = 'published', seo_title, seo_description, canonical_url,
  auto_generated = true, auto_expire = true, lifetime_days = 45,
  source_type, source_data, topic_key,
}) {
  const cleanTitle = String(title || '').trim().slice(0, 150);
  if (!cleanTitle) throw new Error('Title is required.');
  const slug = await uniqueSlug(env, slugBase || cleanTitle);
  const effectiveStatus = ['published', 'draft', 'scheduled'].includes(status) ? status : 'draft';
  // expires_at is computed from PUBLISHED_AT, not created_at — a draft
  // that later gets manually published still starts its 45-day clock the
  // moment it actually goes live, matching the plan's explicit
  // requirement ("published_at + 45 days", never "created_at + 45 days").
  const expiresAtSql = auto_expire && effectiveStatus === 'published'
    ? `datetime('now','+${Math.max(1, parseInt(lifetime_days, 10) || 45)} days')`
    : 'NULL';

  const result = await env.DB.prepare(
    `INSERT INTO blog_posts (
       slug, title, excerpt, body, category, tags, status, read_time, published_at,
       seo_title, seo_description, canonical_url,
       auto_generated, auto_expire, expires_at, source_type, source_data, topic_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ${expiresAtSql}, ?, ?, ?)`
  ).bind(
    slug, cleanTitle, String(excerpt || '').slice(0, 300), String(body || ''),
    String(category || 'General').slice(0, 60),
    JSON.stringify((Array.isArray(tags) ? tags : []).slice(0, 20).map(t => String(t).slice(0, 30))),
    effectiveStatus, String(read_time || '4 min read').slice(0, 30),
    String(seo_title || cleanTitle).slice(0, 70),
    String(seo_description || excerpt || '').slice(0, 160),
    String(canonical_url || '').slice(0, 500),
    auto_generated ? 1 : 0, auto_expire ? 1 : 0,
    String(source_type || '').slice(0, 40),
    String(source_data || '').slice(0, 2000),
    String(topic_key || '').slice(0, 120)
  ).run();

  return result?.meta?.last_row_id || null;
}

// Auto-generated posts published (status='published') in the last N days
// — used by generator.js to enforce the weekly article cap. Counts by
// published_at (when the post actually went live), not created_at.
export async function countAutoPostsPublishedSince(env, days) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) c FROM blog_posts WHERE auto_generated = 1 AND status = 'published' AND published_at >= datetime('now','-' || ? || ' day')`
    ).bind(days).all();
    return results?.[0]?.c || 0;
  } catch (e) { return 0; }
}

// Rows past their expiration lease — see expiration.js. Only ever
// auto_generated=1 AND auto_expire=1 rows are eligible; a permanent
// auto-generated post (auto_expire toggled off) or a manually-written
// post (auto_generated=0) is never returned here.
export async function getDuePostsForExpiration(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, topic_key, published_at, expires_at FROM blog_posts
       WHERE auto_generated = 1 AND auto_expire = 1 AND expires_at IS NOT NULL AND expires_at < datetime('now')`
    ).all();
    return results || [];
  } catch (e) { return []; }
}

// D1 caps bound parameters at 100 per query (see the identical note in
// db/cleanup.js) — batch deletes accordingly rather than assuming an
// unbounded IN(...) list is safe.
export async function hardDeletePosts(env, ids) {
  const DELETE_BATCH_SIZE = 100;
  let totalDeleted = 0;
  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    const chunk = ids.slice(i, i + DELETE_BATCH_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const r = await env.DB.prepare(`DELETE FROM blog_posts WHERE id IN (${placeholders})`).bind(...chunk).run();
    totalDeleted += r.meta?.changes || 0;
  }
  return totalDeleted;
}

// Used by routes/pages.router.js to tell a genuinely-expired auto post
// (→ 410 Gone) apart from a URL that never existed (→ 404) — same intent
// as renderJobGonePage() in that file. Auto-generated posts are
// hard-deleted once expired (see hardDeletePosts above), so by the time a
// visitor hits the dead link the row itself is gone; this checks the
// append-only automation log instead, which still remembers every slug
// that was ever actually published. A LIKE prefilter narrows the D1 scan,
// then each candidate row's meta is properly JSON-parsed and compared —
// never trusts a raw substring match, which could otherwise false-positive
// on a slug that happens to be a substring of another post's slug.
export async function wasAutoPostSlug(env, slug) {
  if (!slug) return false;
  try {
    const { results } = await env.DB.prepare(
      `SELECT meta FROM blog_automation_log WHERE event = 'article_published' AND meta LIKE ? LIMIT 20`
    ).bind(`%${slug}%`).all();
    for (const row of results || []) {
      try {
        const meta = JSON.parse(row.meta || '{}');
        if (meta.slug === slug) return true;
      } catch (e) {}
    }
    return false;
  } catch (e) { return false; }
}

export async function updatePost(env, id, { title, excerpt, body, category, tags, cover_image_url, status, scheduled_at, read_time, auto_expire }) {
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

  // auto_expire is only ever meaningful for auto_generated posts (the
  // manual "New Article" form never submits it — see
  // pages/admin/blog-cms.js's postForm, which only renders this control
  // when post.auto_generated is true) — undefined here means "leave as
  // is", so this never touches a manually-written post's row.
  if (auto_expire !== undefined) {
    if (auto_expire) {
      // Re-enabling expiration on a post that has none set yet gives it
      // a fresh 45-day lease from right now — there is no way to recover
      // the original generation-time lifetime setting at edit time, and
      // "45 days from when an admin turned it back on" is the safer
      // default over silently reusing a stale/inconsistent value.
      await env.DB.prepare(
        `UPDATE blog_posts SET auto_expire = 1, expires_at = COALESCE(expires_at, datetime('now','+45 days')) WHERE id = ?`
      ).bind(id).run();
    } else {
      await env.DB.prepare(`UPDATE blog_posts SET auto_expire = 0, expires_at = NULL WHERE id = ?`).bind(id).run();
    }
  }
}

export async function deletePost(env, id) {
  await env.DB.prepare('DELETE FROM blog_posts WHERE id = ?').bind(id).run();
}
