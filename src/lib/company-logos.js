// Canonical company-image lookup shared by every public job/company surface.
// Real active company profiles are authoritative; the legacy name-keyed
// company_logos table remains a compatibility fallback for provider-synced
// companies that do not yet have a companies row.

function normalizeCompanyName(value) {
  return String(value || '').trim().toLowerCase();
}

export function isSafeCompanyImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//')) return false;
  if (raw.startsWith('/')) return true;
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch (e) { return false; }
}

export async function getLogoOverride(env, companyName) {
  const key = normalizeCompanyName(companyName);
  if (!key) return null;
  const map = await getLogoOverrides(env, [key]);
  return map[key] || null;
}

export async function getLogoOverrides(env, companyNames) {
  const unique = [...new Set((companyNames || []).map(normalizeCompanyName).filter(Boolean))];
  if (!unique.length) return {};
  const logos = {};
  const placeholders = unique.map(() => '?').join(',');

  // `companies.logo_url` is the source of truth for active, user/admin-managed
  // company records. This query is intentionally isolated so a pre-Stage-3
  // database without the table can still render provider jobs safely.
  try {
    const { results } = await env.DB.prepare(
      `SELECT LOWER(name) AS company_lower, logo_url
       FROM companies
       WHERE status = 'active' AND logo_url IS NOT NULL AND logo_url != ''
         AND LOWER(name) IN (${placeholders})`
    ).bind(...unique).all();
    for (const row of results || []) {
      const key = normalizeCompanyName(row.company_lower);
      if (key && row.logo_url && isSafeCompanyImageUrl(row.logo_url)) logos[key] = String(row.logo_url).trim();
    }
  } catch (e) {}

  // Compatibility path for imported/provider-only company names and legacy
  // admin corrections. It never overwrites a real company profile logo.
  try {
    const { results } = await env.DB.prepare(
      `SELECT company_lower, logo_url FROM company_logos WHERE company_lower IN (${placeholders})`
    ).bind(...unique).all();
    for (const row of results || []) {
      const key = normalizeCompanyName(row.company_lower);
      if (key && row.logo_url && !logos[key] && isSafeCompanyImageUrl(row.logo_url)) logos[key] = String(row.logo_url).trim();
    }
  } catch (e) {}
  return logos;
}

// Hydrates the public job shape once at the backend boundary. Consumers keep
// receiving all existing job fields plus one additive `company_logo_url`, so
// SSR cards, the JSON jobs API, saved jobs, and client-side search all use the
// same resolved image without guessing from a domain or duplicating lookups.
export async function attachCompanyLogos(env, jobs) {
  const rows = Array.isArray(jobs) ? jobs : [];
  const logos = await getLogoOverrides(env, rows.map(job => job?.company));
  return rows.map(job => ({
    ...job,
    company_logo_url: logos[normalizeCompanyName(job?.company)] || null,
  }));
}

export async function setCompanyLogo(env, companyName, logoUrl) {
  const lower = normalizeCompanyName(companyName);
  const url = String(logoUrl || '').trim();
  if (!lower || !isSafeCompanyImageUrl(url)) throw new Error('A valid HTTP(S) or site-relative image URL is required.');
  await env.DB.prepare(
    `INSERT INTO company_logos (company_lower, logo_url, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(company_lower) DO UPDATE SET logo_url = excluded.logo_url, updated_at = CURRENT_TIMESTAMP`
  ).bind(lower, url).run();
}

export async function removeCompanyLogo(env, companyName) {
  const lower = normalizeCompanyName(companyName);
  if (!lower) return;
  await env.DB.prepare('DELETE FROM company_logos WHERE company_lower = ?').bind(lower).run();
}
