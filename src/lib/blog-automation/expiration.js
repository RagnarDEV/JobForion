// src/lib/blog-automation/expiration.js
// ════════════════════════════════════════════════════════════════
// EXPIRATION CLEANUP — deletes auto-generated articles once they pass
// `expires_at` (computed at publish time as published_at + lifetime
// days — see generator.js / lib/blog-cms.js's createAutoPost). Mirrors
// db/cleanup.js's exact pattern for job lifecycle management.
//
// Only ever touches rows with auto_generated = 1 AND auto_expire = 1 —
// manually-written articles (auto_generated = 0) and auto-generated
// articles an admin explicitly marked permanent (auto_expire = 0) are
// never deleted by this. Deletion here is a real DELETE FROM blog_posts,
// which automatically removes the post from: blog listings and article
// pages (lib/blog-cms.js queries), the sitemap (lib/sitemap.js reads
// live from blog_posts), the RSS feed, and internal search — there is no
// separate "hide from these surfaces" step needed because every one of
// them already reads live from this same table. The old URL then correctly
// resolves as 410 Gone via routes/pages.router.js's renderBlogGonePage().
// ════════════════════════════════════════════════════════════════

import { getSettings } from '../settings.js';
import { getDuePostsForExpiration, hardDeletePosts } from '../blog-cms.js';
import { logBlogEvent } from './logger.js';
import { purgeSitemapCache } from './util.js';
import { BASE_URL } from '../../config/constants.js';

export async function runBlogExpirationCleanup(env) {
  const settings = await getSettings(env);
  if (settings.blog_auto_delete === '0') {
    // Global kill switch — auto-expiration is off site-wide (posts stay
    // published indefinitely regardless of their per-row auto_expire flag).
    return { deleted: 0, skipped: true };
  }

  const due = await getDuePostsForExpiration(env);
  if (!due.length) return { deleted: 0 };

  const ids = due.map(p => p.id);
  await hardDeletePosts(env, ids);
  await purgeSitemapCache(BASE_URL);

  for (const p of due) {
    await logBlogEvent(env, 'article_expired', { articleId: p.id, title: p.title, topicKey: p.topic_key, publishedAt: p.published_at, expiresAt: p.expires_at });
  }

  return { deleted: ids.length, ids };
}
