// src/lib/blog-automation/logger.js
// ════════════════════════════════════════════════════════════════
// BLOG AUTOMATION LOG — records every step of the generation pipeline
// (blog_automation_log table, see db/schema.js): started, topic
// selected, duplicate detected, insufficient data, article published,
// article expired, generation failed — each with a timestamp and
// structured meta (topic, template, article id, reason). Powers the
// "Recent Activity" panel and stats cards on /admin/blog-automation.
//
// Mirrors lib/activity-log.js's design exactly: best-effort, NEVER
// throws, so a logging failure can never break the actual generation run
// it's attached to. The two most user-visible events (published/expired)
// are ALSO mirrored into the site-wide admin_activity_log so they show up
// in the main Dashboard's "Recent Activity" panel without duplicating
// that table's purpose — this file's own table stays the detailed,
// automation-specific record.
// ════════════════════════════════════════════════════════════════

import { logActivity } from '../activity-log.js';

const MAX_META_LEN = 800;

export const BLOG_EVENT_LABELS = {
  generation_started: 'Generation run started',
  generation_skipped: 'Generation skipped',
  topic_selected: 'Topic selected',
  duplicate_detected: 'Duplicate topic skipped',
  insufficient_data: 'Insufficient data — topic skipped',
  article_published: 'Article published',
  article_expired: 'Article expired & removed',
  generation_failed: 'Generation failed',
};

export async function logBlogEvent(env, event, meta = {}) {
  try {
    await env.DB.prepare(
      `INSERT INTO blog_automation_log (event, meta, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`
    ).bind(String(event || '').slice(0, 60), JSON.stringify(meta || {}).slice(0, MAX_META_LEN)).run();
  } catch (e) {
    // Best-effort only — see file header.
  }
  if (event === 'article_published') {
    await logActivity(env, 'blog_auto_published', meta.title || '', meta);
  } else if (event === 'article_expired') {
    await logActivity(env, 'blog_auto_expired', meta.title || '', meta);
  }
}

export async function getRecentBlogEvents(env, limit = 30) {
  try {
    const { results } = await env.DB.prepare(`SELECT * FROM blog_automation_log ORDER BY id DESC LIMIT ?`).bind(limit).all();
    return (results || []).map(r => {
      let meta = {};
      try { meta = JSON.parse(r.meta || '{}'); } catch (e) {}
      return { ...r, meta };
    });
  } catch (e) { return []; }
}

export async function getBlogAutomationStats(env) {
  const q = async (sql, ...params) => {
    try { const { results } = await env.DB.prepare(sql).bind(...params).all(); return results?.[0]; }
    catch (e) { return null; }
  };
  const [publishedWeek, publishedMonth, expiringSoon, deletedTotal, failedRecent, skippedRecent] = await Promise.all([
    q(`SELECT COUNT(*) c FROM blog_posts WHERE auto_generated = 1 AND published_at >= datetime('now','-7 day')`),
    q(`SELECT COUNT(*) c FROM blog_posts WHERE auto_generated = 1 AND published_at >= datetime('now','-30 day')`),
    q(`SELECT COUNT(*) c FROM blog_posts WHERE auto_generated = 1 AND auto_expire = 1 AND expires_at IS NOT NULL AND expires_at < datetime('now','+7 day')`),
    q(`SELECT COUNT(*) c FROM blog_automation_log WHERE event = 'article_expired'`),
    q(`SELECT COUNT(*) c FROM blog_automation_log WHERE event = 'generation_failed' AND created_at >= datetime('now','-7 day')`),
    q(`SELECT COUNT(*) c FROM blog_automation_log WHERE event IN ('duplicate_detected','insufficient_data') AND created_at >= datetime('now','-7 day')`),
  ]);
  return {
    publishedThisWeek: publishedWeek?.c || 0,
    publishedThisMonth: publishedMonth?.c || 0,
    expiringSoon: expiringSoon?.c || 0,
    deletedTotal: deletedTotal?.c || 0,
    failedRecent: failedRecent?.c || 0,
    skippedRecent: skippedRecent?.c || 0,
  };
}
