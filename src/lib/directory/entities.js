// src/lib/directory/entities.js
// ════════════════════════════════════════════════════════════════
// Derives "directory" entities (companies, countries, cities, skills,
// salary bands) directly from the existing `jobs` table in D1 — no
// new tables, no schema changes, fully backward compatible.
//
// NOTE on countries/cities: the `location` column is free text
// (e.g. "Austin, TX", "Penang, Malaysia", "Remote"). There is no
// reliable geo-data source in the current schema, so city/country
// are derived with a best-effort heuristic (split on comma). This
// is documented here explicitly: it will occasionally misclassify
// a US state as a "country" segment. Acceptable for SEO directory
// pages, but flagged for a future proper geo-normalization pass.
// ════════════════════════════════════════════════════════════════

import { readSiteCache } from '../platform/site-cache.js';
import { windowedJobs } from '../platform/job-window.js';
import { JOB_MANUAL_PIN_SORT_SQL, PUBLIC_JOB_STATUS_SQL, PUBLIC_JOB_STATUS_NOINDEX_SQL, JOB_LISTING_COLUMNS } from '../../config/constants.js';
import { getOverrides, applyDirectoryOverrides } from './directory-overrides.js';
import { canonicalizeRegion } from './geo-data.js';

// ════════════════════════════════════════════════════════════════
// THIN-CONTENT THRESHOLD — a directory detail page (company/skill/
// country) with fewer than this many jobs is "thin content": too little
// unique text for a search engine to treat as a distinct, useful page.
// Submitting thousands of 1-job company pages via the sitemap is exactly
// what causes Google to mass-flag a young domain's URLs as "Discovered —
// currently not indexed" (crawl-budget/quality throttling) — see
// pages/seo-pages.js (per-page noindex) and lib/seo/sitemap.js (sitemap
// exclusion), both of which import this same constant so the "is this
// page worth indexing" rule only ever lives in one place.
export const MIN_JOBS_FOR_INDEXING = 2;

// ════════════════════════════════════════════════════════════════
// SECURITY: escapeHtml — every field that ultimately comes from an
// external, unmoderated source (scraped LinkedIn/JobDataLake listings,
// visitor-submitted "Post a Job" entries) MUST pass through this before
// being inserted into any HTML template. Without it, a single malicious
// job title/company/description containing a <script> or phishing markup
// would render and execute directly on the page — exactly the kind of
// content Google Safe Browsing flags as "Deceptive Pages".
// ════════════════════════════════════════════════════════════════
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ════════════════════════════════════════════════════════════════
// cleanDescription — job descriptions arrive from many external
// providers in inconsistent shapes: some send raw HTML markup
// (Greenhouse's `content` field, some RapidAPI sources), and some send
// HTML that is ALREADY entity-escaped (e.g. "&lt;p&gt;..."). Escaping
// that a second time for display produces visible tag soup like
// "&lt;div class=&quot;...&quot;&gt;" instead of clean readable text.
// This normalizes both cases down to plain text — decode any existing
// entities, strip tags (turning block breaks into newlines so
// paragraphs don't run together), then collapse extra whitespace.
// Callers should still pass the result through escapeHtml() before
// inserting into HTML — this function's job is cleanup, not safety.
// ════════════════════════════════════════════════════════════════
export function cleanDescription(raw) {
  if (!raw) return '';
  let text = String(raw);
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x26;/gi, '&')
    .replace(/&amp;/g, '&');
  text = text
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return text;
}

export function slugify(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'na';
}

// External destinations are data, not markup. Only absolute HTTP(S) URLs
// with a real hostname are accepted for job applications and provider links;
// javascript:, data:, protocol-relative, and malformed values render as no
// link instead of becoming an executable href.
export function safeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw) || /[\s"'<>]/.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname ? parsed.toString() : '';
  } catch (e) { return ''; }
}

// ── Companies ──────────────────────────────────────────────────
// PERFORMANCE: bounded to the most recent 8000 jobs rather than scanning the
// entire (ever-growing) jobs table. An unbounded GROUP BY over the full
// table gets slower every day as more jobs sync in, and this query runs on
// EVERY /companies page load AND every /sitemap.xml request — left
// unbounded, it eventually gets slow enough that Googlebot's sitemap fetch
// times out, which Search Console reports as "couldn't fetch sitemap" even
// though the file is perfectly valid. Sampling the most recent jobs (via
// the indexed `id` column, so this stays fast regardless of table size) is
// more than sufficient for a "top companies" listing — a company with no
// jobs in the last 8000 postings isn't meaningfully "active" anyway.
export async function listCompanies(env, { limit = 200 } = {}) {
  try {
    let list = await readSiteCache(env, 'dir:companies');
    if (!list) {
      // No precomputed directory yet (first run after a deploy): bounded fallback
      // over the most recent DIRECTORY_WINDOW jobs — never the whole table.
      const { results } = await env.DB.prepare(
        `SELECT company AS name, COUNT(*) AS count FROM ${windowedJobs()} WHERE company IS NOT NULL AND company != '' GROUP BY company ORDER BY count DESC LIMIT 600`
      ).all();
      list = results || [];
    }
    let hidden = new Set();
    try {
      const { results } = await env.DB.prepare('SELECT company_lower FROM hidden_companies').all();
      hidden = new Set((results || []).map(r => String(r.company_lower || '').trim().toLowerCase()));
    } catch (e) { /* table not migrated yet */ }
    return list
      .filter(r => r && r.name && !hidden.has(String(r.name).trim().toLowerCase()))
      .slice(0, limit)
      .map(r => ({ name: r.name, slug: slugify(r.name), count: r.count }));
  } catch (e) { return []; }
}

export async function findCompanyBySlug(env, slug) {
  const companies = await listCompanies(env, { limit: 2000 });
  return companies.find(c => c.slug === slug) || null;
}

export async function jobsByCompany(env, companyName, { limit = 100 } = {}) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE company = ? AND ${PUBLIC_JOB_STATUS_NOINDEX_SQL} ORDER BY ${JOB_MANUAL_PIN_SORT_SQL} LIMIT ?`
    ).bind(companyName, limit).all();
    return results || [];
  } catch (e) { return []; }
}

// ── Countries / Cities (heuristic split on `location`) ──────────
// DATA QUALITY: the trailing "region" segment now passes through
// canonicalizeRegion() (lib/directory/geo-data.js) — this resolves the most common
// unambiguous aliases automatically ("USA"/"US"/"U.S." → "United States",
// a US state abbreviation like "TX" → "United States", etc.) BEFORE the
// manual /admin/directory override system ever sees it, so admins have
// far fewer near-duplicate entries to manually merge. Anything not
// covered by the dictionary still falls through unchanged, exactly as
// before this pass — the manual override system remains the final
// authority for anything the dictionary doesn't catch.
function splitLocation(location) {
  if (!location || /remote/i.test(location.trim()) && !location.includes(',')) {
    return { city: null, region: location && location.trim() ? location.trim() : 'Remote' };
  }
  const parts = location.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], region: canonicalizeRegion(parts[parts.length - 1]) };
  return { city: null, region: canonicalizeRegion(parts[0]) || 'Remote' };
}

// Raw aggregation, BEFORE overrides are applied — exported so
// /admin/directory can show hidden entries too (with a badge, so they
// can be un-hidden), which listCountries()/listCities() below
// deliberately can't do since they're the public-facing view.
// RESILIENCE: try/catch with a safe empty-array default — see the same
// pattern already used by listSkillsRaw() a little further down this
// file (and pages-cms.js / blog-cms.js). These public directory reads
// run on every /countries, /cities, /jobs and /remote-jobs page load
// (plus the sitemap builders), so a transient or migration-in-progress
// missing column/table must degrade to an empty directory, never an
// uncaught crash.
// Raw (location, count) groups. Read from the precomputed `dir:locations` row;
// bounded window fallback until the first cache refresh has run.
async function loadLocationGroups(env) {
  const cached = await readSiteCache(env, 'dir:locations');
  if (cached) return cached;
  const { results } = await env.DB.prepare(
    `SELECT location, COUNT(*) AS c FROM ${windowedJobs()} WHERE location IS NOT NULL AND location != '' GROUP BY location`
  ).all();
  return results || [];
}

export async function listCountriesRaw(env) {
  try {
    const results = await loadLocationGroups(env);
    const map = new Map();
    for (const row of results || []) {
      const { region } = splitLocation(row.location);
      if (!region) continue;
      const slug = slugify(region);
      const prev = map.get(slug) || { name: region, slug, count: 0 };
      prev.count += row.c;
      map.set(slug, prev);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  } catch (e) { return []; }
}

export async function listCountries(env, { limit = 300 } = {}) {
  const raw = await listCountriesRaw(env);
  const overrides = await getOverrides(env, 'country');
  const all = applyDirectoryOverrides(raw, overrides, slugify);
  return all.sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function findCountryBySlug(env, slug) {
  const countries = await listCountries(env, { limit: 2000 });
  return countries.find(c => c.slug === slug) || null;
}

export async function jobsByRegion(env, regionNames, { limit = 100, offset = 0 } = {}) {
  // Accepts either a single region string (legacy call shape) or an
  // array of raw names (see the rawNames note on applyDirectoryOverrides
  // in lib/directory/directory-overrides.js — required so a renamed/merged country
  // still matches the original, un-renamed text stored in jobs.location).
  const names = (Array.isArray(regionNames) ? regionNames : [regionNames]).filter(Boolean);
  if (!names.length) return [];
  try {
    const conditions = names.map(() => '(location = ? OR location LIKE ?)').join(' OR ');
    const binds = names.flatMap(n => [n, `%, ${n}`]);
    const { results } = await env.DB.prepare(
      `SELECT ${JOB_LISTING_COLUMNS} FROM ${windowedJobs()} WHERE (${conditions}) ORDER BY ${JOB_MANUAL_PIN_SORT_SQL} LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all();
    return results || [];
  } catch (e) { return []; }
}

export async function countJobsByRegion(env, regionNames) {
  const names = (Array.isArray(regionNames) ? regionNames : [regionNames]).filter(Boolean);
  if (!names.length) return 0;
  try {
    // ROW-READ BUDGET: exact count from the precomputed location groups (0 D1 rows);
    // bounded window count only until the first cache refresh has run.
    const cached = await readSiteCache(env, 'dir:locations');
    if (cached) {
      let sum = 0;
      for (const g of cached) if (names.some(n => g.location === n || String(g.location).endsWith(`, ${n}`))) sum += Number(g.c || 0);
      return sum;
    }
    const conditions = names.map(() => '(location = ? OR location LIKE ?)').join(' OR ');
    const binds = names.flatMap(n => [n, `%, ${n}`]);
    const { results } = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${windowedJobs()} WHERE (${conditions})`).bind(...binds).all();
    return Number(results?.[0]?.c || 0);
  } catch (e) { return 0; }
}

export async function listCitiesRaw(env) {
  try {
    const results = await loadLocationGroups(env);
    const map = new Map();
    for (const row of results || []) {
      const { city } = splitLocation(row.location);
      if (!city) continue;
      const slug = slugify(city);
      const prev = map.get(slug) || { name: city, slug, count: 0 };
      prev.count += row.c;
      map.set(slug, prev);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  } catch (e) { return []; }
}

export async function listCities(env, { limit = 300 } = {}) {
  const raw = await listCitiesRaw(env);
  const overrides = await getOverrides(env, 'city');
  const all = applyDirectoryOverrides(raw, overrides, slugify);
  return all.sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function jobsByCity(env, cityNames, { limit = 100 } = {}) {
  const names = (Array.isArray(cityNames) ? cityNames : [cityNames]).filter(Boolean);
  if (!names.length) return [];
  try {
    const conditions = names.map(() => '(location = ? OR location LIKE ?)').join(' OR ');
    const binds = names.flatMap(n => [n, `${n},%`]);
    const { results } = await env.DB.prepare(
      `SELECT ${JOB_LISTING_COLUMNS} FROM ${windowedJobs()} WHERE (${conditions}) ORDER BY ${JOB_MANUAL_PIN_SORT_SQL} LIMIT ?`
    ).bind(...binds, limit).all();
    return results || [];
  } catch (e) { return []; }
}

// ── Skills (parsed from the jobs.skills JSON column via SQLite json_each) ─
// PERFORMANCE: same bounding rationale as listCompanies() above — this
// query is the single most expensive one in the whole codebase (a
// json_each cross join over every job row), and it used to run unbounded
// on every /skills page load and every /sitemap.xml request. Bounding to
// the most recent 5000 jobs (same sample size already used for the admin
// dashboard's skill-count estimate) keeps it fast at any table size.
export async function listSkillsRaw(env) {
  try {
    const cached = await readSiteCache(env, 'dir:skills');
    if (cached) return cached.map(r => ({ name: r.name, slug: slugify(r.name), count: r.count })).filter(s => s.name);
    const { results } = await env.DB.prepare(
      `SELECT value AS skill, COUNT(*) c FROM (
         SELECT skills FROM jobs WHERE skills IS NOT NULL AND skills != '' AND skills != '[]' AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY id DESC LIMIT 1500
       ), json_each(skills)
       GROUP BY value ORDER BY c DESC`
    ).all();
    return (results || []).map(r => ({ name: r.skill, slug: slugify(r.skill), count: r.c })).filter(s => s.name);
  } catch (e) {
    return [];
  }
}

export async function listSkills(env, { limit = 200 } = {}) {
  const raw = await listSkillsRaw(env);
  const overrides = await getOverrides(env, 'skill');
  const all = applyDirectoryOverrides(raw, overrides, slugify);
  return all.sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function findSkillBySlug(env, slug) {
  const skills = await listSkills(env, { limit: 2000 });
  return skills.find(s => s.slug === slug) || null;
}

export async function jobsBySkill(env, skillNames, { limit = 100, offset = 0 } = {}) {
  const names = (Array.isArray(skillNames) ? skillNames : [skillNames]).filter(Boolean);
  if (!names.length) return [];
  // ROW-READ BUDGET (crawler-breadth): skills are the highest-cardinality public
  // directory entity (free-text, effectively unbounded) — a search-engine crawler
  // visiting every unique /skills/:slug URL in the sitemap once each turns a
  // "bounded per page" cost into a large total, since each is a cache MISS the
  // first time regardless of TTL. Precomputed id-lists (lib/platform/site-cache.js)
  // make this an indexed `WHERE id IN (...)` lookup instead — cheap on every hit,
  // not just repeat hits. Falls back to the live bounded query when the cache is
  // cold, a name isn't tracked (long tail beyond TRACKED_SKILL_IDS), or the
  // requested page reaches past the cached id-list's length (rare, deep pagination).
  try {
    const cachedIdsByName = await readSiteCache(env, 'dir:skill_jobs');
    if (cachedIdsByName) {
      const ids = [...new Set(names.flatMap((n) => cachedIdsByName[n] || []))].sort((a, b) => b - a);
      if (ids.length) {
        // D1 rejects a query with more than 100 bound parameters; a normal page
        // (limit=20-30) never gets close, but an admin-configurable "jobs per
        // article" setting or several merged directory-override names combined
        // could in theory. Capped defensively; the (rare) remainder falls
        // through to the live query below rather than the request failing.
        const page = ids.slice(offset, offset + Math.min(limit, 100));
        if (page.length) {
          const placeholders = page.map(() => '?').join(',');
          const { results } = await env.DB.prepare(
            `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE id IN (${placeholders}) ORDER BY ${JOB_MANUAL_PIN_SORT_SQL}`
          ).bind(...page).all();
          return results || [];
        }
        // page is empty only when offset >= ids.length: deep pagination past
        // what was cached — fall through to the live (bounded) query below.
      }
    }
  } catch (e) { /* fall through to the live query */ }
  try {
    const placeholders = names.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT ${JOB_LISTING_COLUMNS.split(',').map(column => `jobs.${column}`).join(',')} FROM ${windowedJobs()}, json_each(jobs.skills)
       WHERE json_each.value IN (${placeholders}) ORDER BY ${JOB_MANUAL_PIN_SORT_SQL.replace(/\bid\b/g, 'jobs.id')} LIMIT ? OFFSET ?` ).bind(...names, limit, offset).all();
    return results || [];
  } catch (e) {
    return [];
  }
}

export async function countJobsBySkill(env, skillNames) {
  const names = (Array.isArray(skillNames) ? skillNames : [skillNames]).filter(Boolean);
  if (!names.length) return 0;
  try {
    const cached = await readSiteCache(env, 'dir:skills');
    if (cached) return cached.filter(r => names.includes(r.name)).reduce((n, r) => n + Number(r.count || 0), 0);
    const placeholders = names.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`SELECT COUNT(DISTINCT jobs.id) AS c FROM ${windowedJobs()}, json_each(jobs.skills) WHERE json_each.value IN (${placeholders})`).bind(...names).all();
    return Number(results?.[0]?.c || 0);
  } catch (e) {
    return 0;
  }
}

// ── Salary bands (aggregated by category, parsed from "$Xk - $Yk" text) ─
export function parseSalaryRange(salary) {
  if (!salary) return null;
  const nums = (salary.match(/\d+/g) || []).map(n => parseInt(n, 10));
  if (!nums.length) return null;
  const min = nums[0];
  const max = nums.length > 1 ? nums[1] : nums[0];
  return { min, max };
}

export async function salaryBandsByCategory(env, categoryOrder, categoryMeta) {
  const cached = await readSiteCache(env, 'salary:bands');
  return categoryOrder.map(key => {
    const b = cached?.[String(key).toLowerCase()];
    return b && b.count ? { key, label: categoryMeta[key].label, ...b } : { key, label: categoryMeta[key].label, count: 0 };
  });
}

// ════════════════════════════════════════════════════════════════
// ORIGINAL-CONTENT HELPERS — power the "Salary Insight" and "About this
// company" boxes on individual job pages (see pages/job-page.js). These
// exist specifically to give each job page genuinely unique, factual
// content that cannot appear identically on any other site: the raw job
// title/company/description is routinely scraped and republished across
// many competing aggregators verbatim, which risks Google treating those
// pages as duplicate/thin content. A live, computed comparison against
// this site's own current listings is not reproducible elsewhere.
// ════════════════════════════════════════════════════════════════

// Single-category version of salaryBandsByCategory() above — used on a
// job page, which only ever needs stats for ONE category (the job's own),
// not all 13. Bounded to the most recent 3000 matching listings with a
// salary, matching the sampling pattern already used by listCompanies()/
// listSkills() elsewhere in this file for performance at scale.
export async function categorySalaryStats(env, categoryKey) {
  try {
    const cached = await readSiteCache(env, 'salary:bands');
    const b = cached?.[String(categoryKey).toLowerCase()];
    return b && b.count ? b : null;
  } catch (e) { return null; }
}

// How many open roles a company currently has on JobForion, and roughly
// how long they've been posting here — both factual, verifiable, and
// specific to this site (not present in the scraped listing itself).
export async function companySnapshot(env, companyName) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) c, MIN(created_at) first_seen FROM jobs WHERE company = ? AND ${PUBLIC_JOB_STATUS_NOINDEX_SQL}`
    ).bind(companyName).all();
    const row = results?.[0];
    return { openPositions: row?.c || 0, firstSeen: row?.first_seen || null };
  } catch (e) {
    return { openPositions: 0, firstSeen: null };
  }
}
