// src/lib/blog-automation/util.js
// Small, dependency-free helpers shared across the blog automation engine.
// Kept separate from lib/entities.js because these are automation-specific
// (word counting for the quality gate, ISO week keys for weekly topics,
// sitemap cache purging) rather than general site data helpers.

export function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function wordCount(text) {
  const t = String(text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

// ISO-8601 week key, e.g. "2026-W34". Used as part of topicKey for the
// weekly-rotating templates (salary/trends/weekly) so the SAME topic can
// never be generated twice in the same calendar week — duplicate
// protection falls out of the key itself, no extra bookkeeping needed.
export function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function formatDateHuman(date = new Date()) {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Best-effort edge-cache purge so a freshly published/expired article is
// reflected in the sitemap immediately rather than waiting out the 1-hour
// Cache-Control TTL (see routes/feed.router.js) — mirrors the identical
// pattern already used by db/cleanup.js for job deletions.
export async function purgeSitemapCache(base) {
  try {
    const cache = caches.default;
    await cache.delete(new Request(`${base}/sitemap.xml`));
    await cache.delete(new Request(`${base}/sitemap-static.xml`));
  } catch (e) {
    // Cache API unavailable (e.g. local dev) — the 1-hour TTL still
    // guarantees eventual consistency, so this is safe to ignore.
  }
}
