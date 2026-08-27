// src/pages/admin/homepage.js
// Homepage Sections Builder — the admin-facing half of the built-in
// section controls plus the custom-section editor. Deliberately simple: a
// sorted list of cards, enable/disable and Up/Down controls, and a dedicated
// New/Edit form for isolated HTML/CSS/JavaScript blocks. No drag-and-drop
// (unreliable on mobile — see the project's "Mobile First" rule).

import { escapeHtml } from '../../lib/entities.js';
import { getAllHomepageSections } from '../../lib/homepage-sections.js';
import { getAllHomepageCustomSections, HOMEPAGE_CUSTOM_SECTION_LIMITS } from '../../lib/homepage-custom-sections.js';
import { pageCodeEditorHtml } from '../../components/page-code-editor.js';

export async function renderHomepageBuilderContent(env) {
  const sections = await getAllHomepageSections(env);
  const customSections = await getAllHomepageCustomSections(env);

  const rows = sections.map((s, i) => {
    const isFirst = i === 0;
    const isLast = i === sections.length - 1;
    return `
    <div class="hp-row">
      <div class="hp-row-order">
        <form method="POST" action="/admin/homepage/move" style="display:inline">
          <input type="hidden" name="key" value="${s.key}">
          <input type="hidden" name="direction" value="up">
          <button class="hp-order-btn" type="submit" ${isFirst ? 'disabled' : ''} title="Move up">▲</button>
        </form>
        <span class="hp-order-num">${i + 1}</span>
        <form method="POST" action="/admin/homepage/move" style="display:inline">
          <input type="hidden" name="key" value="${s.key}">
          <input type="hidden" name="direction" value="down">
          <button class="hp-order-btn" type="submit" ${isLast ? 'disabled' : ''} title="Move down">▼</button>
        </form>
      </div>
      <div class="hp-row-main">
        <div class="hp-row-title">${escapeHtml(s.label)} ${s.required ? '<span class="hp-required-badge">Required</span>' : ''}</div>
        <div class="hp-row-desc">${escapeHtml(s.description || '')}</div>
      </div>
      <div class="hp-row-toggle">
        <a class="adm-btn-sm hp-edit-link" href="/admin/homepage/edit?key=${encodeURIComponent(s.key)}" title="Edit section HTML, CSS, and JavaScript">Edit Code</a>
        ${s.required
          ? `<span class="hp-status-on">● Always On</span>`
          : `<form method="POST" action="/admin/homepage/toggle" style="display:inline">
               <input type="hidden" name="key" value="${s.key}">
               <input type="hidden" name="enabled" value="${s.enabled ? '0' : '1'}">
               <button class="adm-btn-sm" type="submit" style="color:${s.enabled ? 'var(--coral)' : 'var(--green)'}">${s.enabled ? 'Disable' : 'Enable'}</button>
             </form>
             <span class="${s.enabled ? 'hp-status-on' : 'hp-status-off'}">${s.enabled ? '● Live' : '○ Hidden'}</span>`}
      </div>
    </div>`;
  }).join('');

  const customRows = customSections.map((s, i) => `
    <div class="hp-row hp-custom-row">
      <div class="hp-row-order">
        <form method="POST" action="/admin/homepage/custom/move" style="display:inline">
          <input type="hidden" name="id" value="${s.id}"><input type="hidden" name="direction" value="up">
          <button class="hp-order-btn" type="submit" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
        </form>
        <span class="hp-order-num">${i + 1}</span>
        <form method="POST" action="/admin/homepage/custom/move" style="display:inline">
          <input type="hidden" name="id" value="${s.id}"><input type="hidden" name="direction" value="down">
          <button class="hp-order-btn" type="submit" ${i === customSections.length - 1 ? 'disabled' : ''} title="Move down">▼</button>
        </form>
      </div>
      <div class="hp-row-main">
        <div class="hp-row-title"><span class="hp-custom-badge">Custom</span> ${escapeHtml(s.title)}</div>
        <div class="hp-row-desc">${escapeHtml(s.description || 'Custom HTML/CSS/JavaScript section')} · rendered in an isolated frame</div>
      </div>
      <div class="hp-row-actions">
        <a class="adm-btn-sm" href="/admin/homepage/edit?id=${encodeURIComponent(s.id)}" style="color:var(--brand)">Edit</a>
        <form method="POST" action="/admin/homepage/custom/toggle" style="display:inline"><input type="hidden" name="id" value="${s.id}"><input type="hidden" name="enabled" value="${s.enabled ? '0' : '1'}"><button class="adm-btn-sm" type="submit" style="color:${s.enabled ? 'var(--coral)' : 'var(--green)'}">${s.enabled ? 'Disable' : 'Enable'}</button></form>
        <form method="POST" action="/admin/homepage/custom/delete" onsubmit="return confirm('Delete this homepage section permanently?')" style="display:inline"><input type="hidden" name="id" value="${s.id}"><button class="adm-btn-sm" type="submit">Delete</button></form>
        <span class="${s.enabled ? 'hp-status-on' : 'hp-status-off'}">${s.enabled ? '● Live' : '○ Hidden'}</span>
      </div>
    </div>`).join('');

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">🏠 Homepage Sections</div>
        <div class="adm-sub">Enable, disable, reorder, create, and edit the blocks that make up the homepage — changes are live immediately</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a href="/admin/homepage/new" class="adm-btn adm-btn-primary">+ New Section</a><a href="/" target="_blank" class="adm-btn">View Live Homepage</a></div>
    </div>

    <div class="adm-card" style="margin-bottom:14px">
      <div style="font-size:12px;color:var(--ink2);line-height:1.7">
        <b>Hero</b> and <b>Job Listing</b> can\u2019t be disabled \u2014 they carry the site\u2019s search box and the job list itself, so turning them off would break the homepage rather than customize it. Custom sections are appended after the built-in homepage blocks and can be enabled, edited, reordered, or deleted independently.
      </div>
    </div>

    <div class="adm-card" style="padding:6px 0;margin-bottom:16px">
      <div class="hp-card-heading">Built-in sections <span>Fixed, tested homepage blocks</span></div>
      ${rows}
    </div>
    <div class="adm-card" style="padding:6px 0">
      <div class="hp-card-heading">Custom sections <span>HTML/CSS/JavaScript blocks</span></div>
      ${customRows || '<div class="adm-empty">No custom sections yet. Use <a href="/admin/homepage/new">+ New Section</a> to add one.</div>'}
    </div>
  </div>
  <style>
    .hp-card-heading{display:flex;align-items:baseline;gap:8px;padding:13px 16px 8px;color:var(--ink);font-size:13px;font-weight:800}.hp-card-heading span{color:var(--ink3);font-size:10.5px;font-weight:500}
    .hp-row{display:flex;align-items:center;gap:14px;padding:14px 16px;border-bottom:1px solid var(--border)}
    .hp-row:last-child{border-bottom:none}
    .hp-row-order{display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0}
    .hp-order-btn{width:26px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--surface2);color:var(--ink2);font-size:10px;cursor:pointer}
    .hp-order-btn:disabled{opacity:.3;cursor:default}
    .hp-order-num{font-size:10px;font-weight:700;color:var(--ink3)}
    .hp-row-main{flex:1;min-width:0}
    .hp-row-title{font-size:13px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .hp-row-desc{font-size:11.5px;color:var(--ink3);margin-top:3px;line-height:1.5}
    .hp-required-badge{font-size:9.5px;font-weight:800;color:var(--brand);background:var(--brand-soft);padding:2px 8px;border-radius:20px;letter-spacing:.3px}
    .hp-row-toggle{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0}.hp-edit-link{color:var(--brand)!important;text-decoration:none}
    .hp-status-on{font-size:10px;font-weight:700;color:var(--green)}
    .hp-status-off{font-size:10px;font-weight:700;color:var(--ink3)}.hp-custom-badge{font-size:9.5px;font-weight:800;color:#a85e20;background:rgba(245,166,35,.14);padding:2px 8px;border-radius:20px;letter-spacing:.3px}.hp-row-actions{display:flex;align-items:center;gap:7px;flex-shrink:0}.hp-custom-row{background:linear-gradient(90deg,rgba(99,57,230,.025),transparent)}
    @media(max-width:680px){.hp-row{flex-wrap:wrap}.hp-row-toggle,.hp-row-actions{flex-direction:row;align-items:center;margin-left:40px}.hp-card-heading{padding-left:12px}}
  </style>`;
}


function customSectionForm(section, isNew) {
  const s = section || { id: '', title: '', description: '', custom_html: '', custom_css: '', custom_js: '', enabled: 1 };
  const action = isNew ? '/admin/homepage/custom/create' : '/admin/homepage/custom/update';
  return `
  <div class="adm-wrap" style="max-width:980px">
    <div class="adm-hdr"><div><div class="adm-title">${isNew ? '🧩 New Homepage Section' : `✏️ Edit — ${escapeHtml(s.title)}`}</div><div class="adm-sub">${isNew ? 'Add a custom block to the homepage' : 'Update this custom homepage block'}</div></div><a href="/admin/homepage" class="adm-btn">Back</a></div>
    <form method="POST" action="${action}" class="adm-card" style="display:flex;flex-direction:column;gap:14px">
      ${isNew ? '' : `<input type="hidden" name="id" value="${escapeHtml(s.id)}">`}
      <div class="hp-form-grid"><label style="display:block"><span class="hp-form-label">Title</span><input class="adm-input" style="width:100%" name="title" maxlength="${HOMEPAGE_CUSTOM_SECTION_LIMITS.title}" value="${escapeHtml(s.title)}" placeholder="Partner logos" required></label><label style="display:block"><span class="hp-form-label">Description</span><input class="adm-input" style="width:100%" name="description" maxlength="${HOMEPAGE_CUSTOM_SECTION_LIMITS.description}" value="${escapeHtml(s.description || '')}" placeholder="Short internal description"></label></div>
      ${pageCodeEditorHtml({ html: s.custom_html || '', css: s.custom_css || '', js: s.custom_js || '' })}
      <label style="display:flex;align-items:center;gap:8px;color:var(--ink2);font-size:13px"><input type="checkbox" name="enabled" value="1" ${s.enabled ? 'checked' : ''}> Publish this section on the homepage</label>
      <div style="display:flex;gap:10px"><button class="adm-btn adm-btn-primary" type="submit">${isNew ? 'Create Section' : 'Save Changes'}</button><a href="/admin/homepage" class="adm-btn">Cancel</a></div>
    </form>
  </div><style>.hp-form-grid{display:grid;grid-template-columns:1fr 2fr;gap:14px}.hp-form-label{display:block;margin-bottom:6px;color:var(--ink3);font-size:11px;font-weight:700;text-transform:uppercase}@media(max-width:680px){.hp-form-grid{grid-template-columns:1fr}}</style>`;
}

export function renderHomepageCustomSectionNewContent() {
  return customSectionForm(null, true);
}

export function renderHomepageCustomSectionEditContent(section) {
  return customSectionForm(section, false);
}


function homepageSectionCodeForm(section) {
  const key = String(section?.key || '');
  return `
  <div class="adm-wrap" style="max-width:980px">
    <div class="adm-hdr"><div><div class="adm-title">✏️ Edit Code — ${escapeHtml(section?.label || key)}</div><div class="adm-sub">Edit this existing Homepage section directly. Empty code fields keep the original JobForion renderer for this section.</div></div><a href="/admin/homepage" class="adm-btn">Back</a></div>
    <form method="POST" action="/admin/homepage/update-code" class="adm-card" style="display:flex;flex-direction:column;gap:14px">
      <input type="hidden" name="key" value="${escapeHtml(key)}">
      ${pageCodeEditorHtml({ html: section?.custom_html || '', css: section?.custom_css || '', js: section?.custom_js || '' })}
      <div class="hp-code-warning">When any code field is filled, it replaces the selected built-in section on the public homepage. JavaScript remains isolated inside the sandboxed frame and cannot access the parent page or JobForion session.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="adm-btn adm-btn-primary" type="submit">Save Section Code</button><button class="adm-btn" type="submit" formaction="/admin/homepage/clear-code" formmethod="POST" onclick="return confirm('Clear custom code and restore the original section?')">Restore Original Section</button><a href="/admin/homepage" class="adm-btn">Cancel</a></div>
    </form>
  </div><style>.hp-code-warning{padding:11px 13px;border:1px solid rgba(245,166,35,.35);border-radius:9px;background:rgba(245,166,35,.08);color:var(--ink2);font-size:11px;line-height:1.6}</style>`;
}

export function renderHomepageSectionCodeEditContent(section) {
  return homepageSectionCodeForm(section);
}
