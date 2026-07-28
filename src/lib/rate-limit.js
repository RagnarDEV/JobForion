// src/lib/rate-limit.js
// Lightweight, best-effort per-key rate limiting backed by D1 (see
// rate_limits table in db/schema.js). Not a replacement for Cloudflare's
// own edge-level Rate Limiting rules (dashboard → Security → WAF → Rate
// limiting rules, which block traffic before it even reaches this Worker
// and are worth configuring there as the first line of defense) — this is
// a second, application-aware layer that understands per-ENDPOINT limits
// ("3 job postings per IP per hour" vs "5 subscriptions per IP per
// hour"), which a generic edge rule can't express as precisely.
//
// Known limitation: the read-then-write isn't atomic, so two concurrent
// requests from the same key in the same instant could both slip through
// right at the limit. Acceptable for coarse spam deterrence; not
// appropriate for anything requiring exact billing-grade precision.

export async function checkRateLimit(env, key, { maxRequests, windowMinutes }) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT count, window_start FROM rate_limits WHERE rl_key = ?"
    ).bind(key).all();
    const row = results?.[0];

    if (!row) {
      await env.DB.prepare(
        "INSERT INTO rate_limits (rl_key, count, window_start) VALUES (?, 1, CURRENT_TIMESTAMP)"
      ).bind(key).run();
      return { allowed: true };
    }

    // D1/SQLite CURRENT_TIMESTAMP is UTC but formatted without a 'Z'
    // suffix — append it so `new Date()` parses it as UTC rather than
    // (incorrectly) as local time.
    const windowStart = new Date(row.window_start.replace(' ', 'T') + 'Z');
    const ageMinutes = (Date.now() - windowStart.getTime()) / 60000;

    if (ageMinutes > windowMinutes) {
      await env.DB.prepare(
        "UPDATE rate_limits SET count = 1, window_start = CURRENT_TIMESTAMP WHERE rl_key = ?"
      ).bind(key).run();
      return { allowed: true };
    }

    if (row.count >= maxRequests) {
      return { allowed: false, retryAfterMinutes: Math.max(1, Math.ceil(windowMinutes - ageMinutes)) };
    }

    await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE rl_key = ?").bind(key).run();
    return { allowed: true };
  } catch (e) {
    // Fail OPEN, not closed: a bug in the rate limiter should never take
    // down the actual feature (subscribing / posting a job) — spam
    // deterrence is a safeguard on top of the feature, not the feature.
    return { allowed: true };
  }
}
