// src/lib/analytics.js
// Google Analytics (GA4) tag — single source of truth for the tracking ID
// and snippet, injected into every PUBLIC-facing page shell:
//   - layout/base-layout.js  (job page, blog, static pages, SEO pages)
//   - pages/home.js          (homepage — builds its own <head> separately)
//
// Deliberately NOT included in the admin panel (pages/admin/shell.js,
// pages/admin.js login screen): that's an internal, password-protected
// tool already served with `noindex, nofollow` — tracking the site
// owner's own admin usage serves no purpose and would just pollute the
// analytics data with non-visitor traffic.
export const GA_MEASUREMENT_ID = 'G-NQJM1B95TS';

// Static tag kept for any caller that hasn't been wired to dynamic
// settings yet — identical output to before, zero risk of regression.
export const GOOGLE_ANALYTICS_TAG = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_MEASUREMENT_ID}');
</script>`;

// Dynamic version — accepts a measurement ID sourced from D1 via
// lib/settings.js (site_settings.ga_measurement_id), so the tracking ID
// can be changed from /admin/settings without touching this file or
// redeploying. Falls back to the constant above when no id (or an
// empty string) is supplied, so callers can pass `settings?.ga_measurement_id`
// straight through without a null-check.
export function googleAnalyticsTag(measurementId) {
  const id = measurementId || GA_MEASUREMENT_ID;
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${id}');
</script>`;
}
