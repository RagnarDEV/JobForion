// src/lib/analytics/live.js
// ════════════════════════════════════════════════════════════════
// Data layer for /admin/analytics/live (the "Live Analytics" view).
//
// COST MODEL — read this before changing anything:
//   • READ-ONLY. No new table, no new index, no new write. Everything comes
//     from `analytics_event_queue` (already written by the public tracker),
//     `sync_logs`, `site_settings` and `jobs` (PK lookups only).
//   • The first load (`init`) reads at most LIVE_INIT_ROWS rows in ONE query
//     (newest-first by primary key, so the cost is bounded no matter how big
//     the table grows) and is memoised per isolate for 15 s.
//   • Every later poll (`delta`) reads ONLY rows newer than the last id the
//     browser already has (`id > ?`, LIMIT LIVE_DELTA_ROWS) — usually 0–20 rows.
//   • 7d / 30d history reuses getAnalyticsTrends() over the compact
//     `analytics_daily` aggregate and is memoised for 5 minutes.
//
// PRIVACY: raw session ids never leave this module — they are SHA-256 hashed
// and truncated. No IP, user-agent, e-mail or user id is read at all.
// ════════════════════════════════════════════════════════════════

import { sha256Hex } from '../accounts/tokens.js';
import { memoStat } from '../platform/stat-memo.js';
import { getSettings } from '../platform/settings.js';
import { loadSyncState, parseDailyBudget } from '../platform/write-budget.js';
import { getAnalyticsTrends } from './events.js';

export const LIVE_INIT_ROWS = 3000;
export const LIVE_DELTA_ROWS = 300;
const DAY_MS = 86400000;
const COLS = 'id,event_type,job_id,country,device_type,referrer,source,page,metadata,created_at,session_id';

// created_at is an ISO string for queue rows, but tolerate SQLite's
// "YYYY-MM-DD HH:MM:SS" (UTC) as well.
export function toMs(value) {
  const s = String(value || '');
  if (!s) return 0;
  const ms = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : 0;
}

export function parseSince(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : 0;
}

export function selfHostSet(...hosts) {
  return new Set(hosts.filter(Boolean).map(h => String(h).replace(/^www\./, '').toLowerCase()));
}

function hostOf(ref, selfHosts) {
  try {
    const h = new URL(ref).hostname.replace(/^www\./, '').toLowerCase().slice(0, 60);
    return selfHosts.has(h) ? 'internal' : h;
  } catch (e) { return ''; }
}

function trafficSource(row, selfHosts) {
  const src = String(row.source || '').trim().toLowerCase();
  if (src && src !== 'direct') return src.slice(0, 40);
  if (!row.referrer) return 'direct';
  return hostOf(row.referrer, selfHosts) || 'direct';
}

function searchMeta(raw) {
  try {
    const m = JSON.parse(raw || '{}');
    const n = Number(m.results_count);
    return { q: String(m.query || '').toLowerCase().trim().slice(0, 60), n: m.results_count !== undefined && Number.isFinite(n) ? n : null };
  } catch (e) { return { q: '', n: null }; }
}

async function sessionHash(raw) {
  return (await sha256Hex(`live-view:${raw}`)).slice(0, 10);
}

// Compact, allow-listed shape sent to the browser. Never spread a DB row here.
async function slimRow(row, selfHosts, withHash) {
  const e = {
    id: Number(row.id),
    y: String(row.event_type || '').slice(0, 30),
    t: toMs(row.created_at),
    p: String(row.page || '').slice(0, 80),
    c: String(row.country || 'XX').slice(0, 2).toUpperCase(),
    d: ['mobile', 'tablet', 'desktop'].includes(row.device_type) ? row.device_type : 'unknown',
    s: trafficSource(row, selfHosts),
  };
  if (row.job_id) e.j = Number(row.job_id);
  if (e.y === 'search') {
    const m = searchMeta(row.metadata);
    if (m.q) { e.q = m.q; if (m.n !== null) e.n = m.n; }
  }
  if (withHash && row.session_id) e.u = await sessionHash(row.session_id);
  return e;
}

const bump = (map, key, n = 1) => { if (key) map.set(key, (map.get(key) || 0) + n); };
const topN = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

async function loadTopJobs(env, jobCounts) {
  const ids = [...jobCounts.entries()].sort((a, b) => (b[1][0] + b[1][1] * 3) - (a[1][0] + a[1][1] * 3)).slice(0, 8);
  if (!ids.length) return [];
  let titles = new Map();
  try {
    const marks = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`SELECT id,title,company FROM jobs WHERE id IN (${marks})`).bind(...ids.map(([id]) => id)).all();
    titles = new Map((results || []).map(r => [Number(r.id), r]));
  } catch (e) { /* titles are decoration; ids alone are still useful */ }
  return ids.map(([id, [views, applies]]) => ({
    id, views, applies,
    title: String(titles.get(id)?.title || `Job #${id}`).slice(0, 90),
    company: String(titles.get(id)?.company || '').slice(0, 60),
  }));
}

async function loadSystem(env) {
  const out = { enabled: true, sampleRate: 100, syncUsed: 0, syncBudget: 0, lastSync: null };
  try {
    const settings = await getSettings(env);
    out.enabled = settings.analytics_enabled !== '0';
    out.sampleRate = Math.min(100, Math.max(10, parseInt(settings.analytics_sample_rate, 10) || 100));
    out.syncBudget = parseDailyBudget(settings.sync_daily_write_budget);
  } catch (e) {}
  try { out.syncUsed = (await loadSyncState(env)).used; } catch (e) {}
  try {
    const row = await env.DB.prepare('SELECT created_at, inserted, errors FROM sync_logs ORDER BY id DESC LIMIT 1').first();
    if (row) {
      let errors = 0;
      try { errors = (JSON.parse(row.errors || '[]') || []).length; } catch (e) {}
      out.lastSync = { t: toMs(row.created_at), inserted: Number(row.inserted || 0), errors };
    }
  } catch (e) {}
  return out;
}

async function buildInit(env, selfHosts) {
  const started = Date.now();
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM analytics_event_queue ORDER BY id DESC LIMIT ?`).bind(LIVE_INIT_ROWS).all();
  const rows = results || [];
  const now = Date.now();
  const cut24 = now - DAY_MS, cut60 = now - 3600000, cut5 = now - 300000;

  const minutes = {}, hours = {};
  const tops = { pages: new Map(), countries: new Map(), sources: new Map(), devices: new Map(), terms: new Map(), zero: new Map() };
  const jobCounts = new Map();
  const totals = { pv: 0, jv: 0, ap: 0, se: 0, imp: 0 };
  const feed = [];
  const rawSessions = new Map();
  let lastId = 0, oldest = now;

  for (const row of rows) {
    const id = Number(row.id);
    if (id > lastId) lastId = id;
    const t = toMs(row.created_at);
    if (!t || t < cut24) continue;
    if (t < oldest) oldest = t;
    const type = String(row.event_type || '');

    if (t >= cut5 && row.session_id && !rawSessions.has(row.session_id)) rawSessions.set(row.session_id, t);

    if (type === 'job_impression') { totals.imp++; continue; }

    const pv = type === 'page_view', jv = type === 'job_view', ap = type === 'job_apply_click';
    if (pv) totals.pv++; else if (jv) totals.jv++; else if (ap) totals.ap++; else if (type === 'search') totals.se++;

    if (pv || jv || ap) {
      const mk = Math.floor(t / 60000), hk = Math.floor(t / 3600000);
      if (t >= cut60) { const m = minutes[mk] || (minutes[mk] = [0, 0, 0]); m[pv ? 0 : jv ? 1 : 2]++; }
      const h = hours[hk] || (hours[hk] = [0, 0, 0]); h[pv ? 0 : jv ? 1 : 2]++;
    }
    if (pv) {
      bump(tops.pages, String(row.page || '/').slice(0, 80));
      bump(tops.countries, String(row.country || 'XX').slice(0, 2).toUpperCase());
      const src = trafficSource(row, selfHosts);
      if (src !== 'internal') bump(tops.sources, src);
      bump(tops.devices, ['mobile', 'tablet', 'desktop'].includes(row.device_type) ? row.device_type : 'unknown');
    }
    if ((jv || ap) && row.job_id) {
      const c = jobCounts.get(Number(row.job_id)) || [0, 0];
      c[jv ? 0 : 1]++;
      jobCounts.set(Number(row.job_id), c);
    }
    if (type === 'search') {
      const m = searchMeta(row.metadata);
      if (m.q) { bump(tops.terms, m.q); if (m.n === 0) bump(tops.zero, m.q); }
    }
    if (feed.length < 40) feed.push(await slimRow(row, selfHosts, false));
  }

  const active = [];
  for (const [raw, t] of rawSessions) active.push([await sessionHash(raw), t]);

  const [topJobs, system] = await Promise.all([loadTopJobs(env, jobCounts), loadSystem(env)]);

  return {
    ok: true, serverNow: now, lastId,
    windowStart: oldest < now ? oldest : null,
    capped: rows.length >= LIVE_INIT_ROWS,
    minutes, hours, totals,
    tops: {
      pages: topN(tops.pages, 10), countries: topN(tops.countries, 10), sources: topN(tops.sources, 8),
      devices: topN(tops.devices, 4), terms: topN(tops.terms, 8), zero: topN(tops.zero, 6), jobs: topJobs,
    },
    feed, active, system,
    dbMs: Date.now() - started,
  };
}

export function getLiveInit(env, selfHosts, { force = false } = {}) {
  return memoStat('live:init', () => buildInit(env, selfHosts), { ttl: 15000, force });
}

export async function getLiveDelta(env, sinceId, selfHosts) {
  const started = Date.now();
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM analytics_event_queue WHERE id > ? ORDER BY id ASC LIMIT ?`).bind(sinceId, LIVE_DELTA_ROWS).all();
  const rows = results || [];
  const events = [], activity = new Map();
  let imp = 0;
  for (const row of rows) {
    if (row.event_type === 'job_impression') {
      imp++;
      if (row.session_id) activity.set(await sessionHash(row.session_id), toMs(row.created_at));
      continue;
    }
    events.push(await slimRow(row, selfHosts, true));
  }
  return {
    ok: true, serverNow: Date.now(), dbMs: Date.now() - started,
    events, imp, activity: [...activity.entries()],
    lastId: rows.length ? Number(rows[rows.length - 1].id) : sinceId,
    more: rows.length >= LIVE_DELTA_ROWS,
  };
}

export function getLiveSeries(env, days, timeZone = 'UTC') {
  const d = days === 30 ? 30 : 7;
  return memoStat(`live:series:${d}:${timeZone}`, async () => {
    const trends = await getAnalyticsTrends(env, { preset: d === 30 ? '30d' : '7d', timeZone });
    const byDay = new Map();
    for (const row of trends?.rows || []) {
      const cur = byDay.get(row.metric_date) || { d: row.metric_date, pv: 0, jv: 0, ap: 0 };
      const n = Number(row.events || 0);
      if (row.event_type === 'page_view') cur.pv += n;
      else if (row.event_type === 'job_view') cur.jv += n;
      else if (row.event_type === 'job_apply_click') cur.ap += n;
      byDay.set(row.metric_date, cur);
    }
    return { ok: true, days: d, rows: [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d)) };
  }, { ttl: 5 * 60 * 1000 });
}
