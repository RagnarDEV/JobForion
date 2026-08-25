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

async function resolveCompanyLogos(env, { names = [], ids = [] } = {}) {
  const uniqueNames = [...new Set((names || []).map(normalizeCompanyName).filter(Boolean))];
  const uniqueIds = [...new Set((ids || []).map(value => String(value || '').trim()).filter(value => /^\d+$/.test(value)))];
  const byName = {};
  const byId = {};
  const websiteByName = {};
  const websiteById = {};
  if (!uniqueNames.length && !uniqueIds.length) return { byName, byId, websiteByName, websiteById };

  const companyConditions = [];
  const companyBinds = [];
  if (uniqueNames.length) {
    companyConditions.push(`LOWER(TRIM(name)) IN (${uniqueNames.map(() => '?').join(',')})`);
    companyBinds.push(...uniqueNames);
  }
  if (uniqueIds.length) {
    companyConditions.push(`id IN (${uniqueIds.map(() => '?').join(',')})`);
    companyBinds.push(...uniqueIds);
  }

  // `companies.logo_url` is the source of truth for active, user/admin-managed
  // company records. Matching by both canonical id and normalized name keeps
  // provider jobs with a company_id and older name-only jobs on one path.
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, logo_url, website
       FROM companies
       WHERE status = 'active'
         AND (logo_url IS NOT NULL AND TRIM(logo_url) != '' OR website IS NOT NULL AND TRIM(website) != '')
         AND (${companyConditions.join(' OR ')})`
    ).bind(...companyBinds).all();
    for (const row of results || []) {
      if (row.logo_url && isSafeCompanyImageUrl(row.logo_url)) {
        const logo = String(row.logo_url).trim();
        const id = String(row.id || '').trim();
        const name = normalizeCompanyName(row.name);
        if (id) byId[id] = logo;
        if (name) byName[name] = logo;
      }
    }
    for (const row of results || []) {
      const id = String(row.id || '').trim();
      const name = normalizeCompanyName(row.name);
      const website = String(row.website || '').trim();
      if (!website) continue;
      if (id) websiteById[id] = website;
      if (name) websiteByName[name] = website;
    }
  } catch (e) {}

  // Compatibility path for imported/provider-only company names and legacy
  // admin corrections. TRIM + LOWER makes old mixed-case/space-padded rows
  // resolvable, but the fallback never overwrites a real company profile logo.
  if (uniqueNames.length) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT company_lower, logo_url
         FROM company_logos
         WHERE LOWER(TRIM(company_lower)) IN (${uniqueNames.map(() => '?').join(',')})`
      ).bind(...uniqueNames).all();
      for (const row of results || []) {
        const key = normalizeCompanyName(row.company_lower);
        if (key && row.logo_url && !byName[key] && isSafeCompanyImageUrl(row.logo_url)) byName[key] = String(row.logo_url).trim();
      }
    } catch (e) {}
  }
  return { byName, byId, websiteByName, websiteById };
}

export async function getLogoOverride(env, companyName) {
  const key = normalizeCompanyName(companyName);
  if (!key) return null;
  const map = await getLogoOverrides(env, [key]);
  return map[key] || null;
}

export async function getLogoOverrides(env, companyNames) {
  const { byName } = await resolveCompanyLogos(env, { names: companyNames });
  return byName;
}

// Hydrates the public job shape once at the backend boundary. Consumers keep
// receiving all existing job fields plus one additive `company_logo_url`, so
// SSR cards, the JSON jobs API, saved jobs, and client-side search all use the
// same resolved image without guessing from a domain or duplicating lookups.
export async function attachCompanyLogos(env, jobs) {
  const rows = Array.isArray(jobs) ? jobs : [];
  const logos = await resolveCompanyLogos(env, {
    names: rows.map(job => job?.company),
    ids: rows.map(job => job?.company_id),
  });
  return rows.map(job => {
    const idKey = String(job?.company_id || '').trim();
    const nameKey = normalizeCompanyName(job?.company);
    return {
      ...job,
      company_logo_url: logos.byId[idKey] || logos.byName[nameKey] || null,
      company_website: logos.websiteById[idKey] || logos.websiteByName[nameKey] || null,
    };
  });
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
