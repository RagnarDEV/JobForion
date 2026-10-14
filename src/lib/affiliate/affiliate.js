// src/lib/affiliate/affiliate.js
// ════════════════════════════════════════════════════════════════
// Affiliate Manager — data layer. No HTML here (see components/affiliate-block.js)
// and no HTTP here (see routes/affiliate.router.js, routes/admin/affiliate.router.js).
//
// SECURITY MODEL
//   • The destination URL (with YOUR affiliate id) exists only in aff_offers. A visitor
//     asks for /go/<slug>; the redirect target is built from the database row, never
//     from anything the client sends — so clicks cannot be forged into arbitrary
//     redirects, and the open-redirect class of bug does not exist here.
//   • Only http(s) destinations are stored; placeholders are substituted with
//     encodeURIComponent'd values and the final URL is re-validated before redirecting.
//   • IPs are never stored: a per-day HMAC-style salted SHA-256 is, using a secret.
//
// D1 WRITE BUDGET (free plan: 100k rows/day)
//   A click upserts ONE aff_daily row (counter) and, only while under the daily detail
//   cap, inserts ONE aff_clicks row. Everything on the stats screen reads aff_daily.
// ════════════════════════════════════════════════════════════════

import { safeExternalUrl, slugify } from '../directory/entities.js';
import { memoConfig } from '../platform/config-memo.js';
import { sha256Hex } from '../accounts/tokens.js';

export const PLACEMENTS = Object.freeze({
  job_page:      { label: 'Job page',            settingKey: 'aff_place_job_page' },
  skill_page:    { label: 'Skill pages',         settingKey: 'aff_place_skill_page' },
  category_page: { label: 'Category pages',      settingKey: 'aff_place_category_page' },
  blog_post:     { label: 'Blog articles',       settingKey: 'aff_place_blog_post' },
  home_sidebar:  { label: 'Homepage sidebar',    settingKey: 'aff_place_home_sidebar' },
});
export const PLACEMENT_KEYS = Object.freeze(Object.keys(PLACEMENTS));
export const ICON_KEYS = Object.freeze(['tag', 'briefcase', 'sparkle', 'trending', 'shield', 'coins', 'graduation', 'laptop']);
export const PROGRAM_STATUSES = Object.freeze(['active', 'inactive']);
export const OFFER_STATUSES = Object.freeze(['active', 'paused']);
export const CONVERSION_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
export const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP']);
const URL_PLACEHOLDERS = ['click_id', 'offer', 'placement'];
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const posInt = (v, max = 2147483647) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 && n <= max ? n : null; };
const csvKeys = (v, max = 12) => [...new Set(String(v ?? '').split(/[,\n]/).map((s) => slugify(s.trim())).filter((s) => s && s !== 'na'))].slice(0, max);
const dateOrNull = (v) => { const s = String(v ?? '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null; };

// ── validation ──────────────────────────────────────────────────
export function cleanProgramInput(input = {}) {
  const name = text(input.name, 80);
  if (!name) return { ok: false, error: 'Program name is required.' };
  return { ok: true, value: {
    name,
    network: text(input.network, 60),
    commission_note: text(input.commission_note, 200),
    status: PROGRAM_STATUSES.includes(String(input.status)) ? String(input.status) : 'active',
  } };
}

// A destination template: https?:// URL, no whitespace / quotes / angle brackets,
// and only {click_id} {offer} {placement} placeholders.
export function validateDestinationTemplate(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > 1000) return { ok: false, error: 'Destination URL is required (max 1000 characters).' };
  if (!/^https?:\/\//i.test(value) || /[\s"'<>\\]/.test(value)) return { ok: false, error: 'Destination must be an http(s) URL without spaces or quotes.' };
  const used = [...value.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  if (used.some((p) => !URL_PLACEHOLDERS.includes(p))) return { ok: false, error: `Only ${URL_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')} placeholders are allowed.` };
  const probe = value.replace(/\{[^{}]*\}/g, 'x');
  if (!safeExternalUrl(probe)) return { ok: false, error: 'Destination is not a valid http(s) URL.' };
  return { ok: true, value };
}

export function cleanOfferInput(input = {}, { programs = null } = {}) {
  const title = text(input.title, 90);
  const slug = slugify(text(input.slug || title, 80));
  if (!title) return { ok: false, error: 'Offer title is required.' };
  if (!SLUG_RE.test(slug) || slug === 'na') return { ok: false, error: 'Slug may contain only lowercase letters, numbers and hyphens.' };
  const programId = posInt(input.program_id);
  if (!programId || (programs && !programs.some((p) => Number(p.id) === programId))) return { ok: false, error: 'Choose a valid program.' };
  const dest = validateDestinationTemplate(input.destination_url);
  if (!dest.ok) return dest;
  const placements = [].concat(input.placements ?? []).flatMap((p) => String(p).split(',')).map((p) => p.trim()).filter((p) => PLACEMENT_KEYS.includes(p));
  const startsAt = dateOrNull(input.starts_at);
  const endsAt = dateOrNull(input.ends_at);
  if (startsAt && endsAt && endsAt < startsAt) return { ok: false, error: 'End date must not be before the start date.' };
  return { ok: true, value: {
    program_id: programId, slug, title,
    description: text(input.description, 220),
    cta_label: text(input.cta_label, 28) || 'Learn more',
    badge: text(input.badge, 24),
    icon_key: ICON_KEYS.includes(String(input.icon_key)) ? String(input.icon_key) : 'tag',
    destination_url: dest.value,
    placements: [...new Set(placements)].join(','),
    category_keys: csvKeys(input.category_keys).join(','),
    skill_keys: csvKeys(input.skill_keys, 20).join(','),
    weight: Math.min(10, Math.max(1, Number.parseInt(input.weight, 10) || 1)),
    status: OFFER_STATUSES.includes(String(input.status)) ? String(input.status) : 'active',
    starts_at: startsAt, ends_at: endsAt,
  } };
}

// Money is entered as a decimal string and stored as integer minor units.
export function parseMoneyMinor(value) {
  const s = String(value ?? '').trim().replace(/^[$€£]/, '').replace(/,/g, '');
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
export function formatMinor(minor, currency = 'USD') {
  const sign = Number(minor) < 0 ? '-' : '';
  const abs = Math.abs(Number(minor) || 0);
  return `${sign}${{ USD: '$', EUR: '€', GBP: '£' }[currency] || ''}${(abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── admin CRUD ──────────────────────────────────────────────────
export async function listPrograms(env) {
  try { const { results } = await env.DB.prepare('SELECT * FROM aff_programs ORDER BY id DESC LIMIT 200').all(); return results || []; } catch (e) { return []; }
}
export async function saveProgram(env, input, id = null) {
  const c = cleanProgramInput(input);
  if (!c.ok) return c;
  const v = c.value;
  try {
    const pid = posInt(id);
    if (pid) await env.DB.prepare('UPDATE aff_programs SET name=?,network=?,commission_note=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(v.name, v.network, v.commission_note, v.status, pid).run();
    else await env.DB.prepare('INSERT INTO aff_programs (name,network,commission_note,status) VALUES (?,?,?,?)').bind(v.name, v.network, v.commission_note, v.status).run();
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Program could not be saved.' }; }
}
export async function deleteProgram(env, id) {
  const pid = posInt(id);
  if (!pid) return { ok: false, error: 'Invalid program.' };
  try {
    const { results } = await env.DB.prepare('SELECT COUNT(*) c FROM aff_offers WHERE program_id = ?').bind(pid).all();
    if (Number(results?.[0]?.c || 0) > 0) return { ok: false, error: 'Delete or move this program’s offers first.' };
    await env.DB.prepare('DELETE FROM aff_programs WHERE id = ?').bind(pid).run();
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Program could not be deleted.' }; }
}

export async function listOffers(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT o.*, p.name AS program_name, p.status AS program_status FROM aff_offers o LEFT JOIN aff_programs p ON p.id = o.program_id ORDER BY o.id DESC LIMIT 300`
    ).all();
    return results || [];
  } catch (e) { return []; }
}
export async function getOfferById(env, id) {
  const oid = posInt(id);
  if (!oid) return null;
  try { const { results } = await env.DB.prepare('SELECT * FROM aff_offers WHERE id = ? LIMIT 1').bind(oid).all(); return results?.[0] || null; } catch (e) { return null; }
}
export async function saveOffer(env, input, id = null) {
  const programs = await listPrograms(env);
  const c = cleanOfferInput(input, { programs });
  if (!c.ok) return c;
  const v = c.value;
  try {
    const oid = posInt(id);
    if (oid) {
      await env.DB.prepare(`UPDATE aff_offers SET program_id=?,slug=?,title=?,description=?,cta_label=?,badge=?,icon_key=?,destination_url=?,placements=?,category_keys=?,skill_keys=?,weight=?,status=?,starts_at=?,ends_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(v.program_id, v.slug, v.title, v.description, v.cta_label, v.badge, v.icon_key, v.destination_url, v.placements, v.category_keys, v.skill_keys, v.weight, v.status, v.starts_at, v.ends_at, oid).run();
    } else {
      await env.DB.prepare(`INSERT INTO aff_offers (program_id,slug,title,description,cta_label,badge,icon_key,destination_url,placements,category_keys,skill_keys,weight,status,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(v.program_id, v.slug, v.title, v.description, v.cta_label, v.badge, v.icon_key, v.destination_url, v.placements, v.category_keys, v.skill_keys, v.weight, v.status, v.starts_at, v.ends_at).run();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: /UNIQUE/i.test(String(e && e.message)) ? 'That slug is already used by another offer.' : 'Offer could not be saved.' };
  }
}
export async function setOfferStatus(env, id, status) {
  const oid = posInt(id);
  if (!oid || !OFFER_STATUSES.includes(status)) return { ok: false, error: 'Invalid request.' };
  try { await env.DB.prepare('UPDATE aff_offers SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status, oid).run(); return { ok: true }; } catch (e) { return { ok: false, error: 'Could not update the offer.' }; }
}
export async function deleteOffer(env, id) {
  const oid = posInt(id);
  if (!oid) return { ok: false, error: 'Invalid offer.' };
  try { await env.DB.prepare('DELETE FROM aff_offers WHERE id = ?').bind(oid).run(); return { ok: true }; } catch (e) { return { ok: false, error: 'Could not delete the offer.' }; }
}

// ── public selection ────────────────────────────────────────────
export async function getActiveOffers(env) {
  return memoConfig('aff:active-offers', async () => {
    try {
      const { results } = await env.DB.prepare(
        `SELECT o.id,o.slug,o.title,o.description,o.cta_label,o.badge,o.icon_key,o.placements,o.category_keys,o.skill_keys,o.weight,o.starts_at,o.ends_at
           FROM aff_offers o JOIN aff_programs p ON p.id = o.program_id
          WHERE o.status='active' AND p.status='active' ORDER BY o.id DESC LIMIT 200`
      ).all();
      return results || [];
    } catch (e) { return []; }
  }, 60000);
}

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function offerIsLive(offer, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (offer.starts_at && String(offer.starts_at).slice(0, 10) > today) return false;
  if (offer.ends_at && String(offer.ends_at).slice(0, 10) < today) return false;
  return true;
}

// Weighted pick without replacement. Targeted matches (same category / skill as the page)
// get a ×4 boost — an offer relevant to the page being read is what actually converts.
export function pickOffers(offers, placement, { categoryKey = '', skills = [], limit = 2, now = Date.now(), rand = Math.random } = {}) {
  const skillSet = new Set((skills || []).map((s) => slugify(String(s))));
  const pool = [];
  for (const o of offers || []) {
    if (!offerIsLive(o, now)) continue;
    const places = list(o.placements);
    if (!places.includes(placement)) continue;
    const cats = list(o.category_keys), sk = list(o.skill_keys);
    const targeted = cats.length > 0 || sk.length > 0;
    let boost = 1;
    if (targeted) {
      const hit = (categoryKey && cats.includes(categoryKey)) || sk.some((s) => skillSet.has(s));
      if (!hit) continue;
      boost = 4;
    }
    pool.push({ offer: o, w: Math.max(1, Number(o.weight) || 1) * boost });
  }
  const out = [];
  while (pool.length && out.length < limit) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = rand() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) { r -= pool[idx].w; if (r < 0) break; }
    out.push(pool.splice(idx, 1)[0].offer);
  }
  return out;
}

export function placementEnabled(settings, placement) {
  if (!settings || settings.affiliate_enabled !== '1') return false;
  const def = PLACEMENTS[placement];
  return Boolean(def && settings[def.settingKey] === '1');
}

// One call for the public pages: returns [] when disabled / nothing matches.
export async function getPlacementOffers(env, settings, placement, ctx = {}) {
  if (!placementEnabled(settings, placement)) return [];
  const limit = Math.min(4, Math.max(1, parseInt(settings.aff_max_offers_per_placement, 10) || 2));
  return pickOffers(await getActiveOffers(env), placement, { ...ctx, limit });
}

// ── redirect + click tracking ───────────────────────────────────
export async function findLiveOfferBySlug(env, slug) {
  const s = String(slug || '');
  if (!SLUG_RE.test(s)) return null;
  try {
    const { results } = await env.DB.prepare(
      `SELECT o.id,o.slug,o.destination_url,o.starts_at,o.ends_at FROM aff_offers o JOIN aff_programs p ON p.id=o.program_id WHERE o.slug=? AND o.status='active' AND p.status='active' LIMIT 1`
    ).bind(s).all();
    const o = results?.[0];
    return o && offerIsLive(o) ? o : null;
  } catch (e) { return null; }
}

export function newClickId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildDestination(offer, { clickId, placement }) {
  const filled = String(offer.destination_url).replace(/\{(click_id|offer|placement)\}/g, (_, k) =>
    encodeURIComponent({ click_id: clickId, offer: offer.slug, placement: placement || '' }[k]));
  return safeExternalUrl(filled); // '' when anything is off — caller must not redirect then
}

export async function recordClick(env, offer, { clickId, placement, pagePath, ip, settings = {} }) {
  const day = new Date().toISOString().slice(0, 10);
  const place = PLACEMENT_KEYS.includes(placement) ? placement : 'direct';
  try {
    await env.DB.prepare(
      `INSERT INTO aff_daily (day, offer_id, placement, clicks) VALUES (?,?,?,1) ON CONFLICT(day, offer_id, placement) DO UPDATE SET clicks = clicks + 1`
    ).bind(day, offer.id, place).run();
    const cap = Math.max(0, parseInt(settings.aff_detail_clicks_per_day, 10) || 0);
    if (cap > 0) {
      const { results } = await env.DB.prepare('SELECT COALESCE(SUM(clicks),0) AS c FROM aff_daily WHERE day = ?').bind(day).all();
      if (Number(results?.[0]?.c || 0) <= cap) {
        const secret = env.ANALYTICS_HASH_SECRET || env.CSRF_SECRET || 'jobforion-affiliate';
        const ipHash = ip ? (await sha256Hex(`aff-ip:${secret}:${day}:${ip}`)).slice(0, 32) : '';
        await env.DB.prepare('INSERT OR IGNORE INTO aff_clicks (click_id,offer_id,placement,page_path,ip_hash) VALUES (?,?,?,?,?)')
          .bind(clickId, offer.id, place, String(pagePath || '').slice(0, 160), ipHash).run();
      }
    }
    return true;
  } catch (e) { return false; }
}

// ── conversions (entered / imported by the site owner) ──────────
export async function addConversion(env, input = {}) {
  const amount = parseMoneyMinor(input.amount);
  const currency = CURRENCIES.includes(String(input.currency)) ? String(input.currency) : 'USD';
  const status = CONVERSION_STATUSES.includes(String(input.status)) ? String(input.status) : 'pending';
  const clickId = text(input.click_id, 40).replace(/[^a-z0-9]/gi, '').toLowerCase();
  let offerId = posInt(input.offer_id);
  if (amount === null) return { ok: false, error: 'Enter a valid amount, e.g. 12.50.' };
  try {
    if (!offerId && clickId) {
      const { results } = await env.DB.prepare('SELECT offer_id FROM aff_clicks WHERE click_id = ? LIMIT 1').bind(clickId).all();
      offerId = results?.[0]?.offer_id || null;
    }
    if (!offerId && input.offer_slug) {
      const { results } = await env.DB.prepare('SELECT id FROM aff_offers WHERE slug = ? LIMIT 1').bind(slugify(String(input.offer_slug))).all();
      offerId = results?.[0]?.id || null;
    }
    if (!offerId) return { ok: false, error: 'Choose an offer, or give a click ID that exists.' };
    const occurred = dateOrNull(input.occurred_at);
    await env.DB.prepare(`INSERT INTO aff_conversions (offer_id,click_id,amount_minor,currency,status,note,occurred_at) VALUES (?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))`)
      .bind(offerId, clickId || null, amount, currency, status, text(input.note, 140), occurred).run();
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Conversion could not be saved.' }; }
}

// CSV columns (header row required, any order): click_id | offer, amount, currency, status, note, date
export function parseCsv(textIn, maxRows = 500) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(textIn ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim())) rows.push(row); row = []; if (rows.length > maxRows + 1) break; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); if (row.some((c) => c.trim())) rows.push(row); }
  return rows;
}

export async function importConversionsCsv(env, csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { ok: false, error: 'CSV needs a header row and at least one data row.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  if (col('amount') < 0 || (col('click_id') < 0 && col('offer') < 0)) return { ok: false, error: 'Header must include "amount" and "click_id" or "offer".' };
  let imported = 0, failed = 0;
  for (const r of rows.slice(1, 501)) {
    const get = (n) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
    const res = await addConversion(env, { click_id: get('click_id'), offer_slug: get('offer'), amount: get('amount'), currency: (get('currency') || 'USD').toUpperCase(), status: (get('status') || 'pending').toLowerCase(), note: get('note'), occurred_at: get('date') });
    if (res.ok) imported++; else failed++;
  }
  return { ok: imported > 0, imported, failed, error: imported ? '' : 'No rows could be imported.' };
}

export async function setConversionStatus(env, id, status) {
  const cid = posInt(id);
  if (!cid || !CONVERSION_STATUSES.includes(status)) return { ok: false, error: 'Invalid request.' };
  try { await env.DB.prepare('UPDATE aff_conversions SET status=? WHERE id=?').bind(status, cid).run(); return { ok: true }; } catch (e) { return { ok: false, error: 'Could not update.' }; }
}
export async function deleteConversion(env, id) {
  const cid = posInt(id);
  if (!cid) return { ok: false, error: 'Invalid request.' };
  try { await env.DB.prepare('DELETE FROM aff_conversions WHERE id = ?').bind(cid).run(); return { ok: true }; } catch (e) { return { ok: false, error: 'Could not delete.' }; }
}
export async function listConversions(env, limit = 25) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT c.*, o.title AS offer_title FROM aff_conversions c LEFT JOIN aff_offers o ON o.id=c.offer_id ORDER BY c.id DESC LIMIT ?`
    ).bind(Math.min(100, limit)).all();
    return results || [];
  } catch (e) { return []; }
}

// ── stats (read aff_daily / aff_conversions only) ───────────────
export async function getAffiliateStats(env, days = 30) {
  const d = Math.min(365, Math.max(1, parseInt(days, 10) || 30));
  const since = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const empty = { days: d, totalClicks: 0, byOffer: [], byPlacement: [], earnings: {}, approvedCount: 0 };
  try {
    const [perOffer, perPlacement, conv] = await Promise.all([
      env.DB.prepare('SELECT offer_id, SUM(clicks) AS clicks FROM aff_daily WHERE day >= ? GROUP BY offer_id').bind(since).all(),
      env.DB.prepare('SELECT placement, SUM(clicks) AS clicks FROM aff_daily WHERE day >= ? GROUP BY placement ORDER BY clicks DESC').bind(since).all(),
      env.DB.prepare(`SELECT offer_id, currency, status, COUNT(*) AS n, SUM(amount_minor) AS minor FROM aff_conversions WHERE occurred_at >= ? GROUP BY offer_id, currency, status`).bind(since).all(),
    ]);
    const byOffer = new Map();
    for (const r of perOffer.results || []) byOffer.set(r.offer_id, { offer_id: r.offer_id, clicks: Number(r.clicks || 0), pending: 0, approved: 0, rejected: 0, earned: {} });
    const earnings = {};
    let approvedCount = 0;
    for (const r of conv.results || []) {
      const e = byOffer.get(r.offer_id) || { offer_id: r.offer_id, clicks: 0, pending: 0, approved: 0, rejected: 0, earned: {} };
      e[r.status] = (e[r.status] || 0) + Number(r.n || 0);
      if (r.status === 'approved') { e.earned[r.currency] = (e.earned[r.currency] || 0) + Number(r.minor || 0); earnings[r.currency] = (earnings[r.currency] || 0) + Number(r.minor || 0); approvedCount += Number(r.n || 0); }
      byOffer.set(r.offer_id, e);
    }
    const rows = [...byOffer.values()].sort((a, b) => b.clicks - a.clicks);
    return { days: d, totalClicks: rows.reduce((s, r) => s + r.clicks, 0), byOffer: rows, byPlacement: (perPlacement.results || []).map((r) => ({ placement: r.placement, clicks: Number(r.clicks || 0) })), earnings, approvedCount };
  } catch (e) { return empty; }
}

// Earnings per click — only meaningful when exactly one currency has earnings.
export function earningsPerClick(clicks, earnings) {
  const cur = Object.keys(earnings || {});
  if (!clicks || cur.length !== 1) return null;
  return formatMinor(Math.round(earnings[cur[0]] / clicks), cur[0]);
}

// ── retention (called from the daily maintenance task) ──────────
export async function cleanupAffiliate(env, retentionDays = 90) {
  const days = Math.min(365, Math.max(7, parseInt(retentionDays, 10) || 90));
  try {
    const r = await env.DB.prepare(`DELETE FROM aff_clicks WHERE created_at < datetime('now', ?)`).bind(`-${days} day`).run();
    await env.DB.prepare(`DELETE FROM aff_daily WHERE day < date('now', '-400 day')`).run();
    return { deleted: r.meta?.changes || 0 };
  } catch (e) { return { deleted: 0 }; }
}

