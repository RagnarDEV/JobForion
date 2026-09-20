// src/lib/platform/search-utils.js
// ════════════════════════════════════════════════════════════════
// Shared, security-first helpers for every keyword-search entry point
// (/search/:q, /jobs?q=, /api/jobs?search=). Centralised so the three call
// sites can never drift apart again:
//   • safeDecodeURIComponent — decodeURIComponent throws URIError on a bare
//     "%" ("/search/%E0%A4%A"); an unguarded call turned that into HTTP 500.
//   • normalizeSearchTerm    — strips control chars, collapses whitespace,
//     caps length (a 10 KB search term is never legitimate).
//   • escapeLike / keyword condition — user-supplied "%" and "_" are
//     LIKE wildcards; unescaped, "%" matches every row (full-table result).
// ════════════════════════════════════════════════════════════════

export const MAX_SEARCH_TERM = 80;

export function safeDecodeURIComponent(value) {
  try { return decodeURIComponent(String(value ?? '')); } catch (e) { return null; }
}

export function normalizeSearchTerm(value, max = MAX_SEARCH_TERM) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
}

// "%term%" with wildcards escaped — pair with `LIKE ? ESCAPE '\'`.
export function likeContains(value) {
  return `%${escapeLike(String(value).toLowerCase())}%`;
}

// Builds the keyword WHERE fragment used by every job search.
// { sql, binds } — sql already contains the ESCAPE clauses.
export function keywordCondition(term, { includeLocation = true } = {}) {
  const like = likeContains(term);
  const E = " ESCAPE '\\'";
  const cols = ['LOWER(title)', 'LOWER(company)'];
  if (includeLocation) cols.push('LOWER(location)');
  cols.push('LOWER(description)');
  const parts = cols.map((c) => `${c} LIKE ?${E}`);
  parts.push(`EXISTS (SELECT 1 FROM json_each(jobs.skills) je WHERE LOWER(je.value) LIKE ?${E})`);
  return { sql: `(${parts.join(' OR ')})`, binds: parts.map(() => like) };
}
