// src/routes/api/monetization.api.js
// Monetization: catalog, server-priced orders, entitlements, affiliate clicks and the trusted payment webhook boundary.
// Returns a Response, or null when the path is not this module's concern.

import { checkRateLimit } from '../../lib/platform/rate-limit.js';
import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { getSessionUser } from '../../lib/accounts/session.js';
import { verifyCsrf } from '../../lib/accounts/csrf.js';
import { listProducts, createPendingOrder, listUserOrders, listUserEntitlements, getMonetizationOverview, getRevenueAnalytics, verifyPaymentWebhook, processPaymentWebhook, createAffiliateClick } from '../../lib/monetization/core.js';
import { readBoundedText, readBoundedJson, jsonResponse } from './shared.js';

export async function handleMonetizationApi(url, request, env, ctx) {
  // ── Monetization: public catalog, server-priced pending orders, and
  // trusted webhook boundary. No endpoint accepts client price/currency as
  // authoritative and no endpoint marks an order paid from browser input. ──
  if (url.pathname === '/api/monetization/products' && request.method === 'GET') {
    return jsonResponse({ products: await listProducts(env, { activeOnly: true }) });
  }
  if (url.pathname === '/api/monetization/orders' && request.method === 'POST') {
    const session = await getSessionUser(env, request);
    if (!session) return jsonResponse({ success: false, error: 'Not signed in.' }, 401);
    try {
      const body = await readBoundedJson(request, 64 * 1024);
      const csrfToken = request.headers.get('X-CSRF-Token') || body._csrf || '';
      if (!await verifyCsrf(env, session.sessionId, String(csrfToken))) return jsonResponse({ success: false, error: 'Invalid CSRF token.' }, 403);
      const rl = await checkRateLimit(env, `monetization-order:${session.user.id}`, { maxRequests: 10, windowMinutes: 10, failClosed: true });
      if (!rl.allowed) return jsonResponse({ success: false, error: 'Too many checkout attempts.' }, 429);
      const result = await createPendingOrder(env, session.user, body);
      return jsonResponse(result, result.ok ? 202 : (result.status || 400));
    } catch (e) { return jsonResponse({ success: false, error: 'Invalid order request.' }, 400); }
  }
  if (url.pathname === '/api/monetization/orders' && request.method === 'GET') {
    const session = await getSessionUser(env, request);
    if (!session) return jsonResponse({ success: false, error: 'Not signed in.' }, 401);
    return jsonResponse({ orders: await listUserOrders(env, session.user.id) });
  }
  if (url.pathname === '/api/monetization/entitlements' && request.method === 'GET') {
    const session = await getSessionUser(env, request);
    if (!session) return jsonResponse({ success: false, error: 'Not signed in.' }, 401);
    return jsonResponse({ entitlements: await listUserEntitlements(env, session.user.id) });
  }
  if (url.pathname === '/api/monetization/analytics' && request.method === 'GET') {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    return jsonResponse({ overview: await getMonetizationOverview(env), revenue: await getRevenueAnalytics(env, url.searchParams.get('days')) });
  }
  if (url.pathname === '/api/monetization/transactions' && request.method === 'GET') {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    try { const { results } = await env.DB.prepare('SELECT t.*, o.order_ref, p.name product_name FROM monetization_transactions t LEFT JOIN monetization_orders o ON o.id=t.order_id LEFT JOIN monetization_products p ON p.id=o.product_id ORDER BY t.id DESC LIMIT 100').all(); return jsonResponse({ transactions: results || [] }); } catch (e) { return jsonResponse({ transactions: [] }); }
  }
  if (url.pathname === '/api/monetization/refunds' && request.method === 'GET') {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    try { const { results } = await env.DB.prepare('SELECT r.*, o.order_ref FROM monetization_refunds r LEFT JOIN monetization_orders o ON o.id=r.order_id ORDER BY r.id DESC LIMIT 100').all(); return jsonResponse({ refunds: results || [] }); } catch (e) { return jsonResponse({ refunds: [] }); }
  }
  if (url.pathname === '/api/monetization/campaigns' && request.method === 'GET') {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    try { const { results } = await env.DB.prepare('SELECT * FROM monetization_campaigns ORDER BY id DESC LIMIT 100').all(); return jsonResponse({ campaigns: results || [] }); } catch (e) { return jsonResponse({ campaigns: [] }); }
  }
  if (url.pathname === '/api/monetization/affiliate-click' && request.method === 'POST') {
    try {
      const rl = await checkRateLimit(env, `affiliate-click:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, { maxRequests: 60, windowMinutes: 10 });
      if (!rl.allowed) return jsonResponse({ success: false, error: 'Too many requests.' }, 429);
      const result = await createAffiliateClick(env, await readBoundedJson(request, 16 * 1024), request);
      return jsonResponse(result, result.ok ? 200 : 400);
    } catch (e) { return jsonResponse({ success: false, error: 'Invalid affiliate click.' }, 400); }
  }
  if (url.pathname === '/api/monetization/webhook' && request.method === 'POST') {
    const rl = await checkRateLimit(env, `payment-webhook:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, { maxRequests: 120, windowMinutes: 5, failClosed: true });
    if (!rl.allowed) return jsonResponse({ success: false, error: 'Too many webhook attempts.' }, 429);
    const rawBody = await readBoundedText(request);
    if (rawBody === null) return jsonResponse({ success: false, error: 'Webhook payload is too large.' }, 413);
    const verified = await verifyPaymentWebhook(env, rawBody, request.headers);
    if (!verified.ok) return jsonResponse({ success: false, error: verified.error }, verified.status);
    try {
      const result = await processPaymentWebhook(env, JSON.parse(rawBody));
      return jsonResponse(result, result.ok ? 200 : (result.status || 400));
    } catch (e) { return jsonResponse({ success: false, error: 'Invalid webhook payload.' }, 400); }
  }
  return null;
}
