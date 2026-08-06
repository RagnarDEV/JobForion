// src/pages/admin/pages-cms.js
// Static Pages management: list, create, edit, publish/draft/schedule,
// reorder, delete. See lib/pages-cms.js for the data layer and the
// reserved-slug / effective-status rules.

import { escapeHtml } from '../../lib/entities.js';
import { getPages } from '../../lib/pages-cms.js';
import { richEditorHtml } from '../../components/rich-editor.js';

const STATUS_BADGE = {
  published: '<span style="font-size:10px;font-weight:800;color:var(--green);background:rgba(15,174,121,.1);padding:2px 8px;border-radius:20px">● PUBLISHED</span>',
  draft: '<span style="font-size:10px;font-weight:800;color:var(--ink3);background:var(--surface2);padding:2px 8px;border-radius:20px">○ DRAFT</span>',
  scheduled: '<span style="font-size:10px;font-weight:800;color:var(--amber);background:rgba(245,166,35,.12);padding:2px 8px;border-radius:20px">◷ SCHEDULED</span>',
};

export async function renderPagesListContent(env) {
  const pages = await getPages(env, { includeUnpublished: true });

  const rows = pages.map((p, i) => `
    <div class="pp-row">
      <div class="pp-info">
        <div class="pp-title">${escapeHtml(p.title)} ${STATUS_BADGE[p.status] || ''}</div>
        <div class="pp-meta">/${escapeHtml(p.slug)} ${p.show_in_footer ? '· shown in footer' : '· hidden from footer'}${p.status === 'scheduled' && p.scheduled_at ? ` · publishes ${new Date(p.scheduled_at).toLocaleString()}` : ''}</div>
      </div>
      <div class="pp-actions">
        <a href="/${p.slug}" target="_blank" class="adm-btn-sm" style="color:var(--ink2)">Preview</a>
        <a href="/admin/pages/edit?slug=${encodeURIComponent(p.slug)}" class="adm-btn-sm" style="color:var(--brand)">Edit</a>
        <form method="POST" action="/admin/pages/move" style="display:inline">
          <input type="hidden" name="slug" value="${escapeHtml(p.slug)}"><input type="hidden" name="direction" value="up">
          <button class="adm-btn-sm" type="submit" ${i === 0 ? 'disabled' : ''}>↑</button>
        </form>
        <form method="POST" action="/admin/pages/move" style="display:inline">
          <input type="hidden" name="slug" value="${escapeHtml(p.slug)}"><input type="hidden" name="direction" value="down">
          <button class="adm-btn-sm" type="submit" ${i === pages.length - 1 ? 'disabled' : ''}>↓</button>
        </form>
        <form method="POST" action="/admin/pages/delete" onsubmit="return confirm('Delete this page permanently?')" style="display:inline">
          <input type="hidden" name="slug" value="${escapeHtml(p.slug)}">
          <button class="adm-btn-sm" type="submit">Delete</button>
        </form>
      </div>
    </div>`).join('');

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">📄 Pages</div>
        <div class="adm-sub">${pages.length} pages — edit existing ones or create new ones (About, FAQ, Cookie Policy, ...) without touching code</div>
      </div>
      <a href="/admin/pages/new" class="adm-btn adm-btn-primary">+ New Page</a>
    </div>
    <div class="adm-card">
      ${rows || '<div class="adm-empty">No pages yet.</div>'}
    </div>
  </div>`;
}

function pageForm(page, isNew) {
  const p = page || { slug: '', title: '', meta_description: '', body: '', status: 'published', scheduled_at: '', show_in_footer: 1 };
  const action = isNew ? '/admin/pages/create' : '/admin/pages/update';
  return `
  <div class="adm-wrap" style="max-width:820px">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">${isNew ? '📄 New Page' : `✏️ Edit — ${escapeHtml(p.title)}`}</div>
        <div class="adm-sub">${isNew ? 'Create a new page at any URL' : `/${escapeHtml(p.slug)}`}</div>
      </div>
      <a href="/admin/pages" class="adm-btn">← Back</a>
    </div>
    <form method="POST" action="${action}" class="adm-card" style="display:flex;flex-direction:column;gap:14px">
      ${isNew ? '' : `<input type="hidden" name="slug" value="${escapeHtml(p.slug)}">`}
      <div style="display:grid;grid-template-columns:${isNew ? '1fr 1fr' : '1fr'};gap:14px">
        <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Title</span>
          <input class="adm-input" style="width:100%" name="title" value="${escapeHtml(p.title)}" required></label>
        ${isNew ? `<label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">URL Slug</span>
          <input class="adm-input" style="width:100%" name="slug" placeholder="about-us" pattern="[a-z][a-z0-9-]{1,49}" required>
          <span style="font-size:11px;color:var(--ink3);display:block;margin-top:4px">Lowercase letters, numbers, hyphens only. Becomes /your-slug.</span></label>` : ''}
      </div>
      <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Meta Description (SEO)</span>
        <input class="adm-input" style="width:100%" name="meta_description" value="${escapeHtml(p.meta_description || '')}" maxlength="300"></label>

      <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Content</span>
        ${richEditorHtml('body', p.body || '')}
      </label>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;align-items:end">
        <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Status</span>
          <select class="adm-input" style="width:100%" name="status" onchange="document.getElementById('schedRow').style.display=this.value==='scheduled'?'block':'none'">
            <option value="published" ${p.status === 'published' ? 'selected' : ''}>Published</option>
            <option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="scheduled" ${p.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
          </select></label>
        <label style="display:block" id="schedRow" ${p.status === 'scheduled' ? '' : 'style="display:none"'}><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Publish At</span>
          <input class="adm-input" style="width:100%" type="datetime-local" name="scheduled_at" value="${p.scheduled_at ? escapeHtml(String(p.scheduled_at).slice(0, 16)) : ''}"></label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2);padding-bottom:10px">
          <input type="checkbox" name="show_in_footer" value="1" ${p.show_in_footer ? 'checked' : ''}> Show in footer</label>
      </div>

      <div style="display:flex;gap:10px">
        <button class="adm-btn adm-btn-primary" type="submit">${isNew ? 'Create Page' : 'Save Changes'}</button>
        ${isNew ? '' : `<a href="/${escapeHtml(p.slug)}" target="_blank" class="adm-btn">Preview Live</a>`}
      </div>
    </form>
  </div>`;
}

export function renderPageEditContent(page) {
  return pageForm(page, false);
}

export function renderPageNewContent() {
  return pageForm(null, true);
}
