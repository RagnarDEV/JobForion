// src/lib/blog-automation/duplicate-check.js
// ════════════════════════════════════════════════════════════════
// DUPLICATE PROTECTION — two independent checks run before any article
// is generated:
//   1. isDuplicateTopic()   — has this EXACT topic (topic_key) already
//      been written about within the configured cooldown window?
//   2. isTitleTooSimilar()  — even for a different topic_key, does the
//      generated title read as a near-duplicate of a recent post's title?
// Both must pass. Either one failing skips the candidate (generator.js
// then tries the next one) rather than ever overwriting or duplicating
// existing content.
// ════════════════════════════════════════════════════════════════

export async function isDuplicateTopic(env, topicKey, cooldownDays) {
  if (!topicKey) return false;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id FROM blog_posts WHERE topic_key = ? AND created_at >= datetime('now','-' || ? || ' day') LIMIT 1`
    ).bind(topicKey, cooldownDays).all();
    return !!(results && results.length);
  } catch (e) {
    // If the lookup itself fails, fail SAFE (treat as duplicate) rather
    // than risk generating a real duplicate — a skipped run today is
    // recoverable, a pile of near-identical articles is not.
    return true;
  }
}

// Crude but effective bag-of-words overlap check against recent titles —
// no AI, just set intersection. Deliberately only checks the most recent
// 150 posts (cheap, and a duplicate risk realistically only exists
// against recent content, not something published a year ago).
export async function isTitleTooSimilar(env, title) {
  const norm = String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (!norm) return false;
  try {
    const { results } = await env.DB.prepare(`SELECT title FROM blog_posts ORDER BY id DESC LIMIT 150`).all();
    const wordsA = new Set(norm.split(/\s+/).filter(Boolean));
    for (const r of results || []) {
      const other = String(r.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      if (!other) continue;
      if (other === norm) return true;
      const wordsB = new Set(other.split(/\s+/).filter(Boolean));
      const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
      const ratio = intersection / Math.max(wordsA.size, wordsB.size, 1);
      if (ratio > 0.85) return true;
    }
  } catch (e) { /* best-effort — a lookup failure doesn't block generation */ }
  return false;
}
