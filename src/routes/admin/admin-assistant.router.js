// Phase 12.5 — protected, read-only Admin Assistant route.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { adminShell } from '../../pages/admin/shell.js';
import { renderAdminAssistantContent } from '../../pages/admin/assistant.js';
import { getSettings } from '../../lib/settings.js';
import { checkRateLimit } from '../../lib/rate-limit.js';
import { logActivity } from '../../lib/activity-log.js';
import { askAdminAssistant, ADMIN_ASSISTANT_LIMITS } from '../../lib/admin-assistant.js';

const HTML = { 'Content-Type': 'text/html; charset=utf-8' };

export async function handleAdminAssistantRoute(url, request, env, base) {
  if (url.pathname !== '/admin/assistant' || !['GET', 'POST'].includes(request.method)) return null;
  const authorized = await verifyAdminCookie(env, request.headers.get('Cookie'));
  if (!authorized) {
    if (request.method === 'GET') return new Response(renderAdminLogin(false), { headers: HTML });
    return new Response('Unauthorized', { status: 401 });
  }

  if (request.method === 'GET') {
    const error = url.searchParams.get('error') ? 'Admin Assistant could not complete that request. Please try again.' : '';
    return new Response(adminShell('assistant', await renderAdminAssistantContent(env, { error })), { headers: HTML });
  }

  let question = '';
  try {
    const form = await request.formData();
    question = String(form.get('question') || '').trim().slice(0, ADMIN_ASSISTANT_LIMITS.maxQuestionChars + 1);
    const ip = String(request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 120);
    const rate = await checkRateLimit(env, `admin-assistant:${ip}`, { maxRequests: ADMIN_ASSISTANT_LIMITS.maxRequests, windowMinutes: ADMIN_ASSISTANT_LIMITS.windowMinutes });
    if (!rate.allowed) {
      await logActivity(env, 'admin_career_assistant', 'rate_limited', { status: 'rate_limited' });
      return new Response(adminShell('assistant', await renderAdminAssistantContent(env, { question, error: 'Too many assistant requests. Please try again later.' })), { status: 429, headers: HTML });
    }
    const settings = await getSettings(env);
    const result = await askAdminAssistant(env, question, settings);
    await logActivity(env, 'admin_career_assistant', 'request', { status: result.success ? 'success' : 'failed', error_code: result.error?.code || null, duration_ms: result.metadata?.duration_ms || 0 });
    if (result.success) return new Response(adminShell('assistant', await renderAdminAssistantContent(env, { question, answer: result.data.answer })), { headers: HTML });
    return new Response(adminShell('assistant', await renderAdminAssistantContent(env, { question, error: result.error?.message || 'Admin Assistant could not complete that request.' })), { status: 400, headers: HTML });
  } catch (e) {
    await logActivity(env, 'admin_career_assistant', 'failed', { status: 'error', error_code: 'ai_request_failed' });
    return new Response(adminShell('assistant', await renderAdminAssistantContent(env, { question, error: 'Admin Assistant could not complete that request.' })), { status: 500, headers: HTML });
  }
}
