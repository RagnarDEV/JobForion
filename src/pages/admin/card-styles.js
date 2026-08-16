// src/pages/admin/card-styles.js
// Per-tier (Free/Featured/Premium/Sponsored) job card appearance:
// background (solid or gradient), border, logo size, padding, shadow,
// and badge colors — with a live preview rendered using the exact same
// helpers the public site uses (lib/job-card-styles.js), so what the
// admin sees here is pixel-identical to what visitors see.

import { escapeHtml } from '../../lib/entities.js';
import { getCardStyles, buildCardStyleAttr, buildBadgeStyleAttr, CARD_STYLE_JOB_TYPES } from '../../lib/job-card-styles.js';
import { JOB_TYPE_META } from '../../config/constants.js';

function colorField(label, name, value) {
  return `<label style="display:flex;flex-direction:column;gap:6px">
    <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">${label}</span>
    <span style="display:flex;gap:8px;align-items:center">
      <input type="color" name="${name}" value="${escapeHtml(value)}" style="width:40px;height:36px;border-radius:8px;border:1px solid var(--border2);padding:2px;cursor:pointer">
      <input type="text" value="${escapeHtml(value)}" pattern="#[0-9a-fA-F]{6}" oninput="this.previousElementSibling.value=this.value" onchange="this.previousElementSibling.dispatchEvent(new Event('input'))" class="adm-input" style="width:90px;font-family:monospace;font-size:12px" data-color-twin>
    </span>
  </label>`;
}

function previewCardHtml(type, style) {
  const meta = JOB_TYPE_META[type];
  const cardAttr = buildCardStyleAttr(style);
  const badgeAttr = buildBadgeStyleAttr(style);
  return `<a class="job-card" style="--cat-color:#2563EB;${cardAttr};pointer-events:none;text-decoration:none;display:block">
    <div class="card-inner" style="padding:${style.card_padding}px 16px">
      <div class="card-row1">
        <div class="co-logo" style="width:${style.logo_size}px;height:${style.logo_size}px;display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--brand);background:var(--brand-soft);border-radius:12px;flex-shrink:0">JF</div>
        <div class="card-body">
          <div class="card-badges">
            ${type !== 'Free' ? `<span class="jt-badge" style="${badgeAttr}">${meta.icon} ${meta.label}</span>` : ''}
            <span class="cat-dot"><span class="dot"></span>Development</span>
          </div>
          <div class="job-title-card">Senior Backend Engineer</div>
          <div class="job-co-card">Acme Inc.</div>
          <div class="job-meta-row"><span class="tag tag-loc">🌍 Remote</span></div>
        </div>
      </div>
      <div class="card-right"><div class="salary-badge">$120k - $160k</div></div>
    </div>
  </a>`;
}

function tierSection(type, style) {
  const meta = JOB_TYPE_META[type];
  return `
  <div class="adm-card" style="margin-bottom:16px">
    <div class="adm-card-title">${meta.icon || '⚪'} ${type} Tier</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
      <form method="POST" action="/admin/card-styles/update" style="display:flex;flex-direction:column;gap:14px">
        <input type="hidden" name="job_type" value="${type}">

        <label style="display:flex;flex-direction:column;gap:6px">
          <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Background</span>
          <select class="adm-input" name="bg_type">
            <option value="solid" ${style.bg_type === 'solid' ? 'selected' : ''}>Solid color</option>
            <option value="gradient" ${style.bg_type === 'gradient' ? 'selected' : ''}>Gradient</option>
          </select>
        </label>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          ${colorField('Color 1', 'bg_color1', style.bg_color1)}
          ${colorField('Color 2 (gradient)', 'bg_color2', style.bg_color2)}
          <label style="display:flex;flex-direction:column;gap:6px">
            <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Angle</span>
            <input class="adm-input" type="number" name="gradient_angle" value="${style.gradient_angle}" min="0" max="360" style="width:70px">
          </label>
        </div>

        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
          <label style="display:flex;flex-direction:column;gap:6px">
            <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Border Style</span>
            <select class="adm-input" name="border_style">
              <option value="solid" ${style.border_style === 'solid' ? 'selected' : ''}>Solid</option>
              <option value="dashed" ${style.border_style === 'dashed' ? 'selected' : ''}>Dashed</option>
              <option value="none" ${style.border_style === 'none' ? 'selected' : ''}>None</option>
            </select>
          </label>
          ${colorField('Border Color', 'border_color', style.border_color)}
          <label style="display:flex;flex-direction:column;gap:6px">
            <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Width (px)</span>
            <input class="adm-input" type="number" name="border_width" value="${style.border_width}" min="0" max="6" style="width:60px">
          </label>
        </div>

        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <label style="display:flex;flex-direction:column;gap:6px">
            <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Logo Size (px)</span>
            <input class="adm-input" type="number" name="logo_size" value="${style.logo_size}" min="28" max="96" style="width:70px">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px">
            <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Card Padding (px)</span>
            <input class="adm-input" type="number" name="card_padding" value="${style.card_padding}" min="8" max="28" style="width:70px">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px">
            <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Shadow</span>
            <select class="adm-input" name="shadow">
              <option value="none" ${style.shadow === 'none' ? 'selected' : ''}>None</option>
              <option value="soft" ${style.shadow === 'soft' ? 'selected' : ''}>Soft</option>
              <option value="strong" ${style.shadow === 'strong' ? 'selected' : ''}>Strong</option>
            </select>
          </label>
        </div>

        ${type !== 'Free' ? `<div style="display:flex;gap:12px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:14px">
          ${colorField('Badge Background', 'badge_bg_color', style.badge_bg_color)}
          ${colorField('Badge Text', 'badge_text_color', style.badge_text_color)}
        </div>` : ''}

        <div style="display:flex;gap:10px">
          <button class="adm-btn adm-btn-primary" type="submit">Save ${type}</button>
        </div>
      </form>
      <form method="POST" action="/admin/card-styles/reset" style="display:inline;margin-top:-6px">
        <input type="hidden" name="job_type" value="${type}">
        <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;margin-bottom:8px">Live Preview</div>
        ${previewCardHtml(type, style)}
        <button class="adm-btn-sm" type="submit" style="margin-top:10px">Reset to Default</button>
      </form>
    </div>
  </div>`;
}

export async function renderCardStylesContent(env) {
  const styles = await getCardStyles(env);
  const sections = CARD_STYLE_JOB_TYPES.map(type => tierSection(type, styles[type])).join('');

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">🎨 Job Card Styles</div>
        <div class="adm-sub">Full visual control over each job tier's card — background, border, logo size, padding, and badge colors. Changes apply site-wide within about a minute.</div>
      </div>
    </div>
    ${sections}
  </div>
  <script>
  // Keep each color swatch and its hex text field in sync both ways.
  document.querySelectorAll('input[type=color]').forEach(function(swatch){
    var twin = swatch.parentElement.querySelector('[data-color-twin]');
    if (!twin) return;
    swatch.addEventListener('input', function(){ twin.value = swatch.value; });
  });
  </script>`;
}
