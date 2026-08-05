// src/pages/admin/categories.js
// Category Management: create / edit / reorder / activate-deactivate /
// delete — the concrete UI on top of lib/categories.js. Every category
// shown here is a live row in D1 (see db/schema.js's `categories` table);
// nothing about the site's category list lives in a JS file anymore.
//
// Mobile-first by design: each category is a stacked card (not a table
// row), so it reflows naturally on small screens instead of needing
// horizontal scroll. Reordering uses ▲▼ buttons rather than drag-and-drop
// — large, reliable tap targets that work identically with touch or a
// mouse, and don't need any client-side JS.

import { escapeHtml } from '../../lib/entities.js';
import { getCategoriesRaw } from '../../lib/categories.js';

async function categoryJobCounts(env, keys) {
  const out = {};
  await Promise.all(keys.map(async (key) => {
    try {
      const { results } = await env.DB.prepare("SELECT COUNT(*) c FROM jobs WHERE LOWER(title) LIKE ?").bind(`%${key}%`).all();
      out[key] = results[0]?.c || 0;
    } catch (e) { out[key] = 0; }
  }));
  return out;
}

function categoryCard(cat, idx, total, jobCount) {
  const swatch = /^#[0-9a-fA-F]{6}$/.test(cat.color || '') ? cat.color : '#3556FF';
  return `<div class="cat-card">
    <div class="cat-card-icon" style="background:${swatch}1a;color:${swatch}">${escapeHtml(cat.emoji || '🏷️')}</div>
    <form method="POST" action="/admin/categories/update" class="cat-card-form">
      <input type="hidden" name="key" value="${escapeHtml(cat.key)}">
      <input class="adm-input" name="label" value="${escapeHtml(cat.label)}" placeholder="Label" required style="min-width:120px;flex:1">
      <input class="adm-input" name="emoji" value="${escapeHtml(cat.emoji || '')}" placeholder="🏷️" maxlength="8" style="width:56px;text-align:center">
      <input class="adm-input" type="color" name="color" value="${swatch}" style="width:42px;padding:3px;height:36px">
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink2);white-space:nowrap">
        <input type="checkbox" name="active" value="1" ${cat.active ? 'checked' : ''}> Active
      </label>
      <button class="adm-btn-sm adm-btn-approve" type="submit">Save</button>
    </form>
    <div class="cat-card-actions">
      <form method="POST" action="/admin/categories/move"><input type="hidden" name="key" value="${escapeHtml(cat.key)}"><input type="hidden" name="direction" value="up"><button class="adm-btn-sm" type="submit" ${idx === 0 ? 'disabled' : ''} title="Move up">▲</button></form>
      <form method="POST" action="/admin/categories/move"><input type="hidden" name="key" value="${escapeHtml(cat.key)}"><input type="hidden" name="direction" value="down"><button class="adm-btn-sm" type="submit" ${idx === total - 1 ? 'disabled' : ''} title="Move down">▼</button></form>
      <form method="POST" action="/admin/categories/delete" onsubmit="return confirm('Delete \\'${escapeHtml(cat.label)}\\'? Jobs matching this keyword just stop being categorized under it — no jobs are deleted.')"><input type="hidden" name="key" value="${escapeHtml(cat.key)}"><button class="adm-btn-sm" type="submit">Delete</button></form>
    </div>
    <div class="cat-card-meta">${jobCount.toLocaleString()} job${jobCount === 1 ? '' : 's'} · matches "<code>${escapeHtml(cat.key)}</code>" in title</div>
  </div>`;
}

export async function renderCategoriesContent(env) {
  const categories = await getCategoriesRaw(env);
  const jobCounts = await categoryJobCounts(env, categories.map(c => c.key));

  return `
  <div class="adm-wrap" style="max-width:820px">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">🗂️ Categories</div>
        <div class="adm-sub">${categories.length} categories — classification matches a job's title against each category's key</div>
      </div>
    </div>

    <div class="adm-card" style="margin-bottom:16px">
      <div class="adm-card-title">Add New Category</div>
      <form method="POST" action="/admin/categories/create" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="adm-input" name="key" placeholder="key (e.g. security)" pattern="[a-z][a-z0-9]{1,19}" title="2–20 lowercase letters/numbers, starting with a letter" required style="width:160px">
        <input class="adm-input" name="label" placeholder="Label (e.g. Security)" required style="flex:1;min-width:140px">
        <input class="adm-input" name="emoji" placeholder="🔒" maxlength="8" style="width:56px;text-align:center">
        <input class="adm-input" type="color" name="color" value="#3556FF" style="width:42px;padding:3px;height:36px">
        <button class="adm-btn adm-btn-primary" type="submit">+ Add Category</button>
      </form>
      <div style="font-size:11px;color:var(--ink3);margin-top:8px">The key is matched (case-insensitive) against job titles to classify jobs automatically — keep it a single relevant word, e.g. <code>security</code>, <code>legal</code>, <code>mobile</code>.</div>
    </div>

    <div class="adm-card">
      <div class="adm-card-title">All Categories <span style="font-weight:400;color:var(--ink3);font-size:12px">— ▲▼ to reorder, uncheck Active to hide from the public site without deleting</span></div>
      ${categories.length ? categories.map((c, i) => categoryCard(c, i, categories.length, jobCounts[c.key] || 0)).join('') : '<div class="adm-empty">No categories yet — add one above.</div>'}
    </div>
  </div>
  <style>
  .cat-card{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:14px 0;border-bottom:1px solid var(--border)}
  .cat-card:last-child{border-bottom:none}
  .cat-card-icon{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
  .cat-card-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex:1;min-width:280px}
  .cat-card-actions{display:flex;gap:4px;flex-shrink:0}
  .cat-card-meta{width:100%;font-size:11px;color:var(--ink3);padding-left:48px}
  .cat-card-meta code{background:var(--surface2);padding:1px 5px;border-radius:4px}
  @media(max-width:640px){.cat-card-form{width:100%}.cat-card-meta{padding-left:0}}
  </style>`;
}
