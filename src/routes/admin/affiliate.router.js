// src/routes/admin/affiliate.router.js
// /admin/affiliate/* — Affiliate Manager. Auth + CSRF are enforced centrally in
// admin.router.js; each handler still re-checks the cookie (defense in depth).
// Every mutation validates through lib/affiliate/affiliate.js and redirects back
// with a flash message — error details never leak internals.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { renderAffiliateContent } from '../../pages/admin/affiliate.js';
import { adminShell } from '../../pages/admin/shell.js';
import { setSettings } from '../../lib/platform/settings.js';
import { logActivity } from '../../lib/platform/activity-log.js';
import {
  PLACEMENTS, saveProgram, deleteProgram, saveOffer, setOfferStatus, deleteOffer,
  addConversion, importConversionsCsv, setConversionStatus, deleteConversion,
} from '../../lib/affiliate/affiliate.js';
import { errorPage } from './error-page.js';

const MAX_CSV_BYTES = 256 * 1024;
const back = (message, hash = '') => new Response(null, { status: 302, headers: { Location: `/admin/affiliate?flash=${encodeURIComponent(message)}${hash}` } });

export async function handleAdminAffiliateRoute(url, request, env) {
  if (!url.pathname.startsWith('/admin/affiliate')) return null;
  try {
    const ok = await verifyAdminCookie(env, request.headers.get('Cookie'));
    if (!ok) {
      return request.method === 'GET'
        ? new Response(renderAdminLogin(false), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        : new Response('Unauthorized', { status: 401 });
    }

    if (url.pathname === '/admin/affiliate' && request.method === 'GET') {
      const content = await renderAffiliateContent(env, url);
      return new Response(adminShell('affiliate', content), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST') return null;

    const form = await request.formData();
    const result = (r, okMessage) => (r.ok ? back(okMessage) : back(r.error || 'Something went wrong'));

    switch (url.pathname) {
      case '/admin/affiliate/settings': {
        const bool = (name) => (form.get(name) ? '1' : '0');
        const updates = { affiliate_enabled: bool('affiliate_enabled') };
        for (const def of Object.values(PLACEMENTS)) updates[def.settingKey] = bool(def.settingKey);
        updates.aff_max_offers_per_placement = String(form.get('aff_max_offers_per_placement') || '2');
        updates.aff_detail_clicks_per_day = String(form.get('aff_detail_clicks_per_day') || '2000');
        updates.aff_detail_retention_days = String(form.get('aff_detail_retention_days') || '90');
        updates.affiliate_disclosure = String(form.get('affiliate_disclosure') || '').slice(0, 300);
        await setSettings(env, updates);
        await logActivity(env, 'affiliate_settings_saved', updates.affiliate_enabled === '1' ? 'enabled' : 'disabled', {});
        return back('Affiliate settings saved');
      }
      case '/admin/affiliate/programs/save': {
        const r = await saveProgram(env, Object.fromEntries(form.entries()), form.get('program_id'));
        if (r.ok) await logActivity(env, 'affiliate_program_saved', String(form.get('name') || '').slice(0, 80), {});
        return result(r, 'Program saved');
      }
      case '/admin/affiliate/programs/delete': return result(await deleteProgram(env, form.get('id')), 'Program deleted');
      case '/admin/affiliate/offers/save': {
        const input = Object.fromEntries(form.entries());
        input.placements = form.getAll('placements').map(String);
        const r = await saveOffer(env, input, form.get('offer_id'));
        if (r.ok) await logActivity(env, 'affiliate_offer_saved', String(form.get('title') || '').slice(0, 90), {});
        return result(r, 'Offer saved');
      }
      case '/admin/affiliate/offers/status': return result(await setOfferStatus(env, form.get('id'), String(form.get('status') || '')), 'Offer updated');
      case '/admin/affiliate/offers/delete': return result(await deleteOffer(env, form.get('id')), 'Offer deleted');
      case '/admin/affiliate/conversions/add': return result(await addConversion(env, Object.fromEntries(form.entries())), 'Conversion recorded');
      case '/admin/affiliate/conversions/status': return result(await setConversionStatus(env, form.get('id'), String(form.get('status') || '')), 'Conversion updated');
      case '/admin/affiliate/conversions/delete': return result(await deleteConversion(env, form.get('id')), 'Conversion deleted');
      case '/admin/affiliate/conversions/import': {
        let csv = String(form.get('csv_text') || '');
        const file = form.get('csv_file');
        if (file && typeof file === 'object' && typeof file.text === 'function' && file.size > 0) {
          if (file.size > MAX_CSV_BYTES) return back('CSV is too large (256 KB max)');
          csv = await file.text();
        }
        if (csv.length > MAX_CSV_BYTES) return back('CSV is too large (256 KB max)');
        const r = await importConversionsCsv(env, csv);
        return r.ok ? back(`Imported ${r.imported} conversion${r.imported === 1 ? '' : 's'}${r.failed ? `, ${r.failed} skipped` : ''}`) : back(r.error);
      }
      default: return null;
    }
  } catch (e) { return errorPage(e); }
}
