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

export async function recordVisit(env, request, url) {
  try {
    const country = request.cf?.country || 'XX';
    const ua = (request.headers.get('User-Agent') || '').slice(0, 140);
    const ref = (request.headers.get('Referer') || '').slice(0, 200);
    await env.DB.prepare(
      `INSERT INTO visits (path, referrer, country, ua) VALUES (?,?,?,?)`
    ).bind(url.pathname, ref, country, ua).run();
  } catch (e) {}
}
