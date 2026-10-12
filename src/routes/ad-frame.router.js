// src/routes/ad-frame.router.js
// ════════════════════════════════════════════════════════════════
// /ad-frame/<slot-id> — the document rendered INSIDE each ad iframe.
//
// WHY A ROUTE INSTEAD OF `srcdoc` (root cause of "ads don't show"):
// an iframe created from `srcdoc` INHERITS the parent page's
// Content-Security-Policy. The site CSP is deliberately strict
// (`default-src 'self'`, a tiny img-src/connect-src/frame-src allow-list),
// but an ad network's invoke.js loads its creative from rotating third-party
// domains (scripts, images, nested iframes, beacons). Every one of those was
// silently blocked by the inherited policy, so the box stayed empty.
//
// Serving the ad document from its own same-origin URL gives it its OWN,
// ad-appropriate CSP while the surrounding site keeps the strict one.
// Isolation is unchanged: the document is sandboxed WITHOUT allow-same-origin,
// so (like before) it runs in an opaque origin and can never read the
// site's cookies, storage or DOM — even if an admin pastes hostile code.
// ════════════════════════════════════════════════════════════════

import { AD_SLOT_DEFS, getAdSlotsConfig } from '../lib/content/ad-slots.js';
import { getSettings } from '../lib/platform/settings.js';
import { getAdFrameOrigin } from '../lib/content/ad-origin.js';
import { BASE_URL } from '../config/constants.js';

export const AD_FRAME_PREFIX = '/ad-frame/';

// Opaque-origin sandbox by default; `allow-same-origin` only when the document is
// served from the dedicated ad origin (cross-origin to the site — see ad-origin.js).
function adFrameCsp(onAdHost) {
  return [
    `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation${onAdHost ? ' allow-same-origin' : ''}`,
    // Ad networks load code/creatives from many rotating hosts — allow them HERE only.
    "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
    `frame-ancestors 'self' ${BASE_URL}`,
  ].join('; ');
}

const EMPTY_DOC = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

function frameResponse(html, status = 200, cache = 'public, max-age=300', onAdHost = false) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': cache,
      'Content-Security-Policy': adFrameCsp(onAdHost),
      'X-Ad-Frame': '1', // tells withSecurityHeaders() to keep this route's own CSP
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function handleAdFrameRoute(url, request, env) {
  if (!url.pathname.startsWith(AD_FRAME_PREFIX)) return null;
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const adOrigin = getAdFrameOrigin();
  const onAdHost = !!adOrigin && url.origin === adOrigin;
  const id = url.pathname.slice(AD_FRAME_PREFIX.length);
  if (!AD_SLOT_DEFS.some(def => def.id === id)) return frameResponse(EMPTY_DOC, 404, 'no-store', onAdHost);
  try {
    const [config, settings] = await Promise.all([getAdSlotsConfig(env), getSettings(env)]);
    const slot = config[id];
    if (settings.ads_enabled === '0' || !slot || !slot.enabled || !slot.code) return frameResponse(EMPTY_DOC, 200, 'public, max-age=300', onAdHost);
    return frameResponse(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}body{display:flex;justify-content:center;align-items:flex-start}</style>` +
      `</head><body>${slot.code}</body></html>`,
      200, 'public, max-age=300', onAdHost
    );
  } catch (e) {
    return frameResponse(EMPTY_DOC, 200, 'no-store', onAdHost);
  }
}
