// src/lib/platform/site-cache.js
// ════════════════════════════════════════════════════════════════
// Precomputed aggregates for the D1 FREE-TIER ROW-READ BUDGET.
//
// Cloudflare's free D1 plan allows 5,000,000 rows read per DAY and bills every
// row a query SCANS (not just the rows it returns). With a catalogue of
// thousands of jobs, live COUNT(*) / GROUP BY / LIKE queries cost thousands of
// rows each — a single cold homepage render read ~70,000 rows, so ~70 renders
// (or one crawler pass) exhausted the day, after which EVERY query failed with
// "exceeded D1's free tier daily row read limit" (blank job lists, admin login
// failures, error pages).
//
// So aggregates are computed ONCE per refresh in a single keyset-paginated
// pass over the active jobs and stored as JSON rows in `site_cache`. Pages read
// ONE row. Refresh cost is ~ (active jobs) rows, a few times a day.
//
// Rows:  stats · dir:companies · dir:skills · dir:locations · dir:remote_companies
//        · salary:bands · cat:counts · admin:status · admin:sources · admin:tiers · admin:source_types
// ════════════════════════════════════════════════════════════════

import { PUBLIC_JOB_STATUS_SQL, JOBS_PER_SITEMAP } from '../../config/constants.js';
import { getCategories } from '../content/categories.js';

const MEMO_MS = 5 * 60 * 1000;
const memo = new Map(); // key -> { at, value }
export const SITE_CACHE_MAX_AGE_MINUTES = 6 * 60 + 30;

export function clearSiteCacheMemo() { memo.clear(); }

// Reads and parses one cache row (null when absent / table missing).
export async function readSiteCache(env, key) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value;
  try {
    const row = await env.DB.prepare('SELECT value, updated_at FROM site_cache WHERE cache_key = ?').bind(key).first();
    if (!row) { memo.set(key, { at: Date.now(), value: null }); return null; }
    const value = JSON.parse(row.value);
    memo.set(key, { at: Date.now(), value });
    return value;
  } catch (e) { return null; }
}

// Several keys in ONE query (one D1 call instead of N).
export async function readSiteCacheMany(env, keys) {
  const out = {}; const missing = [];
  for (const k of keys) {
    const hit = memo.get(k);
    if (hit && Date.now() - hit.at < MEMO_MS) out[k] = hit.value; else missing.push(k);
  }
  if (missing.length) {
    try {
      const { results } = await env.DB.prepare(`SELECT cache_key, value FROM site_cache WHERE cache_key IN (${missing.map(() => '?').join(',')})`).bind(...missing).all();
      const found = new Map((results || []).map(r => [r.cache_key, r.value]));
      for (const k of missing) {
        let v = null; try { v = found.has(k) ? JSON.parse(found.get(k)) : null; } catch (e) {}
        memo.set(k, { at: Date.now(), value: v }); out[k] = v;
      }
    } catch (e) { for (const k of missing) out[k] = null; }
  }
  return out;
}

export async function getSiteStats(env) {
  return readSiteCache(env, 'stats');
}

// Age of the stats row in minutes (Infinity when it does not exist yet).
export async function siteCacheAgeMinutes(env) {
  try {
    const row = await env.DB.prepare(`SELECT (julianday('now') - julianday(updated_at)) * 1440 AS age FROM site_cache WHERE cache_key = 'stats'`).first();
    return row && row.age != null ? Number(row.age) : Infinity;
  } catch (e) { return Infinity; }
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function parseSalaryRange(salary) {
  if (!salary) return null;
  const nums = (String(salary).match(/\d+/g) || []).map(n => parseInt(n, 10));
  if (!nums.length) return null;
  return { min: nums[0], max: nums.length > 1 ? nums[1] : nums[0] };
}

async function upsertMany(env, entries) {
  // 1 D1 call per 90 statements (D1 counts a batch as a single subrequest)
  for (let i = 0; i < entries.length; i += 90) {
    const chunk = entries.slice(i, i + 90);
    await env.DB.batch(chunk.map(([key, value]) => env.DB.prepare(
      `INSERT INTO site_cache (cache_key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(cache_key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    ).bind(key, JSON.stringify(value))));
  }
}

const SCAN_PAGE = 4000;
const SCAN_MAX_PAGES = 40; // hard ceiling: 160k jobs
// Enough for ~2 pages of a skill's job listing (JOB_LISTING page size is 20);
// pagination past this falls back to the bounded live query (jobsBySkill).
const SKILL_ID_CAP = 60;
const TRACKED_SKILL_IDS = 1500; // distinct skill names that get a cached id-list

// Single keyset-paginated pass over the ACTIVE jobs → every aggregate at once.
export async function refreshSiteCache(env) {
  const categories = await getCategories(env).catch(() => []);
  const catKeys = (categories || []).filter(c => c && c.key).map(c => String(c.key).toLowerCase());
  const t1 = isoDaysAgo(1), t7 = isoDaysAgo(7), t30 = isoDaysAgo(30);

  const stats = { totalActive: 0, companies: 0, remote: 0, newDay: 0, newWeek: 0, newMonth: 0, withSalary: 0, sitemapBounds: [], refreshedAt: new Date().toISOString() };
  const companyCounts = new Map();  // lower -> { name, count }
  const remoteCompanies = new Map();
  const skillCounts = new Map();    // lower -> { name, count }
  // CRAWLER-BREADTH FIX: a bounded window (see lib/platform/job-window.js)
  // keeps any ONE page cheap, but a search-engine crawler that systematically
  // visits every unique /skills/:slug URL in the sitemap turns "cheap per page"
  // into "still huge in total" — thousands of distinct skills x a few thousand
  // rows each. Skills are the highest-cardinality entity on the site (free-text,
  // effectively unbounded), so recent job IDs per skill are captured here (id
  // DESC order, capped) and detail pages become an indexed `WHERE id IN (...)`
  // lookup (lib/directory/entities.js's jobsBySkill) instead of a scan+filter —
  // cheap on EVERY hit, not just repeat hits within the cache TTL.
  const skillJobIds = new Map();    // name -> number[] (capped at SKILL_ID_CAP)
  const locationCounts = new Map(); // raw location -> count
  const catCounts = Object.fromEntries(catKeys.map(k => [k, 0]));
  const salaryAgg = Object.fromEntries(catKeys.map(k => [k, { mins: [], maxs: [] }]));

  let lastId = Number.MAX_SAFE_INTEGER;
  let position = 0;
  for (let page = 0; page < SCAN_MAX_PAGES; page++) {
    const { results } = await env.DB.prepare(
      `SELECT id, title, company, location, skills, salary, remote_type, created_at FROM jobs
       WHERE ${PUBLIC_JOB_STATUS_SQL} AND id < ? ORDER BY id DESC LIMIT ${SCAN_PAGE}`
    ).bind(lastId).all();
    const rows = results || [];
    for (const j of rows) {
      if (position % JOBS_PER_SITEMAP === 0) stats.sitemapBounds.push(j.id);
      position++;
      stats.totalActive++;
      if (j.remote_type === 'fully_remote') stats.remote++;
      const created = String(j.created_at || '');
      if (created >= t1) stats.newDay++;
      if (created >= t7) stats.newWeek++;
      if (created >= t30) stats.newMonth++;
      const co = String(j.company || '').trim();
      if (co) {
        const lk = co.toLowerCase();
        const e = companyCounts.get(lk) || { name: co, count: 0 }; e.count++; companyCounts.set(lk, e);
        if (j.remote_type === 'fully_remote') { const r = remoteCompanies.get(co) || 0; remoteCompanies.set(co, r + 1); }
      }
      if (j.location) locationCounts.set(j.location, (locationCounts.get(j.location) || 0) + 1);
      if (j.skills && j.skills !== '[]') {
        try {
          for (const skillName of JSON.parse(j.skills)) {
            const name = String(skillName || '').trim(); if (!name) continue;
            const e = skillCounts.get(name) || { name, count: 0 }; e.count++; skillCounts.set(name, e);
            const ids = skillJobIds.get(name);
            if (ids) { if (ids.length < SKILL_ID_CAP) ids.push(j.id); }
            else skillJobIds.set(name, [j.id]);
          }
        } catch (e) { /* malformed skills JSON */ }
      }
      const title = String(j.title || '').toLowerCase();
      const range = parseSalaryRange(j.salary);
      if (range) stats.withSalary++;
      for (const k of catKeys) {
        if (title.includes(k)) {
          catCounts[k]++;
          if (range) { salaryAgg[k].mins.push(range.min); salaryAgg[k].maxs.push(range.max); }
        }
      }
    }
    if (rows.length < SCAN_PAGE) break;
    lastId = rows[rows.length - 1].id;
  }
  stats.companies = companyCounts.size;

  const avg = arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const bands = {};
  for (const k of catKeys) {
    const { mins, maxs } = salaryAgg[k];
    bands[k] = mins.length ? { count: mins.length, avgMin: avg(mins), avgMax: avg(maxs), low: Math.min(...mins), high: Math.max(...maxs) } : { count: 0 };
  }

  // Lifecycle / source breakdown for the admin dashboards (one grouped pass each).
  let statusRows = [], sourceRows = [];
  try { ({ results: statusRows } = await env.DB.prepare(`SELECT COALESCE(NULLIF(status,''),'(empty)') AS s, COUNT(*) AS c FROM jobs GROUP BY s ORDER BY c DESC`).all()); } catch (e) {}
  try { ({ results: sourceRows } = await env.DB.prepare(`SELECT COALESCE(source,'unknown') AS s, COUNT(*) AS c FROM jobs GROUP BY s ORDER BY c DESC LIMIT 20`).all()); } catch (e) {}
  let tierRows = [], sourceTypeRows = [];
  try { ({ results: tierRows } = await env.DB.prepare(`SELECT COALESCE(salary_tier,'UNKNOWN') AS tier, COUNT(*) AS c FROM jobs GROUP BY COALESCE(salary_tier,'UNKNOWN')`).all()); } catch (e) {}
  try { ({ results: sourceTypeRows } = await env.DB.prepare(`SELECT COALESCE(source_type,'provider') AS s, COUNT(*) AS c FROM jobs GROUP BY s`).all()); } catch (e) {}
  stats.totalAll = (statusRows || []).reduce((n, r) => n + Number(r.c || 0), 0);
  stats.hot = Number((tierRows || []).find(r => r.tier === 'HIGH')?.c || 0);

  const top = (m, n) => [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);
  const locations = [...locationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4000).map(([location, c]) => ({ location, c }));

  // Denormalize job_count / remote_job_count onto the `companies` table (see
  // db/schema/account-tables.js) so the public directory can sort/filter by
  // them directly instead of a correlated subquery per row on every page load.
  // One extra read of the (small) companies table; the counts themselves are
  // already computed above from the single pass over jobs.
  try {
    const { results: companyRows } = await env.DB.prepare('SELECT id, name FROM companies').all();
    if (companyRows?.length) {
      const updates = companyRows.map((c) => {
        const stat = companyCounts.get(String(c.name || '').trim().toLowerCase());
        const remote = remoteCompanies.get(c.name) || 0;
        return env.DB.prepare('UPDATE companies SET job_count = ?, remote_job_count = ? WHERE id = ?').bind(stat?.count || 0, remote, c.id);
      });
      for (let i = 0; i < updates.length; i += 90) await env.DB.batch(updates.slice(i, i + 90));
    }
  } catch (e) { /* companies table not migrated yet */ }

  await upsertMany(env, [
    ['stats', stats],
    ['dir:companies', top(companyCounts, 600).map(c => ({ name: c.name, count: c.count }))],
    ['dir:skills', top(skillCounts, TRACKED_SKILL_IDS).map(s => ({ name: s.name, count: s.count }))],
    // Only the top TRACKED_SKILL_IDS by frequency get an id-list (bounds the
    // JSON payload size); the rest fall back to the live bounded query, same as
    // before this cache existed — no regression, just no speedup for the very
    // long tail (which is also the lowest-traffic tail).
    ['dir:skill_jobs', Object.fromEntries(
      [...skillCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, TRACKED_SKILL_IDS)
        .map(([lower, meta]) => [meta.name, skillJobIds.get(meta.name) || []])
    )],
    ['dir:locations', locations],
    ['dir:remote_companies', [...remoteCompanies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([company, c]) => ({ company, c }))],
    ['salary:bands', bands],
    ['cat:counts', catCounts],
    ['admin:status', statusRows || []],
    ['admin:sources', sourceRows || []],
    ['admin:tiers', tierRows || []],
    ['admin:source_types', sourceTypeRows || []],
  ]);
  clearSiteCacheMemo();
  return { totalActive: stats.totalActive, companies: stats.companies, skills: skillCounts.size, locations: locations.length };
}
