// src/lib/rate-limit.js
// Application-aware per-key rate limiting backed by D1. Cloudflare edge/WAF
// rules remain recommended as the first line of defense.

import { sha256Hex } from './accounts/tokens.js';

// The D1 batch below is atomic, but it is still not a substitute for a
// provider-level fraud or billing ledger. It guarantees that the application
// counter itself cannot be lost between a read and a write under concurrency.

export async function checkRateLimit(env, key, { maxRequests, windowMinutes, failClosed = false } = {}) {
  const rawKey = String(key || 'unknown').slice(0, 180);
  const safeMax = Math.max(1, Math.min(10000, Number(maxRequests) || 1));
  const safeWindow = Math.max(1, Math.min(10080, Number(windowMinutes) || 1));
  try {
    // Persist only a short fingerprint of the limiter key. Callers may use
    // an IP address as input, but the raw value must not become durable D1
    // data. This also keeps key length bounded and stable.
    const safeKey = (await sha256Hex(`rate-limit:${env.ANALYTICS_HASH_SECRET || env.CSRF_SECRET || 'jobforion-rate-limit'}:${rawKey}`)).slice(0, 64);
    const [ignored, read] = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO rate_limits (rl_key, count, window_start) VALUES (?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(rl_key) DO UPDATE SET
          count = CASE
            WHEN window_start IS NULL OR datetime(window_start) <= datetime('now', '-' || ? || ' minutes') THEN 1
            ELSE MIN(count + 1, ?)
          END,
          window_start = CASE
            WHEN window_start IS NULL OR datetime(window_start) <= datetime('now', '-' || ? || ' minutes') THEN CURRENT_TIMESTAMP
            ELSE window_start
          END
      `).bind(safeKey, safeWindow, safeMax + 1, safeWindow),
      env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE rl_key = ?').bind(safeKey),
    ]);
    const row = read?.results?.[0];
    if (!row) return failClosed ? { allowed: false, retryAfterMinutes: 1, error: 'rate_limiter_unavailable' } : { allowed: true, error: 'rate_limiter_unavailable' };
    if (Number(row.count || 0) > safeMax) {
      const windowStart = new Date(String(row.window_start || '').replace(' ', 'T') + 'Z');
      const ageMinutes = Number.isFinite(windowStart.getTime()) ? Math.max(0, (Date.now() - windowStart.getTime()) / 60000) : 0;
      return { allowed: false, retryAfterMinutes: Math.max(1, Math.ceil(safeWindow - ageMinutes)) };
    }
    return { allowed: true };
  } catch (e) {
    // Public discovery and subscription can remain available during a
    // transient D1 issue, while security-sensitive callers can fail closed.
    return failClosed
      ? { allowed: false, retryAfterMinutes: 1, error: 'rate_limiter_unavailable' }
      : { allowed: true, error: 'rate_limiter_unavailable' };
  }
}
