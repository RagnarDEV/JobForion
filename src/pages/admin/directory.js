// src/pages/admin/directory.js
// Countries / Cities / Skills management — see lib/directory-overrides.js
// for why this is a rename/hide layer rather than full CRUD: these three
// directories have no independent existence, they're aggregated live
// from job.location / job.skills free text. An admin can fix a messy
// auto-detected label (e.g. "CA" to "California") or hide a junk/
// misclassified entry (e.g. a US state that slipped into the countries
// list) — new entries simply appear on their own as jobs sync in.
//
// Each of the three lists can get long (skills especially), so this is
// search-first rather than "show everything": the top 40 by job count
// render by default, and typing in the search box (a plain GET param —
// no client JS required, works identically with JS disabled) filters
// the FULL underlying list, not just the visible top 40.

import { escapeHtml, listCountriesRaw, listCitiesRaw, listSkillsRaw } from '../../lib/entities.js';
import { getOverrides } from '../../lib/directory-overrides.js';

const SECTIONS = [
  { kind: 'country', title: '🌍 Countries', param: 'country_q', rawFn: listCountriesRaw },
  { kind: 'city', title: '🏙️ Cities', param: 'city_q', rawFn: listCitiesRaw },
  { kind: 'skill', title: '🏷️ Skills', param: 'skill_q', rawFn: listSkillsRaw },
];

function directoryRow(kind, item, override) {
  const isHidden = override?.hidden;
  const displayName = override?.display_name || item.name;
  return `<div class="dir-row${isHidden ? ' dir-row-hidden' : ''}">
    <form method="POST" action="/admin/directory/save" class="dir-row-form">
      <input type="hidden" name="kind" value="${kind}">
      <input type="hidden" name="name" value="${escapeHtml(item.name)}">
      <input class="adm-input" name="display_name" value="${escapeHtml(displayName)}" placeholder="${escapeHtml(item.name)}" style="flex:1;min-width:140px">
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink2);white-space:nowrap">
        <input type="checkbox" name="hidden" value="1" ${isHidden ? 'checked' : ''}> Hidden
      </label>
      <span class="dir-row-count">${item.count.toLocaleString()} job${item.count === 1 ? '' : 's'}</span>
      <button class="adm-btn-sm adm-btn-approve" type="submit">Save</button>
    </form>
    ${override ? `<form method="POST" action="/admin/directory/reset" class="dir-row-reset">
      <input type="hidden" name="kind" value="${kind}"><input type="hidden" name="name" value="${escapeHtml(item.name)}">
      <button class="adm-btn-sm" type="submit" title="Reset to auto-detected value">Reset</button>
    </form>` : ''}
  </div>`;
}

async function renderSection(env, section, params) {
  const { kind, title, param, rawFn } = section;
  const raw = await rawFn(env); // includes hidden entries — admin needs to see those to un-hide them
  const overrides = await getOverrides(env, kind);
  const q = (params.get(param) || '').trim().toLowerCase();

  const filtered = q ? raw.filter(item => item.name.toLowerCase().includes(q)) : raw;
  const visible = filtered.slice(0, 40);
  const remainingCount = filtered.length - visible.length; // items beyond the top-40 cap — unrelated to the override "hidden" flag

  const rows = visible.map(item => directoryRow(kind, item, overrides.get(item.name.toLowerCase()))).join('');

  return `
    <div class="adm-card" style="margin-bottom:16px">
      <div class="adm-card-title">${title} <span style="font-weight:400;color:var(--ink3);font-size:12px">— ${raw.length} auto-detected</span></div>
      <form method="GET" action="/admin/directory" style="display:flex;gap:8px;margin-bottom:12px">
        ${SECTIONS.filter(s => s.param !== param).map(s => `<input type="hidden" name="${s.param}" value="${escapeHtml(params.get(s.param) || '')}">`).join('')}
        <input class="adm-input" name="${param}" value="${escapeHtml(params.get(param) || '')}" placeholder="Search ${kind}s…" style="flex:1">
        <button class="adm-btn" type="submit">Search</button>
        ${q ? `<a href="/admin/directory?${SECTIONS.filter(s => s.param !== param).map(s => `${s.param}=${encodeURIComponent(params.get(s.param) || '')}`).join('&')}" class="adm-btn">Clear</a>` : ''}
      </form>
      ${rows || '<div class="adm-empty">No matches.</div>'}
      ${remainingCount > 0 ? `<div style="font-size:11px;color:var(--ink3);margin-top:10px">+${remainingCount.toLocaleString()} more — narrow your search to see them.</div>` : ''}
    </div>`;
}

export async function renderDirectoryContent(env, params) {
  const sectionsHtml = await Promise.all(SECTIONS.map(s => renderSection(env, s, params)));

  return `
  <div class="adm-wrap" style="max-width:820px">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">🌐 Directory</div>
        <div class="adm-sub">Countries, cities, and skills are auto-detected from job listings — rename a messy label or hide a bad one below</div>
      </div>
    </div>
    ${sectionsHtml.join('')}
  </div>
  <style>
  .dir-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--border)}
  .dir-row:last-child{border-bottom:none}
  .dir-row-hidden{opacity:.55}
  .dir-row-form{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:1;min-width:260px}
  .dir-row-count{font-size:11px;color:var(--ink3);white-space:nowrap;min-width:64px;text-align:right}
  .dir-row-reset{flex-shrink:0}
  @media(max-width:640px){.dir-row-form{width:100%}}
  </style>`;
}
