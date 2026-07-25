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
       SELECT company FROM jobs WHERE company IS NOT NULL AND company != '' ORDER BY id DESC LIMIT 8000
     ) GROUP BY company ORDER BY c DESC LIMIT ?`
  ).bind(limit).all();
  return (results || []).map(r => ({ name: r.company, slug: slugify(r.company), count: r.c }));
}

export async function findCompanyBySlug(env, slug) {
  const companies = await listCompanies(env, { limit: 2000 });
  return companies.find(c => c.slug === slug) || null;
}

export async function jobsByCompany(env, companyName, { limit = 100 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM jobs WHERE company = ? ORDER BY id DESC LIMIT ?`
  ).bind(companyName, limit).all();
  return results || [];
}

// ── Countries / Cities (heuristic split on `location`) ──────────
function splitLocation(location) {
  if (!location || /remote/i.test(location.trim()) && !location.includes(',')) {
    return { city: null, region: location && location.trim() ? location.trim() : 'Remote' };
  }
  const parts = location.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], region: parts[parts.length - 1] };
  return { city: null, region: parts[0] || 'Remote' };
}

export async function listCountries(env, { limit = 300 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT location, COUNT(*) c FROM jobs WHERE location IS NOT NULL AND location != '' GROUP BY location`
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
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function findCountryBySlug(env, slug) {
  const countries = await listCountries(env, { limit: 2000 });
  return countries.find(c => c.slug === slug) || null;
}

export async function jobsByRegion(env, regionName, { limit = 100 } = {}) {
  // matches on the trailing "region" segment of location (country/state heuristic)
  const { results } = await env.DB.prepare(
    `SELECT * FROM jobs WHERE location = ? OR location LIKE ? ORDER BY id DESC LIMIT ?`
  ).bind(regionName, `%, ${regionName}`, limit).all();
  return results || [];
}

export async function listCities(env, { limit = 300 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT location, COUNT(*) c FROM jobs WHERE location IS NOT NULL AND location != '' GROUP BY location`
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
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function findCityBySlug(env, slug) {
  const cities = await listCities(env, { limit: 2000 });
  return cities.find(c => c.slug === slug) || null;
}

export async function jobsByCity(env, cityName, { limit = 100 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM jobs WHERE location = ? OR location LIKE ? ORDER BY id DESC LIMIT ?`
  ).bind(cityName, `${cityName},%`, limit).all();
  return results || [];
}

// ── Skills (parsed from the jobs.skills JSON column via SQLite json_each) ─
// PERFORMANCE: same bounding rationale as listCompanies() above — this
// query is the single most expensive one in the whole codebase (a
// json_each cross join over every job row), and it used to run unbounded
// on every /skills page load and every /sitemap.xml request. Bounding to
// the most recent 5000 jobs (same sample size already used for the admin
// dashboard's skill-count estimate) keeps it fast at any table size.
export async function listSkills(env, { limit = 200 } = {}) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT value AS skill, COUNT(*) c FROM (
         SELECT skills FROM jobs WHERE skills IS NOT NULL AND skills != '' AND skills != '[]' ORDER BY id DESC LIMIT 5000
       ), json_each(skills)
       GROUP BY value ORDER BY c DESC LIMIT ?`
    ).bind(limit).all();
    return (results || []).map(r => ({ name: r.skill, slug: slugify(r.skill), count: r.c })).filter(s => s.name);
  } catch (e) {
    // json_each unsupported/edge case — fail gracefully, directory just empty
    return [];
  }
}

export async function findSkillBySlug(env, slug) {
  const skills = await listSkills(env, { limit: 2000 });
  return skills.find(s => s.slug === slug) || null;
}

export async function jobsBySkill(env, skillName, { limit = 100 } = {}) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT jobs.* FROM jobs, json_each(jobs.skills)
       WHERE json_each.value = ? ORDER BY jobs.id DESC LIMIT ?`
    ).bind(skillName, limit).all();
    return results || [];
  } catch (e) {
    return [];
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
      `SELECT salary FROM jobs WHERE LOWER(title) LIKE ? AND salary IS NOT NULL AND salary != ''`
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
