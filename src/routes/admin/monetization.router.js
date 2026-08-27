// src/routes/admin/monetization.router.js
// Monetization — the master Ads switch plus per-slot ad code management
// (ad_slots table). See admin.router.js for how every admin/*.router.js
// sub-router is composed.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderAdsContent } from '../../pages/admin/ads.js';
import { renderMonetizationContent } from '../../pages/admin/monetization.js';
import { adminShell } from '../../pages/admin/shell.js';
import { setSettings } from '../../lib/settings.js';
import { updateAdSlot, resetAdSlot, AD_SLOT_DEFS } from '../../lib/ad-slots.js';
import { logActivity } from '../../lib/activity-log.js';
import { saveProduct, saveAffiliateProgram, requestRefund, grantAdminEntitlement } from '../../lib/monetization.js';
import { errorPage } from './error-page.js';

export async function handleAdminMonetizationRoute(url, request, env, base) {
  if (url.pathname === '/admin/monetization' && request.method === 'GET') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response(renderAdminLogin(false), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      const content = await renderMonetizationContent(env, url);
      return new Response(adminShell('monetization', content), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/monetization/products/save' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const result = await saveProduct(env, Object.fromEntries(form.entries()), form.get('product_id'));
      if (!result.ok) return new Response(result.error, { status: 400 });
      await logActivity(env, 'monetization_product_saved', form.get('name') || form.get('slug'), { productId: result.id || form.get('product_id') || null, status: form.get('status') || 'active' });
      return new Response(null, { status: 302, headers: { Location: `/admin/monetization?flash=${encodeURIComponent('Product saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/monetization/affiliate/save' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      const result = await saveAffiliateProgram(env, Object.fromEntries(form.entries()), form.get('program_id'));
      if (!result.ok) return new Response(result.error, { status: 400 });
      await logActivity(env, 'monetization_affiliate_saved', form.get('name') || form.get('slug'), { programId: form.get('program_id') || null });
      return new Response(null, { status: 302, headers: { Location: `/admin/monetization?flash=${encodeURIComponent('Affiliate program saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/monetization/settings' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      await setSettings(env, {
        monetization_featured_enabled: form.get('monetization_featured_enabled') ? '1' : '0',
        monetization_sponsored_enabled: form.get('monetization_sponsored_enabled') ? '1' : '0',
        monetization_featured_placement: form.get('monetization_featured_placement'),
        monetization_sponsored_placement: form.get('monetization_sponsored_placement'),
        monetization_max_featured: form.get('monetization_max_featured'),
        monetization_ordering: form.get('monetization_ordering'),
      });
      await logActivity(env, 'monetization_settings_updated', 'monetization');
      return new Response(null, { status: 302, headers: { Location: `/admin/monetization?flash=${encodeURIComponent('Monetization settings saved')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/monetization/entitlements/grant' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (form.get('confirm') !== '1') return new Response('Explicit confirmation is required.', { status: 400 });
      const result = await grantAdminEntitlement(env, 'admin', Object.fromEntries(form.entries()));
      if (!result.ok) return new Response(result.error, { status: 400 });
      await logActivity(env, 'monetization_entitlement_granted', form.get('product_id'), { userId: form.get('user_id') || null, companyId: form.get('company_id') || null, jobId: form.get('job_id') || null });
      return new Response(null, { status: 302, headers: { Location: `/admin/monetization?flash=${encodeURIComponent('Entitlement granted')}` } });
    } catch (e) { return errorPage(e); }
  }

  if (url.pathname === '/admin/monetization/refunds/request' && request.method === 'POST') {
    try {
      const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
      if (!ok) return new Response('Unauthorized', { status: 401 });
      const form = await request.formData();
      if (form.get('confirm') !== '1') return new Response('Explicit confirmation is required.', { status: 400 });
      const result = await requestRefund(env, null, Object.fromEntries(form.entries()));
      if (!result.ok) return new Response(result.error, { status: 400 });
      await logActivity(env, 'monetization_refund_requested', form.get('order_id'), { amount_minor: form.get('amount_minor') });
      return new Response(null, { status: 302, headers: { Location: `/admin/monetization?flash=${encodeURIComponent('Refund request recorded; provider action is still required')}` } });
    } catch (e) { return errorPage(e); }
  }

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
