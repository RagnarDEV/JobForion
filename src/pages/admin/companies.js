// src/pages/admin/companies.js
// Company Management: search, see job counts, hide spam/fake companies
// from the public /companies directory (and everywhere else that calls
// listCompanies() in lib/entities.js — homepage facet panel, sitemap)
// without touching their individual job postings, which stay searchable
// and browsable exactly as before. Hiding is reversible at any time.

import { escapeHtml } from '../../lib/entities.js';
import { ensureTable } from '../../db/schema.js';
import { getLogoOverrides, setCompanyLogo, removeCompanyLogo } from '../../lib/company-logos.js';

const PAGE_SIZE = 40;

function companyRow(c) {
  return `<tr>
    <td style="font-weight:700;font-size:12.5px;color:var(--ink)">${escapeHtml(c.company)}${c.hidden ? ' <span class="hidden-badge">Hidden</span>' : ''}</td>
    <td style="font-size:12px;color:var(--ink2)">${c.job_count.toLocaleString()}</td>
    <td style="min-width:220px">
      <form method="POST" action="/admin/companies/logo/set" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="hidden" name="company" value="${escapeHtml(c.company)}">
        <input class="adm-input" name="logo_url" placeholder="https://…/logo.png" value="${escapeHtml(c.logoUrl || '')}" style="flex:1;min-width:140px;font-size:11px;padding:6px 9px">
        <button class="adm-btn-sm" type="submit" style="color:var(--brand)">${c.logoUrl ? 'Update' : 'Set'}</button>
        ${c.logoUrl ? `<button class="adm-btn-sm" type="submit" formaction="/admin/companies/logo/remove" style="color:var(--coral)">Remove</button>` : ''}
      </form>
    </td>
    <td>
      <div style="display:flex;gap:6px">
        <a class="adm-btn-sm" href="/companies/${encodeURIComponent(c.company)}" target="_blank" style="color:var(--ink2)">Preview</a>
        ${c.hidden
          ? `<form method="POST" action="/admin/companies/unhide" style="display:inline"><input type="hidden" name="company" value="${escapeHtml(c.company)}"><button class="adm-btn-sm adm-btn-approve" type="submit">Unhide</button></form>`
          : `<form method="POST" action="/admin/companies/hide" onsubmit="return confirm('Hide this company from the public directory? Their individual job postings will remain visible everywhere else.')" style="display:inline"><input type="hidden" name="company" value="${escapeHtml(c.company)}"><button class="adm-btn-sm" type="submit">Hide</button></form>`
        }
      </div>
    </td>
  </tr>`;
}

export async function renderCompaniesListContent(env, params) {
  await ensureTable(env);
  const qText = (params.get('q') || '').trim();
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Deliberately NOT using lib/entities.js's listCompanies() here — that
  // function now excludes hidden companies (correct for every public
  // page), but this admin view needs to see BOTH hidden and visible
  // companies together, with their hidden status, so it queries directly.
  const searchClause = qText ? `AND LOWER(company) LIKE ?` : '';
  const binds = qText ? [`%${qText.toLowerCase()}%`] : [];

  const { results: allCompanies } = await env.DB.prepare(
    `SELECT company, COUNT(*) job_count FROM jobs
     WHERE company IS NOT NULL AND company != '' ${searchClause}
     GROUP BY company ORDER BY job_count DESC`
  ).bind(...binds).all();

  const { results: hiddenRows } = await env.DB.prepare(`SELECT company_lower FROM hidden_companies`).all();
  const hiddenSet = new Set((hiddenRows || []).map(r => r.company_lower));

  const annotated = (allCompanies || []).map(c => ({ ...c, hidden: hiddenSet.has(c.company.toLowerCase()) }));
  const total = annotated.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageItems = annotated.slice(offset, offset + PAGE_SIZE);

  // Logo overrides only need fetching for the companies actually shown on
  // this page — one small batch query, not one per row.
  const logoMap = await getLogoOverrides(env, pageItems.map(c => c.company));
  const pageItemsWithLogos = pageItems.map(c => ({ ...c, logoUrl: logoMap[c.company.toLowerCase()] || '' }));

  const qs = (overrides) => {
    const p = new URLSearchParams(params);
    Object.entries(overrides).forEach(([k, v]) => v ? p.set(k, v) : p.delete(k));
    return p.toString();
  };

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">🏢 Company Management</div>
        <div class="adm-sub">${total.toLocaleString()} companies · ${hiddenSet.size} hidden from the public directory</div>
      </div>
    </div>

    <div class="adm-card" style="margin-bottom:14px">
      <form method="GET" action="/admin/companies" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="adm-input" name="q" placeholder="Search company name…" value="${escapeHtml(qText)}" style="flex:1;min-width:180px">
        <button class="adm-btn adm-btn-primary" type="submit">Search</button>
        ${qText ? `<a href="/admin/companies" class="adm-btn">Clear</a>` : ''}
      </form>
    </div>

    <div class="adm-card" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="text-align:left;border-bottom:1.5px solid var(--border)">
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Company</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Open Jobs</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Custom Logo</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Actions</th>
        </tr></thead>
        <tbody>${pageItemsWithLogos.map(companyRow).join('') || `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--ink3)">No companies match this search</td></tr>`}</tbody>
      </table>
    </div>

    ${totalPages > 1 ? `
    <div style="display:flex;justify-content:center;gap:8px;margin-top:16px">
      ${page > 1 ? `<a class="adm-btn" href="/admin/companies?${qs({ page: page - 1 })}">← Prev</a>` : ''}
      <span class="adm-btn" style="cursor:default">Page ${page} of ${totalPages}</span>
      ${page < totalPages ? `<a class="adm-btn" href="/admin/companies?${qs({ page: page + 1 })}">Next →</a>` : ''}
    </div>` : ''}
  </div>
  <style>.hidden-badge{background:var(--surface2);color:var(--ink3);font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;margin-left:6px}</style>`;
}
