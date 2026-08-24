// src/lib/companies.js
// Companies data-access layer. Company creation always happens together
// with the creating user becoming an 'admin' company_member in the same
// logical operation (see createCompany below) — there is no code path
// that produces a company with zero members, which would otherwise be
// an orphaned, unmanageable row.

import { slugify } from './entities.js';
import { JOB_TYPE_SORT_SQL, PUBLIC_JOB_STATUS_SQL, JOB_LISTING_COLUMNS } from '../config/constants.js';

// Job-matching condition shared by every "jobs that belong to this real
// company" query below. A job belongs to a real company either because it
// was submitted through the authenticated /company/post-job flow (sets
// jobs.company_id directly) OR because it's a provider-synced/legacy job
// whose free-text `company` name matches — this is what makes an existing
// Greenhouse/Lever job "just work" under a company's new profile page the
// moment an admin verifies that company, with zero backfill needed.
// PUBLIC_JOB_STATUS_SQL is baked in here (not left to each caller) since
// every current consumer of this constant is public-facing (the company
// profile page) — a paused/closed/expired job must not show there either.
export const COMPANY_JOB_MATCH_SQL = `(jobs.company_id = ? OR (jobs.company_id IS NULL AND LOWER(jobs.company) = LOWER(?))) AND ${PUBLIC_JOB_STATUS_SQL}`;

async function uniqueCompanySlug(env, name, excludeId = null) {
  const base = slugify(name) || 'company';
  let candidate = base;
  let n = 1;
  while (true) {
    const { results } = excludeId
      ? await env.DB.prepare(`SELECT id FROM companies WHERE slug = ? AND id != ?`).bind(candidate, excludeId).all()
      : await env.DB.prepare(`SELECT id FROM companies WHERE slug = ?`).bind(candidate).all();
    if (!results || !results.length) return candidate;
    n++;
    candidate = `${base}-${n}`;
  }
}

export async function createCompany(env, userId, { name, website, industry, country, city, company_size, description }) {
  const cleanName = String(name || '').trim().slice(0, 150);
  if (!cleanName) throw new Error('Company name is required.');
  const slug = await uniqueCompanySlug(env, cleanName);

  const result = await env.DB.prepare(
    `INSERT INTO companies (slug, name, website, industry, country, city, company_size, description, status, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    slug, cleanName, String(website || '').slice(0, 300), String(industry || '').slice(0, 100),
    String(country || '').slice(0, 100), String(city || '').slice(0, 100),
    String(company_size || '').slice(0, 40), String(description || '').slice(0, 3000),
    userId
  ).run();
  invalidateVerifiedCache();

  const companyId = result?.meta?.last_row_id;
  await env.DB.prepare(`INSERT INTO company_members (company_id, user_id, role, status) VALUES (?, ?, 'admin', 'active')`)
    .bind(companyId, userId).run();

  return companyId;
}

export async function getCompanyById(env, id) {
  const { results } = await env.DB.prepare(`SELECT * FROM companies WHERE id = ? LIMIT 1`).bind(id).all();
  return results?.[0] || null;
}

export async function getCompanyBySlug(env, slug) {
  const { results } = await env.DB.prepare(`SELECT * FROM companies WHERE slug = ? LIMIT 1`).bind(slug).all();
  return results?.[0] || null;
}

export async function updateCompanyProfile(env, companyId, {
  name, website, industry, country, city, company_size, description, logo_url, linkedin_url,
  cover_image_url, founded_year, headquarters, contact_email, phone, twitter_url, facebook_url,
} = {}) {
  const existing = await getCompanyById(env, companyId);
  if (!existing) throw new Error('Company not found.');
  const cleanName = String(name || existing.name).trim().slice(0, 150);
  const slug = cleanName !== existing.name ? await uniqueCompanySlug(env, cleanName, companyId) : existing.slug;

  // founded_year: reject obviously-invalid values (empty/non-numeric/out
  // of a sane range) rather than trusting client input straight into D1 —
  // stored as NULL when not a plausible year instead of throwing, so a
  // blank field doesn't block the rest of a valid profile save.
  const yearNum = parseInt(founded_year, 10);
  const cleanYear = Number.isInteger(yearNum) && yearNum >= 1800 && yearNum <= new Date().getFullYear() ? yearNum : null;

  await env.DB.prepare(
    `UPDATE companies SET
       name = ?, slug = ?, website = ?, industry = ?, country = ?, city = ?, company_size = ?,
       description = ?, logo_url = ?, linkedin_url = ?, cover_image_url = ?, founded_year = ?,
       headquarters = ?, contact_email = ?, phone = ?, twitter_url = ?, facebook_url = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(
    cleanName, slug, String(website || '').slice(0, 300), String(industry || '').slice(0, 100),
    String(country || '').slice(0, 100), String(city || '').slice(0, 100), String(company_size || '').slice(0, 40),
    String(description || '').slice(0, 3000), String(logo_url || '').slice(0, 500), String(linkedin_url || '').slice(0, 300),
    String(cover_image_url || '').slice(0, 500), cleanYear, String(headquarters || '').slice(0, 200),
    String(contact_email || '').slice(0, 150), String(phone || '').slice(0, 40),
    String(twitter_url || '').slice(0, 300), String(facebook_url || '').slice(0, 300),
    companyId
  ).run();
}

// ── Admin verification workflow (plan §14, §22) ────────────────────
export async function setCompanyStatus(env, companyId, status) {
  await env.DB.prepare(`UPDATE companies SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(status, companyId).run();
  invalidateVerifiedCache(); // a suspended/rejected company must lose its badge without waiting out the full 60s TTL on THIS isolate
}
export async function setCompanyVerified(env, companyId, verified) {
  await env.DB.prepare(`UPDATE companies SET verified = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(verified ? 1 : 0, verified ? 'active' : 'pending', companyId).run();
  invalidateVerifiedCache();
}

// Featured is an admin-only editorial flag (plan §9) — independent of
// verification, used for homepage/sponsorship placement later. A future
// homepage "Featured Companies" section can call
// listPublicCompanies(env, { featuredOnly: true, limit: 8 }) directly —
// no separate helper needed, kept out of this file to avoid an unused
// export until that section actually exists.
export async function setCompanyFeatured(env, companyId, featured) {
  await env.DB.prepare(`UPDATE companies SET featured = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(featured ? 1 : 0, companyId).run();
}

// ── Members ─────────────────────────────────────────────────────
export async function listCompanyMembers(env, companyId) {
  const { results } = await env.DB.prepare(
    `SELECT cm.id, cm.role, cm.status, cm.created_at, u.id as user_id, u.email
     FROM company_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.company_id = ? ORDER BY cm.created_at ASC`
  ).bind(companyId).all();
  return results || [];
}

export async function addCompanyMember(env, companyId, userId, role = 'member') {
  await env.DB.prepare(
    `INSERT INTO company_members (company_id, user_id, role, status) VALUES (?, ?, ?, 'active')
     ON CONFLICT(company_id, user_id) DO UPDATE SET role = excluded.role, status = 'active'`
  ).bind(companyId, userId, role).run();
}

export async function removeCompanyMember(env, companyId, userId) {
  await env.DB.prepare(`DELETE FROM company_members WHERE company_id = ? AND user_id = ?`).bind(companyId, userId).run();
}

export async function updateMemberRole(env, companyId, userId, role) {
  await env.DB.prepare(`UPDATE company_members SET role = ? WHERE company_id = ? AND user_id = ?`).bind(role, companyId, userId).run();
}

// ════════════════════════════════════════════════════════════════
// PUBLIC DIRECTORY + SEARCH (plan §4, §12, §13) — read-only, no auth
// required, safe to call from cached SSR pages and /sitemap-companies.xml.
// Only status='active' companies are ever returned here; pending/
// rejected/suspended companies stay invisible to the public exactly like
// an unpublished draft, same as job_postings before admin approval.
// ════════════════════════════════════════════════════════════════

export async function listPublicCompanies(env, { q = '', country = '', industry = '', company_size = '', verifiedOnly = false, featuredOnly = false, limit = 60, offset = 0 } = {}) {
  const where = [`c.status = 'active'`];
  const binds = [];
  if (q) { where.push(`LOWER(c.name) LIKE ?`); binds.push(`%${q.toLowerCase().slice(0, 100)}%`); }
  if (country) { where.push(`c.country = ?`); binds.push(country.slice(0, 100)); }
  if (industry) { where.push(`c.industry = ?`); binds.push(industry.slice(0, 100)); }
  if (company_size) { where.push(`c.company_size = ?`); binds.push(company_size.slice(0, 40)); }
  if (verifiedOnly) { where.push(`c.verified = 1`); }
  if (featuredOnly) { where.push(`c.featured = 1`); }
  const whereSql = where.join(' AND ');

  const { results } = await env.DB.prepare(
    `SELECT c.*,
       (SELECT COUNT(*) FROM jobs WHERE (jobs.company_id = c.id OR (jobs.company_id IS NULL AND LOWER(jobs.company) = LOWER(c.name))) AND ${PUBLIC_JOB_STATUS_SQL}) as job_count,
       (SELECT COUNT(*) FROM jobs WHERE (jobs.company_id = c.id OR (jobs.company_id IS NULL AND LOWER(jobs.company) = LOWER(c.name))) AND jobs.remote_type IN ('fully_remote', 'hybrid') AND ${PUBLIC_JOB_STATUS_SQL}) as remote_job_count
     FROM companies c WHERE ${whereSql}
     ORDER BY c.featured DESC, c.verified DESC, job_count DESC, c.name ASC
     LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();
  return results || [];
}

export async function countPublicCompanies(env, { q = '', country = '', industry = '', company_size = '', verifiedOnly = false } = {}) {
  const where = [`status = 'active'`];
  const binds = [];
  if (q) { where.push(`LOWER(name) LIKE ?`); binds.push(`%${q.toLowerCase().slice(0, 100)}%`); }
  if (country) { where.push(`country = ?`); binds.push(country.slice(0, 100)); }
  if (industry) { where.push(`industry = ?`); binds.push(industry.slice(0, 100)); }
  if (company_size) { where.push(`company_size = ?`); binds.push(company_size.slice(0, 40)); }
  if (verifiedOnly) { where.push(`verified = 1`); }
  const { results } = await env.DB.prepare(`SELECT COUNT(*) c FROM companies WHERE ${where.join(' AND ')}`).bind(...binds).all();
  return results?.[0]?.c || 0;
}

// A real company's public profile is only reachable at its slug once it's
// been made visible by an admin (status='active'). A pending/rejected/
// suspended company simply isn't found here — routes/seo-pages.router.js
// then falls back to the legacy text-directory page for that slug (if
// any), so no URL ever 404s just because a company is mid-review.
export async function getPublicCompanyBySlug(env, slug) {
  const { results } = await env.DB.prepare(`SELECT * FROM companies WHERE slug = ? AND status = 'active' LIMIT 1`).bind(slug).all();
  return results?.[0] || null;
}

function companyJobsQuery(company, { remote_type = '', employment_type = '', category = '', seniority = '', country = '', q = '' } = {}) {
  const where = [COMPANY_JOB_MATCH_SQL];
  const binds = [company.id, company.name];
  if (remote_type) { where.push('jobs.remote_type = ?'); binds.push(String(remote_type).slice(0, 40)); }
  if (employment_type) { where.push('jobs.employment_type = ?'); binds.push(String(employment_type).slice(0, 40)); }
  if (category) { where.push('LOWER(jobs.title) LIKE ?'); binds.push(`%${String(category).toLowerCase().slice(0, 60)}%`); }
  if (seniority) { where.push('LOWER(jobs.seniority) LIKE ?'); binds.push(`%${String(seniority).toLowerCase().slice(0, 40)}%`); }
  if (country) { where.push('LOWER(jobs.location) LIKE ?'); binds.push(`%${String(country).toLowerCase().slice(0, 100)}%`); }
  if (q) { where.push('(LOWER(jobs.title) LIKE ? OR LOWER(jobs.description) LIKE ? OR EXISTS (SELECT 1 FROM json_each(jobs.skills) je WHERE LOWER(je.value) LIKE ?))'); const like = `%${String(q).toLowerCase().slice(0, 100)}%`; binds.push(like, like, like); }
  return { where: where.join(' AND '), binds };
}

export async function countJobsForCompanyEntity(env, company, filters = {}) {
  const { where, binds } = companyJobsQuery(company, filters);
  const { results } = await env.DB.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${where}`).bind(...binds).all();
  return Number(results?.[0]?.c || 0);
}

export async function jobsForCompanyEntity(env, company, { limit = 100, offset = 0, ...filters } = {}) {
  const { where, binds } = companyJobsQuery(company, filters);
  const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 100));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const { results } = await env.DB.prepare(
    `SELECT ${JOB_LISTING_COLUMNS} FROM jobs WHERE ${where} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`
  ).bind(...binds).all();
  return results || [];
}

// ── Verified-company name lookup (for the "✓ Verified" badge on job
// cards / job pages / search results — plan §8) ─────────────────────
// Matched by lowercased company NAME (not id) because most jobs on the
// site are provider-synced rows that never get a company_id — this is
// the same free-text matching bridge COMPANY_JOB_MATCH_SQL uses above.
// 60s in-memory cache per isolate, identical rationale/TTL to
// lib/settings.js: this gets read on every job-card render (homepage,
// every directory page, /api/jobs) but only changes when an admin
// verifies/unverifies a company, so a short cache is far cheaper than a
// D1 round trip per request while still going live within a minute.
let verifiedCache = null;
let verifiedCacheAt = 0;
const VERIFIED_CACHE_TTL_MS = 60_000;

function invalidateVerifiedCache() { verifiedCache = null; verifiedCacheAt = 0; }

export async function getVerifiedCompanyNameSet(env) {
  const now = Date.now();
  if (verifiedCache && (now - verifiedCacheAt) < VERIFIED_CACHE_TTL_MS) return verifiedCache;
  try {
    const { results } = await env.DB.prepare(`SELECT name FROM companies WHERE status = 'active' AND verified = 1`).all();
    verifiedCache = new Set((results || []).map(r => (r.name || '').toLowerCase()));
  } catch (e) {
    verifiedCache = new Set(); // fail safe: no badge is better than a broken page
  }
  verifiedCacheAt = now;
  return verifiedCache;
}

export async function listDistinctIndustries(env) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT industry FROM companies WHERE status = 'active' AND industry IS NOT NULL AND industry != '' ORDER BY industry ASC LIMIT 100`).all();
  return (results || []).map(r => r.industry);
}
export async function listDistinctCompanyCountries(env) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT country FROM companies WHERE status = 'active' AND country IS NOT NULL AND country != '' ORDER BY country ASC LIMIT 200`).all();
  return (results || []).map(r => r.country);
}
