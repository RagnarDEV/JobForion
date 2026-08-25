// src/routes/admin/ai.router.js
// Phase 12.1 only: one authorized, non-public smoke test for the central AI
// service. No future job intelligence or chatbot endpoint belongs here.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { checkRateLimit } from '../../lib/rate-limit.js';
import { getSettings } from '../../lib/settings.js';
import { logActivity } from '../../lib/activity-log.js';
import {
  AI_LIMITS,
  DEFAULT_SMOKE_INPUT,
  FOUNDATION_SMOKE_TASK,
  runAiRequest,
} from '../../lib/ai-service.js';

export async function handleAdminAiRoute(url, request, env, base) {
  if (url.pathname !== '/admin/system/ai-smoke-test' || request.method !== 'POST') return null;

  try {
    const authorized = await verifyAdminCookie(env, request.headers.get('Cookie'));
    if (!authorized) return new Response('Unauthorized', { status: 401 });

    const ip = String(request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 120);
    const rate = await checkRateLimit(env, `ai-smoke:${ip}`, {
      maxRequests: AI_LIMITS.smokeRequests,
      windowMinutes: AI_LIMITS.smokeWindowMinutes,
    });
    if (!rate.allowed) {
      await logActivity(env, 'ai_smoke_test', 'rate_limited', { status: 'rate_limited' });
      return new Response(null, { status: 302, headers: { Location: `/admin/system?flash=${encodeURIComponent(`AI smoke test rate-limited — retry in ${rate.retryAfterMinutes || 1} minute(s)`)}` } });
    }

    const settings = await getSettings(env);
    const result = await runAiRequest(env, {
      task: FOUNDATION_SMOKE_TASK,
      input: DEFAULT_SMOKE_INPUT,
      context: { source: 'authorized_admin_smoke_test' },
      options: { maxTokens: 160, temperature: 0.2 },
    }, { feature: FOUNDATION_SMOKE_TASK, settings, cache: false });

    await logActivity(env, 'ai_smoke_test', result.success ? 'success' : 'failed', {
      status: result.success ? 'success' : 'error',
      error_code: result.error?.code || null,
      duration_ms: result.metadata?.duration_ms || 0,
    });

    const message = result.success
      ? `AI smoke test passed (${result.metadata?.duration_ms || 0}ms)`
      : `AI smoke test unavailable (${result.error?.code || 'error'})`;
    return new Response(null, { status: 302, headers: { Location: `/admin/system?flash=${encodeURIComponent(message)}` } });
  } catch (e) {
    await logActivity(env, 'ai_smoke_test', 'failed', { status: 'error', error_code: 'ai_request_failed' });
    return new Response(null, { status: 302, headers: { Location: `/admin/system?flash=${encodeURIComponent('AI smoke test unavailable')}` } });
  }
}
