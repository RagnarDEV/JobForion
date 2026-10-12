// src/lib/content/ad-origin.js
// ════════════════════════════════════════════════════════════════
// Optional dedicated origin for ad iframes (env var AD_FRAME_ORIGIN, e.g.
// https://ads.jobforion.com).
//
// WHY: ad networks frequently refuse to run inside an iframe sandboxed WITHOUT
// `allow-same-origin` (opaque origin: no storage/cookies, odd referrer checks)
// and then render an empty box. Granting `allow-same-origin` on the SAME origin
// as the site would let pasted ad code touch the site — so the ad document is
// instead served from a separate host-only origin (a sub-domain of the site, so
// the ad network still sees the approved domain). Site cookies are host-only
// (never `Domain=`), hence invisible to that origin, and the ads host serves
// nothing except /ad-frame/* (everything else redirects to the main site).
//
// Unset/invalid => '' => the strict opaque-origin sandbox is used (old behaviour).
// ════════════════════════════════════════════════════════════════

import { BASE_URL } from '../../config/constants.js';

let adOrigin = '';

export function resolveAdFrameOrigin(env) {
  const raw = String(env?.AD_FRAME_ORIGIN || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const main = new URL(BASE_URL);
    // https only; must be a DIFFERENT host that lives under the site's own domain.
    if (u.protocol !== 'https:' || u.hostname === main.hostname) return '';
    if (!u.hostname.endsWith(`.${main.hostname}`)) return '';
    return u.origin;
  } catch (e) { return ''; }
}

// Called once per request from index.js (cheap, idempotent) so pure render
// functions like adSlot() can stay synchronous and env-free.
export function configureAdFrame(env) { adOrigin = resolveAdFrameOrigin(env); }
export function getAdFrameOrigin() { return adOrigin; }
