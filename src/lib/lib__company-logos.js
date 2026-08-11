// src/lib/company-logos.js
// Admin-managed logo overrides for companies whose auto-detected favicon
// (Google/DuckDuckGo favicon services — see components/job-card.js's
// logoImgHtml) is missing, wrong, or low quality. Purely additive: a
// company with no override row keeps behaving exactly as before.

export async function getLogoOverride(env, companyName) {
  if (!companyName) return null;
  try {
    const { results } = await env.DB.prepare(
      'SELECT logo_url FROM company_logos WHERE company_lower = ?'
    ).bind(companyName.toLowerCase()).all();
    return results?.[0]?.logo_url || null;
  } catch (e) {
    return null;
  }
}

// Batch lookup for a page rendering many jobs at once (homepage, category/
// company/skill listings) — ONE query instead of one per job card.
// Returns a plain object keyed by lowercased company name for O(1) lookup.
export async function getLogoOverrides(env, companyNames) {
  const unique = [...new Set((companyNames || []).filter(Boolean).map(c => c.toLowerCase()))];
  if (!unique.length) return {};
  try {
    const placeholders = unique.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT company_lower, logo_url FROM company_logos WHERE company_lower IN (${placeholders})`
    ).bind(...unique).all();
    return Object.fromEntries((results || []).map(r => [r.company_lower, r.logo_url]));
  } catch (e) {
    return {};
  }
}

export async function setCompanyLogo(env, companyName, logoUrl) {
  const lower = (companyName || '').trim().toLowerCase();
  const url = (logoUrl || '').trim();
  if (!lower || !url) return;
  await env.DB.prepare(
    `INSERT INTO company_logos (company_lower, logo_url, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(company_lower) DO UPDATE SET logo_url = excluded.logo_url, updated_at = CURRENT_TIMESTAMP`
  ).bind(lower, url).run();
}

export async function removeCompanyLogo(env, companyName) {
  const lower = (companyName || '').trim().toLowerCase();
  if (!lower) return;
  await env.DB.prepare('DELETE FROM company_logos WHERE company_lower = ?').bind(lower).run();
}
