// src/routes/admin/website.router.js
// Website — Homepage Sections Builder (Admin Dashboard V2 Phase 4), Job
// Card Style Manager, and the central Settings page (general/SEO/hero/
// maintenance/feature flags). See admin.router.js for how every
// admin/*.router.js sub-router is composed.

import { verifyAdminCookie, getAdminCsrfToken, verifyAdminCsrf } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderHomepageBuilderContent, renderHomepageCustomSectionNewContent, renderHomepageCustomSectionEditContent, renderHomepageSectionCodeEditContent } from '../../pages/admin/homepage.js';
import { renderCardStylesContent } from '../../pages/admin/card-styles.js';
import { renderSettingsContent } from '../../pages/admin/settings.js';
import { adminShell } from '../../pages/admin/shell.js';
import { setHomepageSectionEnabled, moveHomepageSection, getHomepageSectionByKey, updateHomepageSectionCode, clearHomepageSectionCode } from '../../lib/homepage-sections.js';
import { getHomepageCustomSectionById, createHomepageCustomSection, updateHomepageCustomSection, setHomepageCustomSectionEnabled, moveHomepageCustomSection, deleteHomepageCustomSection } from '../../lib/homepage-custom-sections.js';
import { updateCardStyle, resetCardStyle, CARD_STYLE_JOB_TYPES } from '../../lib/job-card-styles.js';
import { setSettings, SETTINGS_KEYS, CHECKBOX_SETTINGS_KEYS, APPEARANCE_DEFAULTS, COMPONENT_DEFAULTS, HOMEPAGE_COPY_DEFAULTS } from '../../lib/settings.js';
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

  if (url.pathname === '/admin/homepage/new' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = renderHomepageCustomSectionNewContent();
      return new Response(adminShell('homepage', content, await getAdminCsrfToken(env, request.headers.get('Cookie'))), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/homepage/edit' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const key = url.searchParams.get('key') || '';
      if (key) {
        const section = await getHomepageSectionByKey(env, key);
        if (!section) return new Response(adminShell('homepage', `<div class="adm-wrap"><div class="adm-card">Homepage section not found. <a href="/admin/homepage">← Back</a></div></div>`, await getAdminCsrfToken(env, request.headers.get('Cookie'))), { headers: { "Content-Type": "text/html; charset=utf-8" } });
        const content = renderHomepageSectionCodeEditContent(section);
        return new Response(adminShell('homepage', content, await getAdminCsrfToken(env, request.headers.get('Cookie'))), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      const section = await getHomepageCustomSectionById(env, url.searchParams.get('id') || '');
      if (!section) return new Response(adminShell('homepage', `<div class="adm-wrap"><div class="adm-card">Homepage section not found. <a href="/admin/homepage">← Back</a></div></div>`, await getAdminCsrfToken(env, request.headers.get('Cookie'))), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = renderHomepageCustomSectionEditContent(section);
      return new Response(adminShell('homepage', content, await getAdminCsrfToken(env, request.headers.get('Cookie'))), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if ((url.pathname === '/admin/homepage/update-code' || url.pathname === '/admin/homepage/clear-code') && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      const key = (form.get('key') || '').toString();
      if (url.pathname === '/admin/homepage/clear-code') {
        await clearHomepageSectionCode(env, key);
        await logActivity(env, 'homepage_section_code_cleared', key);
      } else {
        await updateHomepageSectionCode(env, key, { custom_html: form.get('custom_html'), custom_css: form.get('custom_css'), custom_js: form.get('custom_js') });
        await logActivity(env, 'homepage_section_code_updated', key);
      }
      return new Response(null, { status: 302, headers: { 'Location': `/admin/homepage/edit?key=${encodeURIComponent(key)}&flash=${encodeURIComponent('Section code saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/homepage/custom/create' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      await createHomepageCustomSection(env, { title: form.get('title'), description: form.get('description'), custom_html: form.get('custom_html'), custom_css: form.get('custom_css'), custom_js: form.get('custom_js'), enabled: form.get('enabled') === '1' });
      await logActivity(env, 'homepage_custom_section_created', (form.get('title') || '').toString());
      return new Response(null, { status: 302, headers: { 'Location': `/admin/homepage?flash=${encodeURIComponent('Homepage section created')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/homepage/custom/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      const id = (form.get('id') || '').toString();
      await updateHomepageCustomSection(env, id, { title: form.get('title'), description: form.get('description'), custom_html: form.get('custom_html'), custom_css: form.get('custom_css'), custom_js: form.get('custom_js'), enabled: form.get('enabled') === '1' });
      await logActivity(env, 'homepage_custom_section_updated', id);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/homepage/edit?id=${encodeURIComponent(id)}&flash=${encodeURIComponent('Homepage section saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/homepage/custom/toggle' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      const id = (form.get('id') || '').toString();
      await setHomepageCustomSectionEnabled(env, id, form.get('enabled') === '1');
      await logActivity(env, 'homepage_custom_section_toggled', id);
      return new Response(null, { status: 302, headers: { 'Location': '/admin/homepage' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/homepage/custom/move' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      const id = (form.get('id') || '').toString();
      const direction = (form.get('direction') || '').toString();
      await moveHomepageCustomSection(env, id, direction);
      await logActivity(env, 'homepage_custom_section_moved', `${id} → ${direction}`);
      return new Response(null, { status: 302, headers: { 'Location': '/admin/homepage' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/homepage/custom/delete' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      const id = (form.get('id') || '').toString();
      await deleteHomepageCustomSection(env, id);
      await logActivity(env, 'homepage_custom_section_deleted', id);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/homepage?flash=${encodeURIComponent('Homepage section deleted')}` } });
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
      await setSettings(env, APPEARANCE_DEFAULTS);
      await logActivity(env, 'appearance_reset', 'Appearance defaults');
      return new Response(null, { status: 302, headers: { 'Location': `/admin/settings?flash=${encodeURIComponent('Appearance reset to defaults')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/settings/reset-homepage-copy' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      await setSettings(env, HOMEPAGE_COPY_DEFAULTS);
      await logActivity(env, 'homepage_copy_reset', 'Homepage copy defaults');
      return new Response(null, { status: 302, headers: { 'Location': `/admin/settings?flash=${encodeURIComponent('Homepage Copy reset to defaults')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/settings/reset-components' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (!await verifyAdminCsrf(env, request.headers.get('Cookie'), (form.get('_admin_csrf') || '').toString())) return new Response('Invalid CSRF token', { status: 403 });
      await setSettings(env, COMPONENT_DEFAULTS);
      await logActivity(env, 'component_controls_reset', 'Company Card and Navigation defaults');
      return new Response(null, { status: 302, headers: { 'Location': `/admin/settings?flash=${encodeURIComponent('Company Card and Navigation reset to defaults')}` } });
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
