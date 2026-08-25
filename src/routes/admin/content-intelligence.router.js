// Phase 12.6 — protected, on-demand editorial analysis only.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { getPostById } from '../../lib/blog-cms.js';
import { getSettings } from '../../lib/settings.js';
import { checkRateLimit } from '../../lib/rate-limit.js';
import { logActivity } from '../../lib/activity-log.js';
import { analyzeContent, CONTENT_INTELLIGENCE_PROMPT_VERSION } from '../../lib/content-intelligence.js';

function redirectToEdit(id, message) {
  return new Response(null, { status: 302, headers: { Location: `/admin/blog/edit?id=${encodeURIComponent(id)}${message ? `&flash=${encodeURIComponent(message)}` : ''}` } });
}

export async function handleAdminContentIntelligenceRoute(url, request, env, base) {
  if (url.pathname !== '/admin/blog/content-intelligence' || request.method !== 'POST') return null;
  let id = '';
  try {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return new Response('Unauthorized', { status: 401 });
    const form = await request.formData();
    id = String(form.get('id') || '').replace(/[^0-9]/g, '').slice(0, 12);
    if (!id || Number(id) <= 0) return redirectToEdit('', 'Invalid article');
    const force = String(form.get('force') || '') === '1';
    const ip = String(request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 120);
    const rate = await checkRateLimit(env, `content-intelligence:${ip}`, { maxRequests: 5, windowMinutes: 15 });
    if (!rate.allowed) {
      await logActivity(env, 'admin_content_intelligence', 'rate_limited', { status: 'rate_limited', prompt_version: CONTENT_INTELLIGENCE_PROMPT_VERSION });
      return redirectToEdit(id, 'Content Intelligence rate-limited — try again later');
    }
    const post = await getPostById(env, Number(id), { includeUnpublished: true });
    if (!post) return redirectToEdit(id, 'Article not found');
    const result = await analyzeContent(env, 'blog_post', Number(id), post, await getSettings(env), { force });
    await logActivity(env, 'admin_content_intelligence', result.success ? 'success' : 'failed', { status: result.success ? 'success' : 'failed', error_code: result.error?.code || null, duration_ms: result.metadata?.duration_ms || 0, cache_hit: result.metadata?.cache_hit === true, prompt_version: CONTENT_INTELLIGENCE_PROMPT_VERSION });
    const message = result.success ? (result.metadata?.cache_hit ? 'Content review already up to date' : 'Content review generated') : (result.error?.message || 'Content review unavailable');
    return redirectToEdit(id, message);
  } catch (e) {
    await logActivity(env, 'admin_content_intelligence', 'failed', { status: 'error', error_code: 'ai_request_failed' });
    return redirectToEdit(id, 'Content Intelligence unavailable');
  }
}
