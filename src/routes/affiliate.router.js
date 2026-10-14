// src/routes/affiliate.router.js
// GET /go/<slug>[?p=<placement>] — tracked affiliate redirect.
//
// The destination comes from the aff_offers row, NEVER from the request, so this
// endpoint cannot be turned into an open redirect. Crawlers, HEAD requests and the
// signed-in admin are redirected but not counted, so stats stay clean.

import { getSettings } from '../lib/platform/settings.js';
import { memoryRateLimit } from '../lib/platform/rate-limit.js';
import { verifyAdminCookie } from '../auth/admin-auth.js';
import { findLiveOfferBySlug, newClickId, buildDestination, recordClick, PLACEMENT_KEYS } from '../lib/affiliate/affiliate.js';

export const AFFILIATE_PREFIX = '/go/';
const BOT_RE = /bot|crawler|spider|slurp|headless|preview|facebookexternalhit|lighthouse|pingdom|curl|wget|python|scrapy|go-http|okhttp|axios|node-fetch/i;

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

export async function handleAffiliateRoute(url, request, env, ctx) {
  if (!url.pathname.startsWith(AFFILIATE_PREFIX)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  try {
    const settings = await getSettings(env);
    if (settings.affiliate_enabled !== '1') return notFound();
    const slug = decodeURIComponent(url.pathname.slice(AFFILIATE_PREFIX.length)).toLowerCase();
    const offer = await findLiveOfferBySlug(env, slug);
    if (!offer) return notFound();

    const clickId = newClickId();
    const requestedPlacement = url.searchParams.get('p') || '';
    const placement = PLACEMENT_KEYS.includes(requestedPlacement) ? requestedPlacement : 'direct';
    const destination = buildDestination(offer, { clickId, placement });
    if (!destination) return notFound();

    const ua = request.headers.get('User-Agent') || '';
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const countable = request.method === 'GET' && ua && !BOT_RE.test(ua) && !(await verifyAdminCookie(env, request.headers.get('Cookie')));
    // in-isolate flood guard: more than 30 counted clicks / 10 min / IP stop being counted
    if (countable && memoryRateLimit(`aff:${ip || 'x'}`, { maxRequests: 30, windowMinutes: 10 }).allowed) {
      let pagePath = '';
      try { const ref = new URL(request.headers.get('Referer') || ''); if (ref.host === url.host) pagePath = ref.pathname; } catch (e) {}
      const job = recordClick(env, offer, { clickId, placement, pagePath, ip, settings });
      if (ctx && ctx.waitUntil) ctx.waitUntil(job);
    }
    return new Response(null, { status: 302, headers: {
      Location: destination,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    } });
  } catch (e) { return notFound(); }
}
