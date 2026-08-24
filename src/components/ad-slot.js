// src/components/ad-slot.js
// Single rendering point for every advertisement placement on JobForion.
// Every page calls adSlot(id, style, config, globalAdsEnabled) and drops
// it wherever an ad belongs. The actual embed code, on/off state, and
// box size per slot are now fully admin-controlled at /admin/ads (see
// lib/ad-slots.js) — no code edit, no redeploy — this file only turns
// that config into safe, isolated markup.
//
// Current slots in use (see each page for exact position):
//   'homepage-results-top'   — src/pages/home.js, above the job list
//   'job-detail-inline'      — src/pages/job-page.js, after the description (default 320×50)
//   'job-detail-footer'      — src/pages/job-page.js, after "Similar Jobs"
//   'blog-index-top'         — src/pages/blog.js, above the article grid
//   'blog-article-footer'    — src/pages/blog.js, after each article body

import { DEFAULT_AD_CONFIG } from '../lib/ad-slots.js';

// RELIABILITY — root cause: Adsterra's invoke.js renders the ad via
// document.write(). Chrome (and Chromium-based mobile browsers) actively
// DISABLES document.write() for a synchronously-loaded, cross-origin
// <script src> whenever it detects a slow/2G-like connection — a
// deliberate "Intervening against document.write()" protection, not a
// bug. On a fast connection the ad renders fine; on a slow one (exactly
// the few-KB/s connection visible in the screenshot) Chrome silently
// no-ops the write, and whatever partial DOM the browser was left with
// renders as a broken box. Sizing the container (below) contains the
// damage but doesn't fix the actual cause.
//
// The fix — and this is what every major ad network's own embed code
// does for document.write()-based tags — is to never let document.write()
// run in the MAIN page document at all. Each slot now renders into its
// own sandboxed iframe through `srcdoc`, so the parent never grants the
// ad access to its DOM, cookies, or same-origin document APIs.
// Chrome's slow-connection intervention only targets document.write()
// reached through a parser-blocking script tag in the top-level
// document — an iframe's srcdoc document is exempt, so the ad renders
// correctly regardless of connection speed. As a side benefit, each ad
// gets a fully isolated `window`/`atOptions`, so two different ad slots
// can never step on each other's config even in edge-case load orders.
// SECURITY/CORRECTNESS: the ad snippet embedded in `code` may contain
// literal `</script>` tags. JSON.stringify() does NOT escape "/", so
// naively dropping JSON.stringify(code) inside a real HTML <script>
// element would let the HTML parser see that literal "</script>" and
// close OUR wrapping script tag early — corrupting the page and silently
// breaking every ad slot rendered after it. Escaping "<" to its unicode
// form keeps the JS string value byte-for-byte identical at runtime
// while making that break-out impossible (same technique already used
// in pages/job-page.js's safeJsonLd for the same class of issue). This
// matters MORE now than when the code was hardcoded: `code` can be
// ANYTHING an admin pastes at /admin/ads, not just the one Adsterra
// snippet a developer wrote — the isolation below is what makes that
// safe (worst case, a bad/malicious paste is contained inside its own
// opaque-origin sandboxed iframe, never able to touch the parent page's DOM/cookies).
function safeJsForScriptTag(str) {
  return JSON.stringify(str).replace(/</g, '\\u003c');
}

function adFrameScript(uid, code) {
  return `<script>(function(){
  var f=document.getElementById(${JSON.stringify(uid)});
  if(!f)return;
  try{f.srcdoc=${safeJsForScriptTag(code)};}catch(e){}
})();</script>`;
}

// `config` (optional) is the resolved {slotId: {code,enabled,width,height}}
// object from lib/ad-slots.js — defaults to DEFAULT_AD_CONFIG (the site's
// hardcoded Adsterra setup) so any caller not yet passing dynamic config
// renders exactly as before. `globalAdsEnabled` (optional, default true)
// is site_settings.ads_enabled — the master kill switch: when false,
// EVERY slot renders nothing at all, site-wide, instantly.
//
// Three distinct outcomes per slot, by design:
//  - global off, OR this slot's `enabled` is false → render nothing
//    (a deliberately hidden ad leaves no visual gap/placeholder)
//  - enabled but no code configured → the dev-facing "reserved space"
//    placeholder (useful while setting a new placement up)
//  - enabled with code → the real, sandboxed ad iframe
export function adSlot(id, style = '', config = DEFAULT_AD_CONFIG, globalAdsEnabled = true) {
  if (!globalAdsEnabled) return '';
  const slot = config[id] || DEFAULT_AD_CONFIG[id];
  if (!slot || !slot.enabled) return '';
  if (slot.code) {
    const uid = `adf_${id.replace(/[^a-z0-9]/gi, '')}`;
    const boxStyle = `width:${slot.width}px;height:${slot.height}px;max-width:100%;margin:16px auto;${style}`;
    return `<div class="ad-slot ad-slot-live" style="${boxStyle}">` +
      `<iframe id="${uid}" title="Advertisement" scrolling="no" ` +
      `style="width:100%;height:100%;border:0;display:block" ` +
      `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe>` +
      adFrameScript(uid, slot.code) +
      `</div>`;
  }
  const styleAttr = style ? ` style="${style}"` : '';
  return `<div class="ad-slot"${styleAttr}><div class="ad-slot-label">Advertisement Slot</div><div class="ad-slot-hint">Reserved space — add a code at /admin/ads</div><!-- AD SLOT: ${id} --></div>`;
}
