// src/routes/admin/job-intelligence.router.js
// Phase 12.2 — protected, on-demand Job Intelligence only.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { checkRateLimit } from '../../lib/rate-limit.js';
import { getSettings } from '../../lib/settings.js';
import { logActivity } from '../../lib/activity-log.js';
import { analyzeJobIntelligence } from '../../lib/job-intelligence.js';

const MAX_REQUESTS = 5;
const WINDOW_MINUTES = 15;

function redirectToEdit(id, message) {
  const query = message ? `&flash=${encodeURIComponent(message)}` : '';
  return new Response(null, { status: 302, headers: { Location: `/admin/jobs/edit?id=${encodeURIComponent(id)}${query}` } });
}

export async function handleAdminJobIntelligenceRoute(url, request, env, base) {
  if (url.pathname !== '/admin/jobs/intelligence' || request.method !== 'POST') return null;

  let jobId = '';
  try {
    const authorized = await verifyAdminCookie(env, request.headers.get('Cookie'));
    if (!authorized) return new Response('Unauthorized', { status: 401 });

    const form = await request.formData();
    const force = String(form.get('force') || '') === '1';
    jobId = String(form.get('id') || '').replace(/[^0-9]/g, '').slice(0, 12);
    if (!jobId || Number(jobId) <= 0) return redirectToEdit('', 'Invalid job');

    const ip = String(request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 120);
    const rate = await checkRateLimit(env, `ai-job-intelligence:${ip}`, {
      maxRequests: MAX_REQUESTS,
      windowMinutes: WINDOW_MINUTES,
    });
    if (!rate.allowed) {
      await logActivity(env, 'ai_job_intelligence', 'rate_limited', { status: 'rate_limited' });
      return redirectToEdit(jobId, `Job Intelligence rate-limited — retry in ${rate.retryAfterMinutes || 1} minute(s)`);
    }

    const { results } = await env.DB.prepare('SELECT * FROM jobs WHERE id = ? LIMIT 1').bind(Number(jobId)).all();
    const job = results?.[0];
    if (!job) return redirectToEdit(jobId, 'Job not found');

    const settings = await getSettings(env);
    const result = await analyzeJobIntelligence(env, job, settings, { force });
    await logActivity(env, 'ai_job_intelligence', result.success ? 'success' : 'failed', {
      status: result.success ? 'success' : 'error',
      error_code: result.error?.code || null,
      duration_ms: result.metadata?.duration_ms || 0,
      cache_hit: result.metadata?.cache_hit === true,
    });

    const message = result.success
      ? (result.metadata?.cache_hit ? 'Job Intelligence already up to date' : 'Job Intelligence generated')
      : `Job Intelligence unavailable (${result.error?.code || 'error'})`;
    return redirectToEdit(jobId, message);
  } catch (e) {
    await logActivity(env, 'ai_job_intelligence', 'failed', { status: 'error', error_code: 'ai_request_failed' });
    return redirectToEdit(jobId, 'Job Intelligence unavailable');
  }
}
