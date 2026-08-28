import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAnalyticsContent } from '../../pages/admin/analytics.js';
import { purgeAnalytics, resolveAnalyticsAlert } from '../../lib/analytics.js';
import { errorPage } from './error-page.js';
import { adminShell } from '../../pages/admin/shell.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { setSettings } from '../../lib/settings.js';
import { logActivity } from '../../lib/activity-log.js';

export async function handleAdminAnalyticsRoute(url, request, env, base) {
  if (!url.pathname.startsWith('/admin/analytics')) return null;
  try {
    const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
    if (!ok) return request.method === 'GET' ? new Response(renderAdminLogin(false), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : new Response('Unauthorized', { status: 401 });
    if (url.pathname === '/admin/analytics/settings' && request.method === 'POST') {
      const form = await request.formData();
      await setSettings(env, {
        analytics_enabled: form.get('analytics_enabled') || '0',
        analytics_retention: form.get('analytics_retention') || '90',
        analytics_timezone: form.get('analytics_timezone') || 'UTC',
        analytics_sample_rate: form.get('analytics_sample_rate') || '100',
        analytics_alert_traffic_drop_pct: form.get('analytics_alert_traffic_drop_pct') || '30',
        analytics_alert_apply_drop_pct: form.get('analytics_alert_apply_drop_pct') || '20',
        analytics_alert_payment_failure_pct: form.get('analytics_alert_payment_failure_pct') || '15',
      });
      await logActivity(env, 'analytics_settings_updated', 'analytics');
      return new Response(null, { status: 302, headers: { Location: '/admin/analytics' } });
    }
    if (url.pathname === '/admin/analytics/purge' && request.method === 'POST') {
      const form = await request.formData();
      if (form.get('confirm') !== '1') return new Response('Explicit confirmation is required.', { status: 400 });
      const result = await purgeAnalytics(env, { before: String(form.get('before') || '') });
      if (!result.ok) return new Response(result.error || 'Unable to purge analytics data.', { status: 400 });
      await logActivity(env, 'analytics_data_purged', 'analytics', { before: result.before, deleted: result.deleted });
      return new Response(null, { status: 302, headers: { Location: '/admin/analytics' } });
    }
    if (url.pathname === '/admin/analytics/alerts/resolve' && request.method === 'POST') {
      const form = await request.formData();
      await resolveAnalyticsAlert(env, form.get('alert_id'));
      await logActivity(env, 'analytics_alert_resolved', String(form.get('alert_id') || ''));
      return new Response(null, { status: 302, headers: { Location: '/admin/analytics' } });
    }
    if (url.pathname === '/admin/analytics' && request.method === 'GET') return new Response(adminShell('analytics', await renderAnalyticsContent(env, url)), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return new Response('Not found', { status: 404 });
  } catch (e) { return errorPage(e); }
}
