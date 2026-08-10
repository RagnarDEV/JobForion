// src/db/analytics.js
// Sync-run logging + best-effort visitor tracking (never blocks the response).

export async function logSync(env, result) {
  const errorsJson = JSON.stringify(result.errors || []);
  const detailsJson = JSON.stringify(result.providerStats || []);
  try {
    await env.DB.prepare(
      `INSERT INTO sync_logs (inserted, skipped, errors, details, created_at) VALUES (?,?,?,?, datetime('now'))`
    ).bind(result.inserted, result.skipped, errorsJson, detailsJson).run();
  } catch (e) {
    // Fallback for a sync_logs table that predates the `details` column —
    // still log the summary rather than losing the record entirely.
    try {
      await env.DB.prepare(
        `INSERT INTO sync_logs (inserted, skipped, errors, created_at) VALUES (?,?,?, datetime('now'))`
      ).bind(result.inserted, result.skipped, errorsJson).run();
    } catch (e2) {}
  }
}

// PERFORMANCE + DATA QUALITY: automated scanners constantly probe common
// WordPress/PHP/CMS exploit paths (wp-admin, xmlrpc.php, wlwmanifest.xml,
// .env, phpMyAdmin, etc.) even though this site runs neither WordPress nor
// PHP. Left untracked, this junk traffic dominates the "Top Pages" widget
// and — more importantly — makes the `visits` table balloon indefinitely
// with rows that are pure noise, which slows down every dashboard query
// that reads from it. None of it is a real visitor, so none of it belongs
// in analytics.
const BOT_PROBE_PATTERN = /(^\/wp-|wp-admin|wp-includes|wp-login|wp-content|wlwmanifest\.xml|xmlrpc\.php|wordpress|phpmyadmin|pma\/|\.env$|\.git\/|administrator\/|\/cgi-bin\/|\.php$|\/vendor\/|\/config\.json$|\/actuator\/|\/\.aws\/)/i;

export function isTrackableVisit(pathname) {
  return !BOT_PROBE_PATTERN.test(pathname);
}

export async function recordVisit(env, request, url) {
  if (!isTrackableVisit(url.pathname)) return;
  try {
    const country = request.cf?.country || 'XX';
    const ua = (request.headers.get('User-Agent') || '').slice(0, 140);
    const ref = (request.headers.get('Referer') || '').slice(0, 200);
    await env.DB.prepare(
      `INSERT INTO visits (path, referrer, country, ua) VALUES (?,?,?,?)`
    ).bind(url.pathname, ref, country, ua).run();
  } catch (e) {}
}
