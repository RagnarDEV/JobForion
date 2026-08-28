// Central analytics boundary for Phase 14.
// Analytics is secondary: every exported function fails closed and must never
// be allowed to break the request that produced the activity.

import { sha256Hex } from './accounts/tokens.js';
import { reportOperationalError } from './observability.js';

export const ANALYTICS_EVENT_TYPES = Object.freeze([
  'page_view', 'job_impression', 'job_view', 'job_apply_click', 'job_favorite',
  'job_share', 'company_view', 'company_follow', 'search', 'search_result_click',
  'filter_used', 'category_view', 'country_view', 'signup', 'login',
  'job_post_started', 'job_post_completed', 'premium_view', 'checkout_started',
  'payment_started', 'payment_success', 'payment_failed', 'payment_refunded',
  'featured_job_activated', 'sponsored_job_activated', 'affiliate_click',
  'affiliate_conversion',
]);

export const ANALYTICS_EVENT_SET = new Set(ANALYTICS_EVENT_TYPES);
export const ANALYTICS_RETENTION_OPTIONS = Object.freeze(['30', '60', '90', '180', '365', 'unlimited']);
export const ANALYTICS_TIMEZONES = Object.freeze(['UTC', 'America/New_York', 'Europe/London', 'Asia/Dubai', 'Asia/Tokyo']);
const MAX_BATCH = 20;
const D1_BATCH_SIZE = 75;
const MAX_TEXT = 180;
const MAX_META = 1000;
const REDACT_KEYS = /password|token|secret|api[_-]?key|card|cvv|authorization|cookie|email|phone|address|ip/i;

const text = (value, max = MAX_TEXT) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const int = value => { const n = Number.parseInt(value, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const safeEnum = (value, values) => values.includes(String(value)) ? String(value) : null;
const isoNow = () => new Date().toISOString();

async function runD1Batches(env, statements) {
  const output = [];
  for (let i = 0; i < statements.length; i += D1_BATCH_SIZE) {
    const chunk = statements.slice(i, i + D1_BATCH_SIZE);
    if (typeof env.DB.batch === 'function') output.push(...await env.DB.batch(chunk));
    else for (const statement of chunk) output.push(await statement.run());
  }
  return output;
}

function analyticsHashSecret(env = {}) {
  return String(env.ANALYTICS_HASH_SECRET || env.CSRF_SECRET || 'jobforion-analytics-pseudonymous-key');
}

function metadataObject(event) {
  try {
    const parsed = JSON.parse(event?.metadata || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) { return {}; }
}

function companySlugFromEvent(event) {
  const metadata = metadataObject(event);
  const candidate = metadata.slug || String(event?.page || '').match(/^\/companies\/([a-z0-9-]{1,120})(?:\/|$)/i)?.[1];
  return String(candidate || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 120) || null;
}

async function enrichEventAttribution(env, events) {
  const jobIds = [...new Set(events.map(event => event.job_id).filter(Boolean))].slice(0, MAX_BATCH);
  const companySlugs = [...new Set(events.map(companySlugFromEvent).filter(Boolean))].slice(0, MAX_BATCH);
  const [jobRows, companyRows] = await Promise.all([
    jobIds.length ? env.DB.prepare(`SELECT id,company_id FROM jobs WHERE id IN (${jobIds.map(() => '?').join(',')})`).bind(...jobIds).all() : { results: [] },
    companySlugs.length ? env.DB.prepare(`SELECT id,slug FROM companies WHERE slug IN (${companySlugs.map(() => '?').join(',')})`).bind(...companySlugs).all() : { results: [] },
  ]);
  const jobs = new Map((jobRows?.results || []).map(row => [Number(row.id), row]));
  const companies = new Map((companyRows?.results || []).map(row => [String(row.slug).toLowerCase(), Number(row.id)]));
  return events.map(event => {
    const jobId = event.job_id ? Number(event.job_id) : null;
    const job = jobId ? jobs.get(jobId) : null;
    const companyId = event.company_id || (job?.company_id ? Number(job.company_id) : companies.get(companySlugFromEvent(event)) || null);
    return { ...event, job_id: job ? jobId : null, company_id: companyId || null };
  });
}

async function visitorHash(env, event) {
  const identity = event.session_id || (event.user_id ? `user:${event.user_id}` : '');
  if (!identity) return null;
  return sha256Hex(`${event.metric_date}:${analyticsHashSecret(env)}:${identity}`);
}

export function localDateKey(date = new Date(), timeZone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch (e) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(date); }
}

function scrubMetadata(value, depth = 0) {
  if (depth > 2 || value === null || value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return text(value, 120);
  if (Array.isArray(value)) return value.slice(0, 20).map(v => scrubMetadata(v, depth + 1)).filter(v => v !== undefined);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) if (!REDACT_KEYS.test(key)) {
      const safe = scrubMetadata(item, depth + 1);
      if (safe !== undefined) out[text(key, 40)] = safe;
    }
    return out;
  }
  return undefined;
}

export function normalizeAnalyticsEvent(input = {}, trusted = {}) {
  const eventType = safeEnum(input.event_type || input.type, ANALYTICS_EVENT_TYPES);
  if (!eventType) return null;
  const metadata = scrubMetadata(input.metadata || input.meta || {});
  const raw = {
    event_id: text(input.event_id || crypto.randomUUID(), 80),
    event_type: eventType,
    session_id: text(input.session_id, 100) || null,
    user_id: int(trusted.user_id),
    job_id: int(input.job_id),
    // Client payloads may describe behavior, but they cannot claim ownership
    // of a company or override the request-derived country. Company IDs are
    // attached only by trusted server context or the D1 enrichment pass.
    company_id: int(trusted.company_id),
    country: text(trusted.country || input.country || 'XX', 2).toUpperCase().replace(/[^A-Z?]/g, '').slice(0, 2) || 'XX',
    device_type: safeEnum(input.device_type, ['mobile', 'tablet', 'desktop']) || 'unknown',
    browser: text(input.browser, 60) || null,
    os: text(input.os, 60) || null,
    referrer: text(input.referrer, 240) || null,
    source: text(input.source, 80) || null,
    medium: text(input.medium, 80) || null,
    campaign: text(input.campaign, 120) || null,
    landing_page: text(input.landing_page, 240) || null,
    page: text(input.page, 240) || null,
    metadata: JSON.stringify(metadata || {}),
    metric_date: localDateKey(new Date(), trusted.timeZone || 'UTC'),
    created_at: isoNow(),
  };
  return raw;
}

function isBot(userAgent = '') {
  return /bot|crawler|spider|slurp|headless|uptime|monitor/i.test(userAgent);
}

export async function enqueueAnalyticsEvents(env, events, trusted = {}) {
  if (!env?.DB || !Array.isArray(events) || !events.length) return { accepted: 0 };
  const settings = trusted.settings || {};
  if (settings.analytics_enabled === '0') return { accepted: 0, disabled: true };
  const userAgent = text(trusted.userAgent, 180);
  if (isBot(userAgent)) return { accepted: 0, bot: true };
  const normalized = events.slice(0, MAX_BATCH).map(event => normalizeAnalyticsEvent(event, trusted)).filter(Boolean);
  if (!normalized.length) return { accepted: 0 };
  try {
    const enriched = await enrichEventAttribution(env, normalized);
    const statements = enriched.map(event => env.DB.prepare(`INSERT OR IGNORE INTO analytics_event_queue (event_id,event_type,session_id,user_id,job_id,company_id,country,device_type,browser,os,referrer,source,medium,campaign,landing_page,page,metadata,metric_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(event.event_id, event.event_type, event.session_id, event.user_id, event.job_id, event.company_id, event.country, event.device_type, event.browser, event.os, event.referrer, event.source, event.medium, event.campaign, event.landing_page, event.page, event.metadata, event.metric_date, event.created_at));
    const results = await env.DB.batch(statements);
    const accepted = (results || []).reduce((sum, result) => sum + (Number(result?.meta?.changes || 0) > 0 ? 1 : 0), 0);
    return { accepted };
  } catch (e) {
    reportOperationalError('analytics.enqueue', e);
    return { accepted: 0, error: 'analytics_enqueue_failed' };
  }
}

export async function recordTrustedAnalyticsEvent(env, event, trusted = {}) {
  return enqueueAnalyticsEvents(env, [event], { ...trusted, isTrusted: true });
}

export async function aggregateAnalytics(env, limit = 300) {
  const bounded = Math.min(300, Math.max(1, Number(limit) || 300));
  const result = { processed: 0, aggregated: 0, errors: 0 };
  try {
    const { results } = await env.DB.prepare('SELECT * FROM analytics_event_queue WHERE processed_at IS NULL ORDER BY id ASC LIMIT ?').bind(bounded).all();
    if (!results?.length) return result;
    const groups = new Map();
    const searchGroups = new Map();
    const filterGroups = new Map();
    const uniqueEntries = new Map();
    const eventHashes = await Promise.all(results.map(event => visitorHash(env, event)));
    const dimensionKey = event => [event.job_id || 0, event.company_id || 0, event.country || 'XX', event.device_type || 'unknown', event.source || 'direct', event.medium || 'none'].join('|');
    const addUniqueEntry = (eventType, dimension, event, hash) => {
      if (!hash) return;
      const key = `${event.metric_date}|${eventType}|${dimension}|${hash}`;
      uniqueEntries.set(key, { metric_date: event.metric_date, event_type: eventType, dimension_key: dimension, visitor_hash: hash });
    };
    for (let index = 0; index < results.length; index++) {
      const event = results[index];
      const hash = eventHashes[index];
      const key = [event.metric_date, event.event_type, dimensionKey(event)].join('|');
      const current = groups.get(key) || { metric_date: event.metric_date, event_type: event.event_type, job_id: event.job_id || 0, company_id: event.company_id || 0, country: event.country || 'XX', device_type: event.device_type || 'unknown', source: event.source || 'direct', medium: event.medium || 'none', events: 0, unique_events: 0, identity_events: 0, metadata: {}, unique_key: `${event.metric_date}|${event.event_type}|${dimensionKey(event)}` };
      current.events += 1;
      if (hash) { current.identity_events += 1; addUniqueEntry(event.event_type, dimensionKey(event), event, hash); }
      let metadata = {};
      try { metadata = JSON.parse(event.metadata || '{}'); if (metadata.query) current.metadata.query = text(metadata.query, 120); if (metadata.results_count !== undefined) current.metadata.results_count = Number(metadata.results_count) || 0; } catch (e) {}
      groups.set(key, current);
      if ((event.event_type === 'search' || event.event_type === 'search_result_click') && metadata.query) {
        const query = text(metadata.query, 120).toLowerCase();
        const searchKey = `${event.metric_date}|${query}`;
        const search = searchGroups.get(searchKey) || { metric_date: event.metric_date, query, searches: 0, zero_result_searches: 0, result_clicks: 0, identity_events: 0, unique_key: `${event.metric_date}|search|search:${query}` };
        if (event.event_type === 'search') {
          search.searches += 1;
          if (Number(metadata.results_count || 0) === 0) search.zero_result_searches += 1;
          if (hash) { search.identity_events += 1; addUniqueEntry('search', `search:${query}`, event, hash); }
        }
        if (event.event_type === 'search_result_click') search.result_clicks += 1;
        searchGroups.set(searchKey, search);
      }
      if (event.event_type === 'filter_used' && metadata.filter && metadata.value) {
        const filterKey = `${event.metric_date}|${text(metadata.filter, 60)}|${text(metadata.value, 120)}`;
        const filter = filterGroups.get(filterKey) || { metric_date: event.metric_date, filter_name: text(metadata.filter, 60), filter_value: text(metadata.value, 120), uses: 0 };
        filter.uses += 1;
        filterGroups.set(filterKey, filter);
      }
    }
    // First persist only hashed visitor fingerprints. INSERT OR IGNORE makes
    // the operation idempotent across hourly runs and prevents sum-of-batches
    // overcounting without ever storing the source session/user identifier.
    const uniqueStatements = [...uniqueEntries.values()].map(entry => env.DB.prepare('INSERT OR IGNORE INTO analytics_daily_uniques (metric_date,event_type,dimension_key,visitor_hash) VALUES (?,?,?,?)').bind(entry.metric_date, entry.event_type, entry.dimension_key, entry.visitor_hash));
    const uniqueResults = uniqueStatements.length ? await runD1Batches(env, uniqueStatements) : [];
    const insertedUniqueCounts = new Map();
    [...uniqueEntries.values()].forEach((entry, index) => {
      if (Number(uniqueResults[index]?.meta?.changes || 0) > 0) {
        const key = `${entry.metric_date}|${entry.event_type}|${entry.dimension_key}`;
        insertedUniqueCounts.set(key, (insertedUniqueCounts.get(key) || 0) + 1);
      }
    });
    for (const group of groups.values()) {
      group.unique_events = group.identity_events ? (insertedUniqueCounts.get(group.unique_key) || 0) : group.events;
    }
    for (const search of searchGroups.values()) {
      search.unique_searches = search.identity_events ? (insertedUniqueCounts.get(search.unique_key) || 0) : search.searches;
    }
    const statements = [];
    for (const group of groups.values()) statements.push(env.DB.prepare(`INSERT INTO analytics_daily (metric_date,event_type,job_id,company_id,country,device_type,source,medium,event_count,unique_count,metadata,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(metric_date,event_type,job_id,company_id,country,device_type,source,medium) DO UPDATE SET event_count=analytics_daily.event_count+excluded.event_count,unique_count=analytics_daily.unique_count+excluded.unique_count,metadata=excluded.metadata,updated_at=CURRENT_TIMESTAMP`).bind(group.metric_date, group.event_type, group.job_id, group.company_id, group.country, group.device_type, group.source, group.medium, group.events, group.unique_events, JSON.stringify(group.metadata)));
    for (const search of searchGroups.values()) statements.push(env.DB.prepare(`INSERT INTO analytics_search_daily (metric_date,query,searches,zero_result_searches,result_clicks,unique_searches,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(metric_date,query) DO UPDATE SET searches=analytics_search_daily.searches+excluded.searches,zero_result_searches=analytics_search_daily.zero_result_searches+excluded.zero_result_searches,result_clicks=analytics_search_daily.result_clicks+excluded.result_clicks,unique_searches=analytics_search_daily.unique_searches+excluded.unique_searches,updated_at=CURRENT_TIMESTAMP`).bind(search.metric_date, search.query, search.searches, search.zero_result_searches, search.result_clicks, search.unique_searches));
    for (const filter of filterGroups.values()) statements.push(env.DB.prepare(`INSERT INTO analytics_filter_daily (metric_date,filter_name,filter_value,uses,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(metric_date,filter_name,filter_value) DO UPDATE SET uses=analytics_filter_daily.uses+excluded.uses,updated_at=CURRENT_TIMESTAMP`).bind(filter.metric_date, filter.filter_name, filter.filter_value, filter.uses));
    for (const event of results) statements.push(env.DB.prepare('UPDATE analytics_event_queue SET processed_at=CURRENT_TIMESTAMP WHERE id=? AND processed_at IS NULL').bind(event.id));
    await runD1Batches(env, statements);
    result.processed = results.length;
    result.aggregated = groups.size + searchGroups.size + filterGroups.size;
    return result;
  } catch (e) { result.errors = 1; return result; }
}

export async function cleanupAnalytics(env, retention = '90') {
  if (retention === 'unlimited') return { deleted: 0, unlimited: true };
  const days = [30, 60, 90, 180, 365].includes(Number(retention)) ? Number(retention) : 90;
  try {
    const queue = await env.DB.prepare("DELETE FROM analytics_event_queue WHERE created_at < datetime('now', '-' || ? || ' days')").bind(days).run();
    const visits = await env.DB.prepare("DELETE FROM visits WHERE created_at < datetime('now', '-' || ? || ' days')").bind(days).run();
    const daily = await env.DB.prepare("DELETE FROM analytics_daily WHERE metric_date < date('now', '-' || ? || ' days')").bind(days).run();
    const searches = await env.DB.prepare("DELETE FROM analytics_search_daily WHERE metric_date < date('now', '-' || ? || ' days')").bind(days).run();
    const filters = await env.DB.prepare("DELETE FROM analytics_filter_daily WHERE metric_date < date('now', '-' || ? || ' days')").bind(days).run();
    const uniques = await env.DB.prepare("DELETE FROM analytics_daily_uniques WHERE metric_date < date('now', '-' || ? || ' days')").bind(days).run();
    const alerts = await env.DB.prepare("DELETE FROM analytics_alerts WHERE status='resolved' AND created_at < datetime('now', '-' || ? || ' days')").bind(days).run();
    return { deleted: [queue, visits, daily, searches, filters, uniques, alerts].reduce((sum, item) => sum + Number(item.meta?.changes || 0), 0), retention: days };
  } catch (e) { return { deleted: 0, error: 'analytics_cleanup_failed' }; }
}

function validDate(date) { return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')); }
export function dateRange(input = {}) {
  const today = localDateKey(new Date(), input.timeZone || 'UTC');
  const allowed = ['today', 'yesterday', '7d', '30d', '90d', 'month', 'last_month', 'year', 'custom'];
  const preset = allowed.includes(input.preset) ? input.preset : '30d';
  if (preset === 'custom' && validDate(input.from) && validDate(input.to) && input.from <= input.to) return { preset, from: input.from, to: input.to };
  const current = new Date(`${today}T12:00:00Z`);
  const pad = n => String(n).padStart(2, '0');
  const dateOf = date => date.toISOString().slice(0, 10);
  let from = today;
  let to = today;
  if (preset === 'yesterday') { const d = new Date(current); d.setUTCDate(d.getUTCDate() - 1); from = to = dateOf(d); }
  else if (['7d', '30d', '90d'].includes(preset)) { const d = new Date(current); d.setUTCDate(d.getUTCDate() - ({ '7d': 6, '30d': 29, '90d': 89 }[preset])); from = dateOf(d); }
  else if (preset === 'month') from = `${today.slice(0, 7)}-01`;
  else if (preset === 'last_month') { const first = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)); const last = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 0)); from = `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-01`; to = dateOf(last); }
  else if (preset === 'year') from = `${today.slice(0, 4)}-01-01`;
  return { preset, from, to };
}

function rangeWhere(range, column = 'metric_date') { return { sql: `${column} >= ? AND ${column} <= ?`, binds: [range.from, range.to] }; }

function previousDateRange(range) {
  const fromDate = new Date(`${range.from}T12:00:00Z`);
  const toDate = new Date(`${range.to}T12:00:00Z`);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) || toDate < fromDate) return null;
  const span = Math.max(1, Math.round((toDate - fromDate) / 86400000) + 1);
  const previousTo = new Date(fromDate);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - span + 1);
  return { from: previousFrom.toISOString().slice(0, 10), to: previousTo.toISOString().slice(0, 10) };
}

function percentChange(current, previous) {
  const now = Number(current || 0);
  const prior = Number(previous || 0);
  if (prior === 0) return now === 0 ? 0 : null;
  return Number(((now - prior) / prior * 100).toFixed(2));
}

export async function getAnalyticsOverview(env, input = {}) {
  const range = dateRange(input);
  const w = rangeWhere(range);
  const previous = previousDateRange(range);
  const fallback = { range, traffic: { visitors: 0, unique_visitors: 0, page_views: 0, sessions: 0, new_users: 0, returning_users: 0 }, jobs: { total: 0, active: 0, new_jobs: 0, views: 0, apply_clicks: 0, conversion_rate: 0 }, companies: { total: 0, active: 0, new_companies: 0, jobs_posted: 0, views: 0 }, revenue: { gross_minor: null, net_minor: null, payment_fees_minor: null, refunds_minor: null, successful_payments: 0, failed_payments: 0, average_order_minor: null, currencies: [] }, funnel: [], growth: { comparison: 'not_available', period: previous }, health: { queued: 0, processed_last_at: null, errors: 0 } };
  try {
    const [events, previousEvents, jobs, companies, revenue, refunds, health] = await Promise.all([
      env.DB.prepare(`SELECT event_type, SUM(event_count) events, SUM(unique_count) uniques FROM analytics_daily WHERE ${w.sql} GROUP BY event_type`).bind(...w.binds).all(),
      previous ? env.DB.prepare(`SELECT event_type, SUM(event_count) events, SUM(unique_count) uniques FROM analytics_daily WHERE metric_date >= ? AND metric_date <= ? GROUP BY event_type`).bind(previous.from, previous.to).all() : { results: [] },
      env.DB.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active, SUM(CASE WHEN created_at >= ? AND created_at <= ? THEN 1 ELSE 0 END) new_jobs FROM jobs`).bind(`${range.from} 00:00:00`, `${range.to} 23:59:59`).all(),
      env.DB.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active, SUM(CASE WHEN created_at >= ? AND created_at <= ? THEN 1 ELSE 0 END) new_companies FROM companies`).bind(`${range.from} 00:00:00`, `${range.to} 23:59:59`).all(),
      env.DB.prepare(`SELECT currency, SUM(CASE WHEN status='succeeded' THEN gross_amount_minor ELSE 0 END) gross_minor, SUM(CASE WHEN status='succeeded' THEN net_amount_minor ELSE 0 END) net_minor, SUM(CASE WHEN status='succeeded' THEN provider_fee_minor ELSE 0 END) payment_fees_minor, SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) successful_payments, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed_payments, AVG(CASE WHEN status='succeeded' THEN gross_amount_minor END) average_order_minor FROM monetization_transactions WHERE created_at >= ? AND created_at <= ? GROUP BY currency`).bind(`${range.from} 00:00:00`, `${range.to} 23:59:59`).all(),
      env.DB.prepare(`SELECT currency,SUM(amount_minor) refunds_minor FROM monetization_refunds WHERE status IN ('processed','succeeded','completed') AND created_at >= ? AND created_at <= ? GROUP BY currency`).bind(`${range.from} 00:00:00`, `${range.to} 23:59:59`).all(),
      env.DB.prepare('SELECT SUM(CASE WHEN processed_at IS NULL THEN 1 ELSE 0 END) queued, MAX(processed_at) processed_last_at FROM analytics_event_queue').all(),
    ]);
    const map = Object.fromEntries((events.results || []).map(row => [row.event_type, { events: Number(row.events || 0), uniques: Number(row.uniques || 0) }]));
    const previousMap = Object.fromEntries((previousEvents?.results || []).map(row => [row.event_type, { events: Number(row.events || 0), uniques: Number(row.uniques || 0) }]));
    const pageViews = map.page_view?.events || 0;
    const uniqueVisitors = map.page_view?.uniques || 0;
    const views = map.job_view?.events || 0;
    const applies = map.job_apply_click?.events || 0;
    const revenueRows = (revenue.results || []).map(row => ({ currency: row.currency, gross_minor: Number(row.gross_minor || 0), net_minor: Number(row.net_minor || 0), payment_fees_minor: Number(row.payment_fees_minor || 0), average_order_minor: row.average_order_minor === null ? null : Number(row.average_order_minor || 0), successful_payments: Number(row.successful_payments || 0), failed_payments: Number(row.failed_payments || 0) }));
    const refundRows = refunds.results || [];
    const growth = {
      comparison: previous ? 'previous_equal_period' : 'not_available',
      period: previous,
      unique_visitors_pct: previous ? percentChange(uniqueVisitors, previousMap.page_view?.uniques) : null,
      page_views_pct: previous ? percentChange(pageViews, previousMap.page_view?.events) : null,
      job_views_pct: previous ? percentChange(views, previousMap.job_view?.events) : null,
      apply_clicks_pct: previous ? percentChange(applies, previousMap.job_apply_click?.events) : null,
      new_users_pct: previous ? percentChange(map.signup?.uniques || 0, previousMap.signup?.uniques || 0) : null,
    };
    return { range, traffic: { visitors: uniqueVisitors, unique_visitors: uniqueVisitors, page_views: pageViews, sessions: map.page_view?.uniques || 0, new_users: map.signup?.uniques || 0, returning_users: Math.max(0, uniqueVisitors - (map.signup?.uniques || 0)) }, jobs: { total: Number(jobs.results?.[0]?.total || 0), active: Number(jobs.results?.[0]?.active || 0), new_jobs: Number(jobs.results?.[0]?.new_jobs || 0), views, apply_clicks: applies, conversion_rate: views ? Number((applies / views * 100).toFixed(2)) : 0 }, companies: { total: Number(companies.results?.[0]?.total || 0), active: Number(companies.results?.[0]?.active || 0), new_companies: Number(companies.results?.[0]?.new_companies || 0), jobs_posted: map.job_post_completed?.events || 0, views: map.company_view?.events || 0 }, revenue: { gross_minor: revenueRows.length === 1 ? revenueRows[0].gross_minor : null, net_minor: revenueRows.length === 1 ? revenueRows[0].net_minor : null, payment_fees_minor: revenueRows.length === 1 ? revenueRows[0].payment_fees_minor : null, refunds_minor: refundRows.length === 1 ? Number(refundRows[0].refunds_minor || 0) : null, successful_payments: revenueRows.reduce((sum, row) => sum + row.successful_payments, 0), failed_payments: revenueRows.reduce((sum, row) => sum + row.failed_payments, 0), average_order_minor: revenueRows.length === 1 ? revenueRows[0].average_order_minor : null, currencies: revenueRows.map(row => row.currency) }, funnel: [{ key: 'visitor', label: 'Visitors', count: uniqueVisitors }, { key: 'search', label: 'Search', count: map.search?.uniques || 0 }, { key: 'impression', label: 'Job impressions', count: map.job_impression?.uniques || 0 }, { key: 'view', label: 'Job views', count: views }, { key: 'apply', label: 'Apply clicks', count: applies }], growth, health: { queued: Number(health.results?.[0]?.queued || 0), processed_last_at: health.results?.[0]?.processed_last_at || null, errors: 0 } };
  } catch (e) { return fallback; }
}

async function groupedQuery(env, table, range, groupBy, orderBy = 'events DESC', limit = 50) {
  const w = rangeWhere(range);
  const allowedTables = new Set(['analytics_daily']);
  const allowedGroups = new Set(['source', 'medium', 'country', 'device_type', 'job_id', 'company_id', 'event_type']);
  if (!allowedTables.has(table) || !allowedGroups.has(groupBy)) return [];
  try { const { results } = await env.DB.prepare(`SELECT ${groupBy} key, SUM(event_count) events, SUM(unique_count) uniques FROM ${table} WHERE ${w.sql} GROUP BY ${groupBy} ORDER BY ${orderBy} LIMIT ?`).bind(...w.binds, Math.min(100, Math.max(1, Number(limit) || 50))).all(); return results || []; } catch (e) { return []; }
}

export async function getAnalyticsReport(env, type, input = {}) {
  const range = dateRange(input);
  const rows = await groupedQuery(env, 'analytics_daily', range, type === 'traffic' ? 'source' : type === 'devices' ? 'device_type' : type === 'geography' ? 'country' : type === 'companies' ? 'company_id' : 'job_id');
  return { type, range, rows };
}

export async function getAnalyticsFunnel(env, input = {}) { const overview = await getAnalyticsOverview(env, input); return { range: overview.range, stages: overview.funnel.map((stage, i, all) => ({ ...stage, conversion: i === 0 || !all[i - 1].count ? (i === 0 ? 100 : 0) : Number((stage.count / all[i - 1].count * 100).toFixed(2)), dropoff: i === 0 || !all[i - 1].count ? 0 : Number((100 - stage.count / all[i - 1].count * 100).toFixed(2)) })) }; }

export async function getAnalyticsHealth(env) {
  try { const { results } = await env.DB.prepare('SELECT SUM(CASE WHEN processed_at IS NULL THEN 1 ELSE 0 END) queued, MAX(created_at) last_event_at, MAX(processed_at) last_processed_at FROM analytics_event_queue').all(); return results?.[0] || { queued: 0 }; } catch (e) { return { queued: 0, error: 'health_unavailable' }; }
}

export function csvEscape(value) { const raw = String(value ?? ''); return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw; }
export function rowsToCsv(rows = []) { if (!rows.length) return 'key,events,uniques\n'; const headers = Object.keys(rows[0]); return `${headers.join(',')}\n${rows.map(row => headers.map(key => csvEscape(row[key])).join(',')).join('\n')}\n`; }

export async function getAnalyticsSearches(env, input = {}) {
  const range = dateRange(input);
  try { const { results } = await env.DB.prepare(`SELECT query,SUM(searches) searches,SUM(zero_result_searches) zero_result_searches,SUM(result_clicks) result_clicks,SUM(unique_searches) unique_searches FROM analytics_search_daily WHERE metric_date >= ? AND metric_date <= ? GROUP BY query ORDER BY searches DESC LIMIT 100`).bind(range.from, range.to).all(); return { range, rows: results || [] }; } catch (e) { return { range, rows: [] }; }
}

export async function getAnalyticsFilters(env, input = {}) {
  const range = dateRange(input);
  try { const { results } = await env.DB.prepare(`SELECT filter_name,filter_value,SUM(uses) uses FROM analytics_filter_daily WHERE metric_date >= ? AND metric_date <= ? GROUP BY filter_name,filter_value ORDER BY uses DESC LIMIT 100`).bind(range.from, range.to).all(); return { range, rows: results || [] }; } catch (e) { return { range, rows: [] }; }
}

export async function getAnalyticsRealtime(env) {
  try {
    const { results } = await env.DB.prepare(`SELECT event_type,job_id,company_id,country,device_type,page,created_at FROM analytics_event_queue ORDER BY id DESC LIMIT 50`).all();
    return (results || []).map(row => ({ event_type: row.event_type, job_id: row.job_id || null, company_id: row.company_id || null, country: row.country || 'XX', device_type: row.device_type || 'unknown', page: row.page || null, created_at: row.created_at }));
  } catch (e) { return []; }
}

export async function getAnalyticsAlerts(env) {
  try { const { results } = await env.DB.prepare(`SELECT * FROM analytics_alerts WHERE status='open' ORDER BY id DESC LIMIT 50`).all(); return results || []; } catch (e) { return []; }
}

export async function evaluateAnalyticsAlerts(env, settings = {}) {
  const timezone = settings.analytics_timezone || 'UTC';
  const today = localDateKey(new Date(), timezone);
  const yesterdayDate = new Date(`${today}T12:00:00Z`); yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = localDateKey(yesterdayDate, timezone);
  try {
    const { results } = await env.DB.prepare(`SELECT metric_date,event_type,SUM(event_count) count FROM analytics_daily WHERE metric_date IN (?,?) AND event_type IN ('page_view','job_apply_click','payment_success','payment_failed') GROUP BY metric_date,event_type`).bind(today, yesterday).all();
    const values = Object.fromEntries((results || []).map(row => [`${row.metric_date}:${row.event_type}`, Number(row.count || 0)]));
    const trafficToday = values[`${today}:page_view`] || 0;
    const trafficYesterday = values[`${yesterday}:page_view`] || 0;
    const dropThreshold = Number(settings.analytics_alert_traffic_drop_pct || 30);
    if (trafficYesterday > 10 && trafficToday < trafficYesterday * (1 - dropThreshold / 100)) await createAnalyticsAlert(env, 'traffic_drop', dropThreshold, Number((100 - trafficToday / trafficYesterday * 100).toFixed(2)), '24h', `Traffic dropped ${Number((100 - trafficToday / trafficYesterday * 100).toFixed(2))}% compared with the previous day.`);
    const failed = values[`${today}:payment_failed`] || 0;
    const success = values[`${today}:payment_success`] || 0;
    const failureRate = failed + success ? failed / (failed + success) * 100 : 0;
    const paymentThreshold = Number(settings.analytics_alert_payment_failure_pct || 15);
    if (failed + success >= 3 && failureRate > paymentThreshold) await createAnalyticsAlert(env, 'payment_failure_rate', paymentThreshold, Number(failureRate.toFixed(2)), '24h', `Payment failure rate reached ${Number(failureRate.toFixed(2))}%.`);
    return { checked: true };
  } catch (e) { return { checked: false, error: 'analytics_alert_check_failed' }; }
}

async function createAnalyticsAlert(env, type, threshold, actual, period, message) {
  const recent = await env.DB.prepare(`SELECT id FROM analytics_alerts WHERE alert_type=? AND status='open' AND created_at >= datetime('now','-1 day') LIMIT 1`).bind(type).all();
  if (recent.results?.length) return false;
  await env.DB.prepare(`INSERT INTO analytics_alerts (alert_type,severity,status,threshold,actual_value,period,message,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(type, actual > threshold * 1.5 ? 'critical' : 'warning', 'open', threshold, actual, period, message).run();
  return true;
}

export async function purgeAnalytics(env, { before } = {}) {
  if (!validDate(before) || String(before) >= new Date().toISOString().slice(0, 10)) return { ok: false, error: 'The purge date must be before today.' };
  const cutoff = `${before} 00:00:00`;
  try {
    const statements = [
      env.DB.prepare('DELETE FROM analytics_event_queue WHERE created_at < ?').bind(cutoff),
      env.DB.prepare('DELETE FROM visits WHERE created_at < ?').bind(cutoff),
      env.DB.prepare('DELETE FROM analytics_daily WHERE metric_date < ?').bind(before),
      env.DB.prepare('DELETE FROM analytics_search_daily WHERE metric_date < ?').bind(before),
      env.DB.prepare('DELETE FROM analytics_filter_daily WHERE metric_date < ?').bind(before),
      env.DB.prepare('DELETE FROM analytics_daily_uniques WHERE metric_date < ?').bind(before),
      env.DB.prepare('DELETE FROM analytics_alerts WHERE created_at < ?').bind(cutoff),
    ];
    const results = await env.DB.batch(statements);
    return { ok: true, deleted: results.reduce((sum, item) => sum + Number(item?.meta?.changes || 0), 0), before };
  } catch (e) { return { ok: false, error: 'Unable to purge analytics data.' }; }
}

export async function resolveAnalyticsAlert(env, alertId) {
  const id = int(alertId);
  if (!id) return { ok: false };
  try { await env.DB.prepare(`UPDATE analytics_alerts SET status='resolved',resolved_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run(); return { ok: true }; } catch (e) { return { ok: false }; }
}

export async function getAnalyticsTrends(env, input = {}) {
  const range = dateRange(input);
  try { const { results } = await env.DB.prepare(`SELECT metric_date,event_type,SUM(event_count) events,SUM(unique_count) uniques FROM analytics_daily WHERE metric_date >= ? AND metric_date <= ? AND event_type IN ('page_view','job_view','job_apply_click','search','payment_success','payment_failed') GROUP BY metric_date,event_type ORDER BY metric_date ASC`).bind(range.from, range.to).all(); return { range, rows: results || [] }; } catch (e) { return { range, rows: [] }; }
}

export async function getAnalyticsTopJobs(env, input = {}) {
  const range = dateRange(input);
  try { const { results } = await env.DB.prepare(`SELECT d.job_id,j.title,j.company,SUM(CASE WHEN d.event_type='job_view' THEN d.event_count ELSE 0 END) views,SUM(CASE WHEN d.event_type='job_apply_click' THEN d.event_count ELSE 0 END) apply_clicks,SUM(CASE WHEN d.event_type='job_impression' THEN d.event_count ELSE 0 END) impressions FROM analytics_daily d LEFT JOIN jobs j ON j.id=d.job_id WHERE d.job_id > 0 AND d.metric_date >= ? AND d.metric_date <= ? GROUP BY d.job_id ORDER BY views DESC LIMIT 50`).bind(range.from, range.to).all(); return { range, rows: results || [] }; } catch (e) { return { range, rows: [] }; }
}

export async function getAnalyticsTopCompanies(env, input = {}) {
  const range = dateRange(input);
  try { const { results } = await env.DB.prepare(`SELECT d.company_id,c.name,SUM(CASE WHEN d.event_type='company_view' THEN d.event_count ELSE 0 END) views,SUM(CASE WHEN d.event_type='job_view' THEN d.event_count ELSE 0 END) job_views,SUM(CASE WHEN d.event_type='job_apply_click' THEN d.event_count ELSE 0 END) apply_clicks FROM analytics_daily d LEFT JOIN companies c ON c.id=d.company_id WHERE d.company_id > 0 AND d.metric_date >= ? AND d.metric_date <= ? GROUP BY d.company_id ORDER BY job_views DESC LIMIT 50`).bind(range.from, range.to).all(); return { range, rows: results || [] }; } catch (e) { return { range, rows: [] }; }
}
