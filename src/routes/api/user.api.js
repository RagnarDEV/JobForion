// src/routes/api/user.api.js
// Account-aware endpoints: saved jobs, applications, session probe.
// Returns a Response, or null when the path is not this module's concern.

import { checkRateLimit } from '../../lib/platform/rate-limit.js';
import { getSessionUser } from '../../lib/accounts/session.js';
import { saveJob, unsaveJob, listSavedJobIds } from '../../lib/jobs/saved-jobs.js';
import { recordApplication } from '../../lib/jobs/applications.js';
import { recordTrustedAnalyticsEvent } from '../../lib/analytics/events.js';
import { readBoundedJson } from './shared.js';

export async function handleUserApi(url, request, env, ctx) {
  // ── Account-aware saved-jobs toggle ─────────────────────────────
  // Authenticated saves are persisted server-side so they survive across
  // devices. Anonymous clients are directed to the existing login flow by
  // the page renderers; this endpoint remains intentionally 401-only for
  // unauthenticated requests.
  if (url.pathname === '/api/user/saved-jobs' && request.method === 'GET') {
    const session = await getSessionUser(env, request);
    if (!session) return new Response(JSON.stringify({ success: false, error: 'Not signed in', job_ids: [] }), { status: 401, headers: { "Content-Type": "application/json" } });
    try {
      const job_ids = await listSavedJobIds(env, session.user.id);
      return new Response(JSON.stringify({ success: true, job_ids }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: 'Unable to load saved jobs', job_ids: [] }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (url.pathname === '/api/user/saved-jobs' && request.method === 'POST') {
    const session = await getSessionUser(env, request);
    if (!session) return new Response(JSON.stringify({ success: false, error: 'Not signed in' }), { status: 401, headers: { "Content-Type": "application/json" } });
    try {
      const rl = await checkRateLimit(env, `saved-jobs:${session.user.id}`, { maxRequests: 60, windowMinutes: 1, failClosed: true });
      if (!rl.allowed) return new Response(JSON.stringify({ success: false, error: 'Too many requests' }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String((rl.retryAfterMinutes || 1) * 60) } });
      const { job_id, action } = await readBoundedJson(request, 16 * 1024);
      const jobId = parseInt(job_id, 10);
      if (!Number.isInteger(jobId) || jobId <= 0 || jobId > 2147483647) return new Response(JSON.stringify({ success: false, error: 'job_id required' }), { status: 400, headers: { "Content-Type": "application/json" } });
      if (action !== 'unsave') {
        const { results } = await env.DB.prepare(`SELECT id FROM jobs WHERE id = ? AND status = 'active' LIMIT 1`).bind(jobId).all();
        if (!results?.length) return new Response(JSON.stringify({ success: false, error: 'Job is no longer available' }), { status: 404, headers: { "Content-Type": "application/json" } });
        await saveJob(env, session.user.id, jobId);
        const tracking = recordTrustedAnalyticsEvent(env, { event_type: 'job_favorite', job_id: jobId }, { user_id: session.user.id, country: request.cf?.country || 'XX', userAgent: request.headers.get('User-Agent') || '' }).catch(() => {});
        if (ctx?.waitUntil) ctx.waitUntil(tracking); else void tracking;
      } else await unsaveJob(env, session.user.id, jobId);
      return new Response(JSON.stringify({ success: true, saved: action !== 'unsave' }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, error: 'Invalid request' }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === '/api/user/applications' && request.method === 'POST') {
    const session = await getSessionUser(env, request);
    if (!session) return new Response(JSON.stringify({ success: false, error: 'Not signed in' }), { status: 401, headers: { "Content-Type": "application/json" } });
    try {
      const rl = await checkRateLimit(env, `applications:${session.user.id}`, { maxRequests: 30, windowMinutes: 1, failClosed: true });
      if (!rl.allowed) return new Response(JSON.stringify({ success: false, error: 'Too many requests' }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String((rl.retryAfterMinutes || 1) * 60) } });
      const { job_id, status, application_type } = await readBoundedJson(request, 16 * 1024);
      const jobId = parseInt(job_id, 10);
      if (!Number.isInteger(jobId) || jobId <= 0 || jobId > 2147483647) return new Response(JSON.stringify({ success: false, error: 'job_id required' }), { status: 400, headers: { "Content-Type": "application/json" } });
      const { results } = await env.DB.prepare(`SELECT id FROM jobs WHERE id = ? LIMIT 1`).bind(jobId).all();
      if (!results?.length) return new Response(JSON.stringify({ success: false, error: 'Job not found' }), { status: 404, headers: { "Content-Type": "application/json" } });
      const allowedStatuses = new Set(['saved', 'applied', 'viewed', 'interview', 'rejected', 'hired']);
      const nextStatus = allowedStatuses.has(String(status || 'applied')) ? String(status || 'applied') : 'applied';
      await recordApplication(env, session.user.id, jobId, { status: nextStatus, application_type: application_type === 'internal' ? 'internal' : 'external' });
      const tracking = recordTrustedAnalyticsEvent(env, { event_type: 'job_apply_click', job_id: jobId, metadata: { application_type: application_type === 'internal' ? 'internal' : 'external' } }, { user_id: session.user.id, country: request.cf?.country || 'XX', userAgent: request.headers.get('User-Agent') || '' }).catch(() => {});
      if (ctx?.waitUntil) ctx.waitUntil(tracking); else void tracking;
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, error: 'Invalid request' }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    const session = await getSessionUser(env, request);
    return new Response(JSON.stringify({ user: session ? { id: session.user.id, email: session.user.email, email_verified: session.user.email_verified } : null }), { headers: { "Content-Type": "application/json" } });
  }
  return null;
}
