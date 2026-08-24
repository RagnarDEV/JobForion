// src/lib/entities.js
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

import { JOB_TYPE_SORT_SQL, PUBLIC_JOB_STATUS_SQL, JOB_LISTING_COLUMNS } from '../config/constants.js';
import { getOverrides, applyDirectoryOverrides } from './directory-overrides.js';
import { canonicalizeRegion } from './geo-data.js';

// ════════════════════════════════════════════════════════════════
// THIN-CONTENT THRESHOLD — a directory detail page (company/skill/
// country) with fewer than this many jobs is "thin content": too little
// unique text for a search engine to treat as a distinct, useful page.
// Submitting thousands of 1-job company pages via the sitemap is exactly
// what causes Google to mass-flag a young domain's URLs as "Discovered —
// currently not indexed" (crawl-budget/quality throttling) — see
// pages/seo-pages.js (per-page noindex) and lib/sitemap.js (sitemap
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
  const { results } = await env.DB.prepare(
    `SELECT company, COUNT(*) c FROM (
       SELECT company FROM jobs WHERE company IS NOT NULL AND company != '' AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY id DESC LIMIT 8000
     )
     WHERE LOWER(TRIM(company)) NOT IN (SELECT LOWER(TRIM(company_lower)) FROM hidden_companies)
     GROUP BY company ORDER BY c DESC LIMIT ?`
  ).bind(limit).all();
  return (results || []).map(r => ({ name: r.company, slug: slugify(r.company), count: r.c }));
}

export async function findCompanyBySlug(env, slug) {
  const companies = await listCompanies(env, { limit: 2000 });
  return companies.find(c => c.slug === slug) || null;
}

export async function jobsByCompany(env, companyName, { limit = 100 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE company = ? AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT ?`
  ).bind(companyName, limit).all();
  return results || [];
}

// ── Countries / Cities (heuristic split on `location`) ──────────
// DATA QUALITY: the trailing "region" segment now passes through
// canonicalizeRegion() (lib/geo-data.js) — this resolves the most common
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
export async function listCountriesRaw(env) {
  const { results } = await env.DB.prepare(
    `SELECT location, COUNT(*) c FROM jobs WHERE location IS NOT NULL AND location != '' AND ${PUBLIC_JOB_STATUS_SQL} GROUP BY location`
  ).all();
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
  // in lib/directory-overrides.js — required so a renamed/merged country
  // still matches the original, un-renamed text stored in jobs.location).
  const names = (Array.isArray(regionNames) ? regionNames : [regionNames]).filter(Boolean);
  if (!names.length) return [];
  const conditions = names.map(() => '(location = ? OR location LIKE ?)').join(' OR ');
  const binds = names.flatMap(n => [n, `%, ${n}`]);
  const { results } = await env.DB.prepare(
    `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE (${conditions}) AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();
  return results || [];
}

export async function countJobsByRegion(env, regionNames) {
  const names = (Array.isArray(regionNames) ? regionNames : [regionNames]).filter(Boolean);
  if (!names.length) return 0;
  const conditions = names.map(() => '(location = ? OR location LIKE ?)').join(' OR ');
  const binds = names.flatMap(n => [n, `%, ${n}`]);
  const { results } = await env.DB.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE (${conditions}) AND ${PUBLIC_JOB_STATUS_SQL}`).bind(...binds).all();
  return Number(results?.[0]?.c || 0);
}

export async function listCitiesRaw(env) {
  const { results } = await env.DB.prepare(
    `SELECT location, COUNT(*) c FROM jobs WHERE location IS NOT NULL AND location != '' AND ${PUBLIC_JOB_STATUS_SQL} GROUP BY location`
  ).all();
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
}

export async function listCities(env, { limit = 300 } = {}) {
  const raw = await listCitiesRaw(env);
  const overrides = await getOverrides(env, 'city');
  const all = applyDirectoryOverrides(raw, overrides, slugify);
  return all.sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function findCityBySlug(env, slug) {
  const cities = await listCities(env, { limit: 2000 });
  return cities.find(c => c.slug === slug) || null;
}

export async function jobsByCity(env, cityNames, { limit = 100 } = {}) {
  const names = (Array.isArray(cityNames) ? cityNames : [cityNames]).filter(Boolean);
  if (!names.length) return [];
  const conditions = names.map(() => '(location = ? OR location LIKE ?)').join(' OR ');
  const binds = names.flatMap(n => [n, `${n},%`]);
  const { results } = await env.DB.prepare(
    `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE (${conditions}) AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT ?`
  ).bind(...binds, limit).all();
  return results || [];
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
    const { results } = await env.DB.prepare(
      `SELECT value AS skill, COUNT(*) c FROM (
         SELECT skills FROM jobs WHERE skills IS NOT NULL AND skills != '' AND skills != '[]' AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY id DESC LIMIT 5000
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
  try {
    const placeholders = names.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT ${JOB_LISTING_COLUMNS.split(',').map(column => `jobs.${column}`).join(',')} FROM jobs, json_each(jobs.skills)
       WHERE json_each.value IN (${placeholders}) AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, jobs.id DESC LIMIT ? OFFSET ?` ).bind(...names, limit, offset).all();
    return results || [];
  } catch (e) {
    return [];
  }
}

export async function countJobsBySkill(env, skillNames) {
  const names = (Array.isArray(skillNames) ? skillNames : [skillNames]).filter(Boolean);
  if (!names.length) return 0;
  try {
    const placeholders = names.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`SELECT COUNT(DISTINCT jobs.id) AS c FROM jobs, json_each(jobs.skills) WHERE json_each.value IN (${placeholders}) AND ${PUBLIC_JOB_STATUS_SQL}`).bind(...names).all();
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
  const bands = [];
  for (const key of categoryOrder) {
    const { results } = await env.DB.prepare(
      `SELECT salary FROM jobs WHERE LOWER(title) LIKE ? AND salary IS NOT NULL AND salary != '' AND ${PUBLIC_JOB_STATUS_SQL}`
    ).bind(`%${key}%`).all();
    const ranges = (results || []).map(r => parseSalaryRange(r.salary)).filter(Boolean);
    if (!ranges.length) { bands.push({ key, label: categoryMeta[key].label, count: 0 }); continue; }
    const mins = ranges.map(r => r.min), maxs = ranges.map(r => r.max);
    const avg = arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    bands.push({
      key, label: categoryMeta[key].label, count: ranges.length,
      avgMin: avg(mins), avgMax: avg(maxs),
      low: Math.min(...mins), high: Math.max(...maxs)
    });
  }
  return bands;
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
    const { results } = await env.DB.prepare(
      `SELECT salary FROM (
         SELECT salary FROM jobs WHERE LOWER(title) LIKE ? AND salary IS NOT NULL AND salary != '' AND ${PUBLIC_JOB_STATUS_SQL} ORDER BY id DESC LIMIT 3000
       )`
    ).bind(`%${categoryKey}%`).all();
    const ranges = (results || []).map(r => parseSalaryRange(r.salary)).filter(Boolean);
    if (!ranges.length) return null;
    const mins = ranges.map(r => r.min), maxs = ranges.map(r => r.max);
    const avg = arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    return { count: ranges.length, avgMin: avg(mins), avgMax: avg(maxs), low: Math.min(...mins), high: Math.max(...maxs) };
  } catch (e) { return null; }
}

// How many open roles a company currently has on JobForion, and roughly
// how long they've been posting here — both factual, verifiable, and
// specific to this site (not present in the scraped listing itself).
export async function companySnapshot(env, companyName) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) c, MIN(created_at) first_seen FROM jobs WHERE company = ? AND ${PUBLIC_JOB_STATUS_SQL}`
    ).bind(companyName).all();
    const row = results?.[0];
    return { openPositions: row?.c || 0, firstSeen: row?.first_seen || null };
  } catch (e) {
    return { openPositions: 0, firstSeen: null };
  }
}
