// src/routes/admin/live.router.js
// /admin/analytics/live        → the Live Analytics page (HTML)
// /admin/analytics/live/data   → JSON feed polled by that page (GET only)
//
// MUST be registered BEFORE handleAdminAnalyticsRoute in admin.router.js,
// because that router answers 404 for anything under /admin/analytics.
// Read-only: no POST handlers, so no CSRF surface; the admin cookie is still
// verified here (defense in depth on top of the central gate).

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { adminShell } from '../../pages/admin/shell.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderLiveContent } from '../../pages/admin/live.js';
import { getLiveInit, getLiveDelta, getLiveSeries, parseSince, selfHostSet } from '../../lib/analytics/live.js';
import { getSettings } from '../../lib/platform/settings.js';
import { BASE_URL } from '../../config/constants.js';
import { errorPage } from './error-page.js';

const PAGE_PATH = '/admin/analytics/live';
const DATA_PATH = '/admin/analytics/live/data';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function handleAdminLiveRoute(url, request, env) {
  if (url.pathname !== PAGE_PATH && url.pathname !== DATA_PATH) return null;
  const isData = url.pathname === DATA_PATH;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  }
  try {
    const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
    if (!ok) {
      return isData
        ? json({ ok: false, error: 'unauthorized' }, 401)
        : new Response(renderAdminLogin(false), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    if (!isData) {
      return new Response(adminShell('live', await renderLiveContent(env)), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    const selfHosts = selfHostSet(url.hostname, new URL(BASE_URL).hostname);
    const mode = url.searchParams.get('mode') || 'delta';
    if (mode === 'init') return json(await getLiveInit(env, selfHosts, { force: url.searchParams.get('refresh') === '1' }));
    if (mode === 'series') {
      const settings = await getSettings(env);
      return json(await getLiveSeries(env, url.searchParams.get('days') === '30' ? 30 : 7, settings.analytics_timezone || 'UTC'));
    }
    if (mode === 'delta') return json(await getLiveDelta(env, parseSince(url.searchParams.get('since')), selfHosts));
    return json({ ok: false, error: 'unknown mode' }, 400);
  } catch (e) {
    if (isData) return json({ ok: false, error: 'live data unavailable' }, 500);
    return errorPage(e);
  }
}
