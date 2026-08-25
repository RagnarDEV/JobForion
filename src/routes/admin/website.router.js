// src/routes/admin/website.router.js
// Website — Homepage Sections Builder (Admin Dashboard V2 Phase 4), Job
// Card Style Manager, and the central Settings page (general/SEO/hero/
// maintenance/feature flags). See admin.router.js for how every
// admin/*.router.js sub-router is composed.

import { verifyAdminCookie, getAdminCsrfToken, verifyAdminCsrf } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderHomepageBuilderContent } from '../../pages/admin/homepage.js';
import { renderCardStylesContent } from '../../pages/admin/card-styles.js';
import { renderSettingsContent } from '../../pages/admin/settings.js';
import { adminShell } from '../../pages/admin/shell.js';
import { setHomepageSectionEnabled, moveHomepageSection } from '../../lib/homepage-sections.js';
import { updateCardStyle, resetCardStyle, CARD_STYLE_JOB_TYPES } from '../../lib/job-card-styles.js';
import { setSettings, SETTINGS_KEYS, CHECKBOX_SETTINGS_KEYS, THEME_DEFAULTS } from '../../lib/settings.js';
import { logActivity } from '../../lib/activity-log.js';
import { errorPage } from './error-page.js';

export async function handleAdminWebsiteRoute(url, request, env, base) {
  if (url.pathname === '/admin/homepage' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderHomepageBuilderContent(env);
      return new Response(adminShell('homepage', content, await getAdminCsrfToken(env, request.headers.get('Cookie'))), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/homepage/toggle' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      const key = (form.get('key') || '').toString();
      const enabled = form.get('enabled') === '1';
      await setHomepageSectionEnabled(env, key, enabled);
      await logActivity(env, 'homepage_section_toggled', `${key} → ${enabled ? 'enabled' : 'disabled'}`);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/homepage?flash=${encodeURIComponent('Homepage updated')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/homepage/move' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      const key = (form.get('key') || '').toString();
      const direction = (form.get('direction') || '').toString();
      if (direction === 'up' || direction === 'down') {
        await moveHomepageSection(env, key, direction);
        await logActivity(env, 'homepage_section_moved', `${key} → ${direction}`);
      }
      return new Response(null, { status: 302, headers: { 'Location': '/admin/homepage' } });
    } catch (e) { return errorPage(e); }
  }

  // ── System (see pages/admin/system.js) ─────────────────────────────
  if (url.pathname === '/admin/card-styles' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderCardStylesContent(env);
      return new Response(adminShell('card-styles', content, await getAdminCsrfToken(env, request.headers.get('Cookie'))), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/card-styles/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      const jobType = (form.get('job_type') || '').toString();
      if (!CARD_STYLE_JOB_TYPES.includes(jobType)) return new Response('Invalid job type', { status: 400 });
      await updateCardStyle(env, jobType, {
        bg_type: (form.get('bg_type') || '').toString(),
        bg_color1: (form.get('bg_color1') || '').toString(),
        bg_color2: (form.get('bg_color2') || '').toString(),
        gradient_angle: form.get('gradient_angle'),
        border_style: (form.get('border_style') || '').toString(),
        border_color: (form.get('border_color') || '').toString(),
        border_width: form.get('border_width'),
        logo_size: form.get('logo_size'),
        card_padding: form.get('card_padding'),
        shadow: (form.get('shadow') || '').toString(),
        badge_bg_color: (form.get('badge_bg_color') || '').toString(),
        badge_text_color: (form.get('badge_text_color') || '').toString(),
      });
      return new Response(null, { status: 302, headers: { 'Location': `/admin/card-styles?flash=${encodeURIComponent(jobType + ' style saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/card-styles/reset' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      const jobType = (form.get('job_type') || '').toString();
      if (!CARD_STYLE_JOB_TYPES.includes(jobType)) return new Response('Invalid job type', { status: 400 });
      await resetCardStyle(env, jobType);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/card-styles?flash=${encodeURIComponent(jobType + ' reset to default')}` } });
    } catch (e) { return errorPage(e); }
  }

  // ── Ads ────────────────────────────────────────────────────────
  if (url.pathname === '/admin/settings' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderSettingsContent(env);
      return new Response(adminShell('settings', content, await getAdminCsrfToken(env, request.headers.get('Cookie'))), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/settings/reset-appearance' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      await setSettings(env, THEME_DEFAULTS);
      await logActivity(env, 'appearance_reset', 'Appearance defaults');
      return new Response(null, { status: 302, headers: { 'Location': `/admin/settings?flash=${encodeURIComponent('Appearance reset to defaults')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/settings/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      // Explicit allow-list (SETTINGS_KEYS) rather than trusting arbitrary
      // posted field names — setSettings() also enforces this itself, but
      // filtering here too keeps the intent obvious at the call site.
      // Checkbox-style keys (CHECKBOX_SETTINGS_KEYS) need `form.get(key)
      // ? '1' : '0'` because an unchecked box is simply absent from the
      // POST body — `form.has(key)` would never see it turn OFF.
      const updates = {};
      for (const key of SETTINGS_KEYS) {
        if (CHECKBOX_SETTINGS_KEYS.includes(key)) { updates[key] = form.get(key) ? '1' : '0'; continue; }
        if (form.has(key)) updates[key] = (form.get(key) || '').toString().slice(0, 2000);
      }
      await setSettings(env, updates);
      await logActivity(env, 'settings_updated', 'General Settings');
      return new Response(null, { status: 302, headers: { 'Location': `/admin/settings?flash=${encodeURIComponent('Settings saved')}` } });
    } catch (e) { return errorPage(e); }
  }


  return null;
}
