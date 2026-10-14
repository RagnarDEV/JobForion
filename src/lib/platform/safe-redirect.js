// src/lib/platform/safe-redirect.js
// SECURITY: admin forms carry a hidden `redirect` field (to return to the same
// filtered list). Used raw in a Location header it is an open redirect
// (`//evil.example`, `https://evil.example`, `/\evil.example`). Only
// same-site absolute PATHS under /admin are accepted, matched against a strict
// allow-list pattern (no backslashes, no "..", no "//", no control characters).
const SAFE_ADMIN_PATH = /^\/admin(?:\/[A-Za-z0-9_\-./]*)?(?:\?[A-Za-z0-9_\-=&%.,~:+@!*]*)?$/;

export function safeAdminRedirect(value, fallback = '/admin/jobs') {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 600) return fallback;
  if (!SAFE_ADMIN_PATH.test(raw) || raw.includes('..') || raw.includes('//')) return fallback;
  return raw;
}
