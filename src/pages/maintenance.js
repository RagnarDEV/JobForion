// src/pages/maintenance.js
// Standalone maintenance-mode page — shown for every public request when
// site_settings.maintenance_mode = '1' (toggled from /admin/settings, no
// redeploy needed). Deliberately NOT built on layout/base-layout.js: that
// shell pulls in the full nav (Browse Jobs, Companies, Post a Job...) and
// the Post-a-Job modal, which would be confusing/broken to show on a page
// whose whole point is "the site is temporarily unavailable". This is a
// minimal, self-contained page that still shares the site's design tokens
// (SHARED_CSS) and brand icon so it looks intentional, not like an error.
//
// Served with HTTP 503 + Retry-After — the correct combination to tell
// search engines "temporarily unavailable, please keep me indexed and
// re-check later" instead of risking de-indexing (which a 404/200 would).

import { SHARED_CSS } from '../styles/shared-css.js';
import { ICON_HEAD } from '../assets/favicon.js';
import { escapeHtml } from '../lib/entities.js';

export function renderMaintenancePage(siteName, message) {
  const safeSiteName = escapeHtml(siteName);
  const safeMessage = escapeHtml(message);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeSiteName} — Under Maintenance</title>
<meta name="robots" content="noindex, follow">
${ICON_HEAD}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
${SHARED_CSS}
body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;background:linear-gradient(135deg,#1830C4 0%,#3556FF 55%,#6C3FE0 100%)}
.mnt-box{background:var(--surface);border-radius:22px;padding:44px 34px;max-width:460px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(11,18,32,.35)}
.mnt-icon{width:64px;height:64px;border-radius:16px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;background:var(--brand-soft)}
.mnt-icon svg{width:30px;height:30px;color:var(--brand)}
.mnt-brand{font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:800;color:var(--ink);margin-bottom:6px;display:flex;align-items:center;justify-content:center;gap:8px}
.mnt-brand img{width:26px;height:26px;border-radius:7px}
.mnt-title{font-size:15px;font-weight:700;color:var(--ink2);margin-bottom:16px;letter-spacing:.3px;text-transform:uppercase}
.mnt-msg{font-size:14.5px;color:var(--ink2);line-height:1.75}
.mnt-dots{display:flex;gap:6px;justify-content:center;margin-top:24px}
.mnt-dots span{width:7px;height:7px;border-radius:50%;background:var(--brand);opacity:.35;animation:mnt-pulse 1.4s infinite ease-in-out}
.mnt-dots span:nth-child(2){animation-delay:.2s}
.mnt-dots span:nth-child(3){animation-delay:.4s}
@keyframes mnt-pulse{0%,100%{opacity:.3;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}
</style>
</head>
<body>
<div class="mnt-box">
  <div class="mnt-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>
  </div>
  <div class="mnt-brand"><img src="/favicon.svg" alt="${safeSiteName}">${safeSiteName}</div>
  <div class="mnt-title">Scheduled Maintenance</div>
  <p class="mnt-msg">${safeMessage}</p>
  <div class="mnt-dots"><span></span><span></span><span></span></div>
</div>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": "3600",
      "Cache-Control": "no-store",
    },
  });
}
