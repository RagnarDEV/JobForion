// src/lib/platform/safe-url.js
// Single source of truth for "is this an http(s) URL we are willing to store
// or render as a link?". Kept dependency-free so every layer (sync, forms,
// admin routes, page renderers) can import it without pulling in D1 code.
//
// isSafeHttpUrl()  — validation only. The input is NEVER rewritten, which
//                    matters for jobs.url (a UNIQUE key): normalising it would
//                    silently create duplicates of rows that already exist.
// safeExternalUrl() — validation + normalised output, for rendering hrefs.

export function isSafeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw) || /[\s"'<>`\\]/.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch (e) { return false; }
}

export function safeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!isSafeHttpUrl(raw)) return '';
  try { return new URL(raw).toString(); } catch (e) { return ''; }
}
