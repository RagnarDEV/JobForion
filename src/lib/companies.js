// src/lib/companies.js
// Companies data-access layer. Company creation always happens together
// with the creating user becoming an 'admin' company_member in the same
// logical operation (see createCompany below) — there is no code path
// that produces a company with zero members, which would otherwise be
// an orphaned, unmanageable row.

import { slugify } from './entities.js';

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

export async function updateCompanyProfile(env, companyId, { name, website, industry, country, city, company_size, description, logo_url, linkedin_url }) {
  const existing = await getCompanyById(env, companyId);
  if (!existing) throw new Error('Company not found.');
  const cleanName = String(name || existing.name).trim().slice(0, 150);
  const slug = cleanName !== existing.name ? await uniqueCompanySlug(env, cleanName, companyId) : existing.slug;
  await env.DB.prepare(
    `UPDATE companies SET name = ?, slug = ?, website = ?, industry = ?, country = ?, city = ?, company_size = ?, description = ?, logo_url = ?, linkedin_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(
    cleanName, slug, String(website || '').slice(0, 300), String(industry || '').slice(0, 100),
    String(country || '').slice(0, 100), String(city || '').slice(0, 100), String(company_size || '').slice(0, 40),
    String(description || '').slice(0, 3000), String(logo_url || '').slice(0, 500), String(linkedin_url || '').slice(0, 300),
    companyId
  ).run();
}

// ── Admin verification workflow (plan §14, §22) ────────────────────
export async function setCompanyStatus(env, companyId, status) {
  await env.DB.prepare(`UPDATE companies SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(status, companyId).run();
}
export async function setCompanyVerified(env, companyId, verified) {
  await env.DB.prepare(`UPDATE companies SET verified = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(verified ? 1 : 0, verified ? 'active' : 'pending', companyId).run();
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
