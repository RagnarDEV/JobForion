// src/lib/activity-log.js
// ════════════════════════════════════════════════════════════════
// ADMIN ACTIVITY LOG — records WHO changed WHAT and WHEN across the
// admin panel (see admin_activity_log in db/schema.js). Backs the
// Dashboard's "Recent Activity" panel and the full log at
// /admin/security (see "Admin & Security" in the Admin Dashboard V2).
//
// DESIGN: this is purely an observability/audit trail, never a source
// of truth for any business decision — no route ever branches on what's
// in this table. That keeps it safe to add liberally: logActivity() is
// best-effort and NEVER throws (see try/catch below), so a logging bug
// can never break the real action (deleting a job, saving settings,
// toggling a source) it's attached to. Every call site fires this
// AFTER the real mutation already succeeded.
// ════════════════════════════════════════════════════════════════

const MAX_META_LEN = 500;

// Single source of truth for human-readable activity labels — used by
// both the Dashboard's "Recent Activity" panel and the full log at
// /admin/security, so the two views can never drift out of sync.
export const ACTION_LABELS = {
  login_success: 'Signed in',
  login_failed: 'Failed sign-in attempt',
  login_rate_limited: 'Sign-in blocked (rate limit)',
  source_added: 'Job source added',
  source_deleted: 'Job source removed',
  source_toggled: 'Job source paused/activated',
  company_hidden: 'Company hidden',
  company_unhidden: 'Company unhidden',
  settings_updated: 'Settings changed',
  job_deleted: 'Job deleted',
  jobs_bulk_deleted: 'Stale jobs bulk-deleted',
  job_featured_toggled: 'Job pin toggled',
  category_created: 'Category added',
  category_updated: 'Category updated',
  category_deleted: 'Category deleted',
  page_created: 'Page created',
  page_updated: 'Page updated',
  page_deleted: 'Page deleted',
  blog_created: 'Article published',
  blog_updated: 'Article updated',
  blog_deleted: 'Article deleted',
  ads_updated: 'Ad slot updated',
  ads_toggled: 'Ads master switch toggled',
  cleanup_run: 'Cleanup executed',
  sync_run: 'Job sync triggered',
  cache_purged: 'Cache purged',
};

// action: short machine-readable key, e.g. 'login_failed', 'job_deleted'.
// target: human-readable subject, e.g. the job title or source label.
// meta: optional extra context (string or JSON-serializable object).
export async function logActivity(env, action, target = '', meta = '') {
  try {
    const metaStr = typeof meta === 'string' ? meta : JSON.stringify(meta);
    await env.DB.prepare(
      `INSERT INTO admin_activity_log (action, target, meta, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      String(action || '').slice(0, 80),
      String(target || '').slice(0, 200),
      metaStr.slice(0, MAX_META_LEN)
    ).run();
  } catch (e) {
    // Best-effort only — an audit-trail write failure must never surface
    // to the admin as if their actual action (the thing being logged)
    // had failed. See file header.
  }
}

export async function getRecentActivity(env, limit = 20) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM admin_activity_log ORDER BY id DESC LIMIT ?`
    ).bind(limit).all();
    return results || [];
  } catch (e) {
    return [];
  }
}

// Used by /admin/security to surface a simple brute-force signal
// alongside the rate limiter already blocking the requests themselves
// (see lib/rate-limit.js) — this counts what got through the rate
// limiter's window boundaries too, not just what it blocked.
export async function countRecentLoginFailures(env, minutes = 15) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) c FROM admin_activity_log WHERE action = 'login_failed' AND created_at >= datetime('now', '-' || ? || ' minutes')`
    ).bind(minutes).all();
    return results?.[0]?.c || 0;
  } catch (e) {
    return 0;
  }
}
