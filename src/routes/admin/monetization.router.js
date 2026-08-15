// src/routes/admin/monetization.router.js
// Monetization — the master Ads switch plus per-slot ad code management
// (ad_slots table). See admin.router.js for how every admin/*.router.js
// sub-router is composed.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderAdsContent } from '../../pages/admin/ads.js';
import { adminShell } from '../../pages/admin/shell.js';
import { setSettings } from '../../lib/settings.js';
import { updateAdSlot, resetAdSlot, AD_SLOT_DEFS } from '../../lib/ad-slots.js';
import { logActivity } from '../../lib/activity-log.js';
import { errorPage } from './error-page.js';

export async function handleAdminMonetizationRoute(url, request, env, base) {
  if (url.pathname === '/admin/ads' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const content = await renderAdsContent(env);
      return new Response(adminShell('ads', content), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/ads/toggle-global' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await setSettings(env, { ads_enabled: form.get('ads_enabled') ? '1' : '0' });
      await logActivity(env, 'ads_toggled', form.get('ads_enabled') ? 'enabled' : 'disabled');
      return new Response(null, { status: 302, headers: { 'Location': `/admin/ads?flash=${encodeURIComponent('Saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/ads/update' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const slotId = (form.get('slot_id') || '').toString();
      if (!AD_SLOT_DEFS.some(s => s.id === slotId)) return new Response('Invalid slot', { status: 400 });
      await updateAdSlot(env, slotId, {
        code: (form.get('code') || '').toString(),
        enabled: !!form.get('enabled'),
        width: form.get('width'),
        height: form.get('height'),
      });
      await logActivity(env, 'ads_updated', slotId);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/ads?flash=${encodeURIComponent('Ad slot saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/ads/reset' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const slotId = (form.get('slot_id') || '').toString();
      if (!AD_SLOT_DEFS.some(s => s.id === slotId)) return new Response('Invalid slot', { status: 400 });
      await resetAdSlot(env, slotId);
      return new Response(null, { status: 302, headers: { 'Location': `/admin/ads?flash=${encodeURIComponent('Reset to default')}` } });
    } catch (e) { return errorPage(e); }
  }


  return null;
}
