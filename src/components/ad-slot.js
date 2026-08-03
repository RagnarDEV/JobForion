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
// own blank, same-page <iframe>; the Adsterra snippet is written into
// that iframe's OWN document via JS (iframe.contentDocument.write()).
// Chrome's slow-connection intervention only targets document.write()
// reached through a parser-blocking script tag in the top-level
// document — a JS-created iframe's document is exempt, so the ad renders
// correctly regardless of connection speed. As a side benefit, each ad
// now also gets a fully isolated `window`/`atOptions`, so two different
// ad slots on the same page (job-detail-inline + job-detail-footer) can
// never step on each other's config even in edge-case load orders.
// SECURITY/CORRECTNESS: the Adsterra snippet embedded in `code` contains
// literal `</script>` tags. JSON.stringify() does NOT escape "/", so
// naively dropping JSON.stringify(code) inside a real HTML <script>
// element would let the HTML parser see that literal "</script>" and
// close OUR wrapping script tag early — corrupting the page and silently
// breaking every ad slot rendered after it. Escaping "<" to its unicode
// form keeps the JS string value byte-for-byte identical at runtime
// while making that break-out impossible (same technique already used
// in pages/job-page.js's safeJsonLd for the same class of issue).
function safeJsForScriptTag(str) {
  return JSON.stringify(str).replace(/</g, '\\u003c');
}

function adFrameScript(uid, code) {
  return `<script>(function(){
  var f=document.getElementById(${JSON.stringify(uid)});
  if(!f)return;
  try{
    var d=f.contentWindow.document;
    d.open();
    d.write(${safeJsForScriptTag(code)});
    d.close();
  }catch(e){}
})();</script>`;
}

export function adSlot(id, style = '') {
  const code = ADS[id];
  if (code) {
    const size = AD_SIZE[id] || { w: 300, h: 250 };
    const uid = `adf_${id.replace(/[^a-z0-9]/gi, '')}`;
    const boxStyle = `width:${size.w}px;height:${size.h}px;max-width:100%;margin:16px auto;${style}`;
    return `<div class="ad-slot ad-slot-live" style="${boxStyle}">` +
      `<iframe id="${uid}" title="Advertisement" scrolling="no" ` +
      `style="width:100%;height:100%;border:0;display:block" ` +
      `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>` +
      adFrameScript(uid, code) +
      `</div>`;
  }
  const styleAttr = style ? ` style="${style}"` : '';
  return `<div class="ad-slot"${styleAttr}><div class="ad-slot-label">Advertisement Slot</div><div class="ad-slot-hint">Reserved space — insert your ad network snippet here</div><!-- AD SLOT: ${id} --></div>`;
}
