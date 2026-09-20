// src/routes/api/forms.api.js
// Public forms: job-alert subscription and employer job submissions.
// Returns a Response, or null when the path is not this module's concern.

import { checkRateLimit } from '../../lib/platform/rate-limit.js';
import { getSettings } from '../../lib/platform/settings.js';
import { safeExternalUrl } from '../../lib/directory/entities.js';
import { reportOperationalError } from '../../lib/platform/observability.js';
import { readBoundedJson, EMAIL_RE } from './shared.js';

export async function handleFormsApi(url, request, env, ctx) {
  if (url.pathname === '/api/subscribe' && request.method === 'POST') {
    try {
      // Feature Flag: Job Alerts — see lib/platform/settings.js. Turning this off
      // from /admin/settings stops new subscriptions immediately without
      // touching existing subscriber rows or the sync/cleanup crons.
      const settings = await getSettings(env);
      if (settings.feature_job_alerts === '0') {
        return new Response(JSON.stringify({ success: false, error: "Job alerts are currently disabled." }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(env, `subscribe:${ip}`, { maxRequests: 5, windowMinutes: 60 });
      if (!rl.allowed) {
        return new Response(JSON.stringify({ success: false, error: "Too many attempts. Please try again later." }), { status: 429, headers: { "Content-Type": "application/json" } });
      }
      const { email, keywords } = await readBoundedJson(request, 16 * 1024);
      const cleanEmail = String(email || '').trim().toLowerCase().slice(0, 254);
      const cleanKeywords = Array.isArray(keywords) ? keywords.map(value => String(value || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20) : [];
      if (!EMAIL_RE.test(cleanEmail) || !cleanKeywords.length) return new Response(JSON.stringify({ success: false, error: "Required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      await env.DB.prepare("INSERT OR REPLACE INTO subscribers (email,keywords) VALUES (?,?)").bind(cleanEmail, JSON.stringify(cleanKeywords)).run();
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      // SECURITY: never echo e.message to an anonymous caller — it can
      // contain raw D1/SQLite error text (column names, constraint
      // details). Log the real reason server-side only (visible in
      // Cloudflare's Observability tab) and return a generic message,
      // same pattern already used by /api/post-job below.
      reportOperationalError('api.subscribe', e);
      return new Response(JSON.stringify({ success: false, error: "Something went wrong. Please try again." }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (url.pathname === '/api/post-job' && request.method === 'POST') {
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(env, `post-job:${ip}`, { maxRequests: 3, windowMinutes: 60 });
      if (!rl.allowed) {
        return new Response(JSON.stringify({ success: false, error: "Too many submissions. Please try again later." }), { status: 429, headers: { "Content-Type": "application/json" } });
      }
      const b = await readBoundedJson(request, 32 * 1024);
      const title = (b.title || '').toString().slice(0, 150);
      const company = (b.company || '').toString().slice(0, 100);
      const email = (b.email || '').toString().trim().toLowerCase().slice(0, 254);
      const jobUrl = safeExternalUrl((b.url || '').toString().slice(0, 400));
      if (!title || !company || !EMAIL_RE.test(email) || !jobUrl) {
        return new Response(JSON.stringify({ success: false, error: "Please fill in all required fields." }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      await env.DB.prepare(
        `INSERT INTO job_postings (title,company,email,url,location,category,employment_type,remote_type,salary,description,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`
      ).bind(
        title, company, email, jobUrl,
        (b.location || '').toString().slice(0, 100),
        (b.category || '').toString().slice(0, 40),
        (b.employment_type || 'full_time').toString().slice(0, 40),
        (b.remote_type || 'fully_remote').toString().slice(0, 40),
        (b.salary || '').toString().slice(0, 60),
        (b.description || '').toString().slice(0, 4000)
      ).run();
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, error: "Something went wrong. Please try again." }), { status: 500, headers: { "Content-Type": "application/json" } }); }
  }
  return null;
}
