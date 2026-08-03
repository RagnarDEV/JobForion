// src/components/ad-slot.js
// Single source of truth for every advertisement placement on JobForion.
// Every page imports adSlot(id) and drops it wherever an ad belongs — the
// actual ad network embed code (Adsterra or any future network) is edited
// in ONE place, the ADS map below, instead of hunting through five
// different page files every time it changes.
//
// To activate a real ad: paste the network's exact embed code (script
// tags, etc.) as the value for that slot's id in ADS. Leave it as '' to
// keep showing the reserved placeholder box instead — nothing breaks
// either way, so slots can be turned on one at a time.
//
// Current slots in use (see each page for exact position):
//   'homepage-results-top'   — src/pages/home.js, above the job list
//   'job-detail-inline'      — src/pages/job-page.js, after the description (reserved 320×50)
//   'job-detail-footer'      — src/pages/job-page.js, after "Similar Jobs"
//   'blog-index-top'         — src/pages/blog.js, above the article grid
//   'blog-article-footer'    — src/pages/blog.js, after each article body

// Banner 300×250 (Adsterra key: 69d7d3b2e8807dbd363b797829276c0c) — used for
// every slot except the one explicitly reserved at 320×50.
const BANNER_300x250 = `<script>
atOptions = {
  'key' : '69d7d3b2e8807dbd363b797829276c0c',
  'format' : 'iframe',
  'height' : 250,
  'width' : 300,
  'params' : {}
};
</script>
<script src="https://www.highperformanceformat.com/69d7d3b2e8807dbd363b797829276c0c/invoke.js"></script>`;

// Banner 320×50 (Adsterra key: 136b80686b183d9484dc35c4136e3b57) — the
// mobile-friendly size reserved specifically for job-detail-inline.
const BANNER_320x50 = `<script>
atOptions = {
  'key' : '136b80686b183d9484dc35c4136e3b57',
  'format' : 'iframe',
  'height' : 50,
  'width' : 320,
  'params' : {}
};
</script>
<script src="https://www.highperformanceformat.com/136b80686b183d9484dc35c4136e3b57/invoke.js"></script>`;

const ADS = {
  'homepage-results-top': BANNER_320x50,
  'job-detail-inline': BANNER_320x50,
  'job-detail-footer': BANNER_300x250,
  'blog-index-top': BANNER_300x250,
  'blog-article-footer': BANNER_300x250,
};

// Declared creative size per slot — MUST match the width/height each slot's
// atOptions above actually requests from Adsterra.
const AD_SIZE = {
  'homepage-results-top': { w: 320, h: 50 },
  'job-detail-inline': { w: 320, h: 50 },
  'job-detail-footer': { w: 300, h: 250 },
  'blog-index-top': { w: 300, h: 250 },
  'blog-article-footer': { w: 300, h: 250 },
};

// RELIABILITY: third-party ad networks occasionally return a "no fill",
// mismatched-size, or broken creative — especially on slow/flaky mobile
// connections, or when an ad blocker on the visitor's device intercepts
// the highperformanceformat.com script/iframe partway through loading.
// Previously the live-ad container had no fixed dimensions, so a broken
// creative was free to render as a large blank box with a browser
// "broken image" icon stretched across the full content width — very
// visible and unprofessional. Every live slot now gets a hard-clipped
// box sized to exactly what it asked Adsterra for (`overflow:hidden` +
// fixed width/height, capped to the viewport with max-width:100% so it
// can never force horizontal scroll on narrow phones). A failed ad is
// now, worst case, a small contained gray box the size of a banner —
// never a layout-breaking one. This is a client-side, defensive fix;
// it does not address WHY a given impression failed to fill (that's an
// Adsterra dashboard / ad-blocker / network question — see notes above
// each BANNER_ const for the zone keys to check).
export function adSlot(id, style = '') {
  const code = ADS[id];
  if (code) {
    const size = AD_SIZE[id] || { w: 300, h: 250 };
    const boxStyle = `width:${size.w}px;height:${size.h}px;max-width:100%;margin:16px auto;${style}`;
    return `<div class="ad-slot ad-slot-live" style="${boxStyle}">${code}</div>`;
  }
  const styleAttr = style ? ` style="${style}"` : '';
  return `<div class="ad-slot"${styleAttr}><div class="ad-slot-label">Advertisement Slot</div><div class="ad-slot-hint">Reserved space — insert your ad network snippet here</div><!-- AD SLOT: ${id} --></div>`;
}
