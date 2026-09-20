// src/routes/api/analytics.api.js
// Admin analytics API + first-party analytics event intake.
// Returns a Response, or null when the path is not this module's concern.

import { checkRateLimit } from '../../lib/platform/rate-limit.js';
import { getSettings } from '../../lib/platform/settings.js';
import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { getSessionUser } from '../../lib/accounts/session.js';
import { getRevenueAnalytics } from '../../lib/monetization/core.js';
import { enqueueAnalyticsEvents, getAnalyticsOverview, getAnalyticsReport, getAnalyticsFunnel, getAnalyticsSearches, getAnalyticsFilters, getAnalyticsRealtime, getAnalyticsAlerts, getAnalyticsHealth, getAnalyticsTrends, getAnalyticsTopJobs, getAnalyticsTopCompanies, rowsToCsv } from '../../lib/analytics/events.js';
import { readBoundedJson, jsonResponse } from './shared.js';

export async function handleAnalyticsApi(url, request, env, ctx) {
  // ── Protected Admin Analytics API ───────────────────────────────
  if (url.pathname.startsWith('/api/admin/analytics')) {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    const adminAnalyticsRl = await checkRateLimit(env, `admin-analytics:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, { maxRequests: 120, windowMinutes: 1, failClosed: true });
    if (!adminAnalyticsRl.allowed) return jsonResponse({ success: false, error: 'Too many analytics requests.' }, 429, { 'Retry-After': String((adminAnalyticsRl.retryAfterMinutes || 1) * 60) });
    const input = { preset: url.searchParams.get('preset') || '30d', from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '', timeZone: (await getSettings(env)).analytics_timezone };
    if (url.pathname === '/api/admin/analytics/overview') return jsonResponse(await getAnalyticsOverview(env, input));
    if (url.pathname === '/api/admin/analytics/traffic') return jsonResponse({ ...(await getAnalyticsReport(env, 'traffic', input)), trends: await getAnalyticsTrends(env, input) });
    if (url.pathname === '/api/admin/analytics/jobs') return jsonResponse(await getAnalyticsTopJobs(env, input));
    if (url.pathname === '/api/admin/analytics/companies') return jsonResponse(await getAnalyticsTopCompanies(env, input));
    if (url.pathname === '/api/admin/analytics/searches') return jsonResponse(await getAnalyticsSearches(env, input));
    if (url.pathname === '/api/admin/analytics/filters') return jsonResponse(await getAnalyticsFilters(env, input));
    if (url.pathname === '/api/admin/analytics/funnel') return jsonResponse(await getAnalyticsFunnel(env, input));
    if (url.pathname === '/api/admin/analytics/geography') return jsonResponse(await getAnalyticsReport(env, 'geography', input));
    if (url.pathname === '/api/admin/analytics/devices') return jsonResponse(await getAnalyticsReport(env, 'devices', input));
    if (url.pathname === '/api/admin/analytics/realtime') return jsonResponse({ events: await getAnalyticsRealtime(env) });
    if (url.pathname === '/api/admin/analytics/alerts') return jsonResponse({ alerts: await getAnalyticsAlerts(env), health: await getAnalyticsHealth(env) });
    if (url.pathname === '/api/admin/analytics/revenue') return jsonResponse(await getRevenueAnalytics(env, url.searchParams.get('days') || 30));
    if (url.pathname === '/api/admin/analytics/payments') { try { const { results } = await env.DB.prepare(`SELECT status,COUNT(*) count,SUM(gross_amount_minor) amount FROM monetization_transactions GROUP BY status`).all(); return jsonResponse({ rows: results || [] }); } catch (e) { return jsonResponse({ rows: [] }); } }
    if (url.pathname === '/api/admin/analytics/affiliate') { try { const { results } = await env.DB.prepare(`SELECT program_id,COUNT(*) clicks,COUNT(DISTINCT ip_hash) unique_clicks FROM affiliate_clicks GROUP BY program_id ORDER BY clicks DESC`).all(); return jsonResponse({ rows: results || [] }); } catch (e) { return jsonResponse({ rows: [] }); } }
    if (url.pathname === '/api/admin/analytics/export') {
      const type = url.searchParams.get('type') || 'traffic';
      let data;
      if (type === 'jobs') data = await getAnalyticsTopJobs(env, input); else if (type === 'companies') data = await getAnalyticsTopCompanies(env, input); else if (type === 'searches') data = await getAnalyticsSearches(env, input); else if (type === 'filters') data = await getAnalyticsFilters(env, input); else data = await getAnalyticsReport(env, 'traffic', input);
      return new Response(rowsToCsv(data.rows || []), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="jobforion-${type}-analytics.csv"` } });
    }
    return jsonResponse({ success: false, error: 'Not found.' }, 404);
  }

  // ── First-party analytics event intake ──────────────────────────
  // This endpoint accepts only the strict whitelist from lib/analytics/events.js;
  // it never accepts authoritative revenue, payment state, role, or owner IDs.
  if (url.pathname === '/api/analytics/events' && request.method === 'POST') {
    try {
      const rl = await checkRateLimit(env, `analytics:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, { maxRequests: 120, windowMinutes: 10 });
      if (!rl.allowed) return jsonResponse({ accepted: 0, error: 'Too many analytics events.' }, 429);
      const body = await readBoundedJson(request, 64 * 1024);
      const settings = await getSettings(env);
      const session = request.headers.get('Cookie') ? await getSessionUser(env, request) : null;
      const events = Array.isArray(body?.events) ? body.events : [body];
      const result = await enqueueAnalyticsEvents(env, events, { user_id: session?.user?.id || null, country: request.cf?.country || 'XX', timeZone: settings.analytics_timezone, userAgent: request.headers.get('User-Agent') || '', settings });
      return jsonResponse({ accepted: result.accepted || 0 });
    } catch (e) { return jsonResponse({ accepted: 0 }); }
  }
  return null;
}
