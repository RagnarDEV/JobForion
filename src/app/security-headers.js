// src/app/security-headers.js
// Site-wide security headers (CSP, HSTS, nosniff, ...). Extracted verbatim from
// src/index.js so the entry point stays thin — this is the single place these
// ever need to change.

// ════════════════════════════════════════════════════════════════
// SECURITY HEADERS — applied to every response this Worker returns
// (assets, sitemaps, admin, pages, SEO directories, API, 404). Cheap,
// site-wide, and this is the single place they ever need to change.
//
// CSP NOTE (read before tightening further): this Content-Security-Policy
// allows 'unsafe-inline' for script-src and style-src. That's a real,
// deliberate trade-off — the codebase currently relies heavily on inline
// <script>/<style> blocks (the homepage SPA, nav toggle, job-page save/
// copy buttons, the admin shell, the Google Analytics snippet itself).
// A strict nonce-based CSP that removes 'unsafe-inline' would need every
// one of those inline blocks converted to external files or given a
// per-request nonce threaded through the whole render pipeline — a much
// larger refactor than a header change. What this CSP still meaningfully
// blocks: any injected/loaded script, stylesheet, font, image, or frame
// from a domain NOT in this explicit allow-list, which is real defense
// in depth against a successful injection trying to pull in attacker-
// controlled external resources. The allow-list below is exactly the set
// of third-party origins this site actually loads from — Google
// Analytics, Google Fonts, Adsterra ads, and Cloudflare R2's default
// public `*.r2.dev` domain (company logo/cover uploads — see
// company.router.js + routes/assets.router.js's handleR2AssetRoute).
// Company logo favicons are NOT in this list on purpose: lib/companies/logo-proxy.js
// fetches those Worker-side (edge -> Google) and serves them from our own
// origin at /logo/<slug>.png, so the visitor's browser never contacts
// Google directly for a logo — no img-src entry needed for that path. If
// R2_PUBLIC_BASE_URL is later pointed at a CUSTOM domain instead of the
// default r2.dev one, that domain must be added to img-src below too, or
// uploaded company images will render broken (silently blocked, not a
// server error) on every page that shows them.
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://www.highperformanceformat.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' https://www.google-analytics.com https://*.r2.dev",
    "connect-src 'self' https://www.google-analytics.com https://analytics.google.com",
    "frame-src https://www.highperformanceformat.com",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
  ].join('; '),
};

export function withSecurityHeaders(response, env = null) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  // Uploaded logos may use the configured public R2 domain instead of the
  // Worker proxy. Add only that validated origin to img-src; never widen the
  // policy to arbitrary external image hosts.
  const publicBase = String(env?.R2_PUBLIC_BASE_URL || '').trim();
  if (publicBase) {
    try {
      const origin = new URL(publicBase).origin;
      if (['http:', 'https:'].includes(new URL(publicBase).protocol)) {
        const csp = headers.get('Content-Security-Policy') || '';
        headers.set('Content-Security-Policy', csp.replace('https://*.r2.dev', `https://*.r2.dev ${origin}`));
      }
    } catch (e) {}
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
