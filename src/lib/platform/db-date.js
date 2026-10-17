// src/lib/platform/db-date.js
// D1/SQLite stores CURRENT_TIMESTAMP as 'YYYY-MM-DD HH:MM:SS' in UTC with no
// zone marker. JavaScript parses that exact shape as LOCAL time, so in a
// browser outside UTC every "NEW" badge and "Xh ago" label is shifted by the
// visitor's UTC offset. parseDbDate() reads it as UTC everywhere.
//
// The same logic is inlined (as a string) into src/pages/home/client-script.js
// because that script runs in the browser and cannot import this module —
// keep the two in step (tests/job-lifecycle.test.mjs checks both).

const SQLITE_TS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

export function parseDbDate(value) {
  if (value instanceof Date) return value;
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return new Date(NaN);
  const m = raw.match(SQLITE_TS);
  return new Date(m ? `${m[1]}T${m[2]}Z` : raw);
}

export function dbDateMs(value) {
  return parseDbDate(value).getTime();
}

// 'YYYY-MM-DD' for sitemap <lastmod> / JSON-LD dates; falls back to today
// when the stored value is missing or unparsable instead of throwing a
// RangeError out of toISOString().
export function dbDateYmd(value, fallbackNow = true) {
  const d = parseDbDate(value);
  if (Number.isNaN(d.getTime())) return fallbackNow ? new Date().toISOString().split('T')[0] : '';
  return d.toISOString().split('T')[0];
}
