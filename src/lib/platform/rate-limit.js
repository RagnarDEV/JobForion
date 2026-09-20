// src/lib/platform/rate-limit.js
// Application-aware per-key rate limiting backed by D1. Cloudflare edge/WAF
// rules remain recommended as the first line of defense.

import { sha256Hex } from '../accounts/tokens.js';

// The D1 batch below is atomic, but it is still not a substitute for a
// provider-level fraud or billing ledger. It guarantees that the application
// counter itself cannot be lost between a read and a write under concurrency.

async function limiterKey(env, rawKey) {
  return (await sha256Hex(`rate-limit:${env.ANALYTICS_HASH_SECRET || env.CSRF_SECRET || 'jobforion-rate-limit'}:${rawKey}`)).slice(0, 64);
}

// Clears a counter — used after a SUCCESSFUL login so that typing the right
// password never counts toward a lockout.
export async function resetRateLimit(env, key) {
  try {
    const safeKey = await limiterKey(env, String(key || 'unknown').slice(0, 180));
    await env.DB.prepare('DELETE FROM rate_limits WHERE rl_key = ?').bind(safeKey).run();
  } catch (e) { /* limiter table may not exist yet */ }
}

// Per-isolate fallback limiter for security-sensitive callers when the D1
// limiter itself is unavailable (table not migrated yet, D1 hiccup). Failing
// CLOSED there locked the admin out of the very dashboard needed to repair
// the schema; this keeps brute-force protection (per isolate) without that.
const memoryBuckets = new Map();
export function memoryRateLimit(key, { maxRequests, windowMinutes }) {
  const now = Date.now();
  const windowMs = Math.max(1, windowMinutes) * 60000;
  const rawKey = String(key || 'unknown').slice(0, 180);
  let bucket = memoryBuckets.get(rawKey);
  if (!bucket || now - bucket.start >= windowMs) bucket = { start: now, count: 0 };
  bucket.count += 1;
  memoryBuckets.set(rawKey, bucket);
  if (memoryBuckets.size > 500) for (const [k, v] of memoryBuckets) if (now - v.start >= windowMs) memoryBuckets.delete(k);
  if (bucket.count > maxRequests) return { allowed: false, retryAfterMinutes: Math.max(1, Math.ceil((windowMs - (now - bucket.start)) / 60000)) };
  return { allowed: true };
}
export function resetMemoryRateLimit(key) { memoryBuckets.delete(String(key || 'unknown').slice(0, 180)); }

export async function checkRateLimit(env, key, { maxRequests, windowMinutes, failClosed = false } = {}) {
  const rawKey = String(key || 'unknown').slice(0, 180);
  const safeMax = Math.max(1, Math.min(10000, Number(maxRequests) || 1));
  const safeWindow = Math.max(1, Math.min(10080, Number(windowMinutes) || 1));
  try {
    // Persist only a short fingerprint of the limiter key. Callers may use
    // an IP address as input, but the raw value must not become durable D1
    // data. This also keeps key length bounded and stable.
    const safeKey = await limiterKey(env, rawKey);
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
