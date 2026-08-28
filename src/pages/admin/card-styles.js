// src/pages/admin/card-styles.js
// Professional admin control center for the four independent job-card tiers.
// The controls intentionally use the existing persisted schema and endpoints;
// this file improves the editing experience without changing public contracts.

import { escapeHtml } from '../../lib/entities.js';
import { getCardStyles, buildCardStyleAttr, buildBadgeStyleAttr, jobTypeIconHtml, CARD_STYLE_JOB_TYPES, DEFAULT_CARD_STYLES } from '../../lib/job-card-styles.js';
import { JOB_TYPE_META } from '../../config/constants.js';
import { iconMapPin } from '../../assets/icons.js';

const STYLE_PRESETS = Object.freeze({
  clean: {
    label: 'Clean white', bg_type: 'solid', bg_color1: '#FFFFFF', bg_color2: '#FFFFFF', gradient_angle: 135,
    border_style: 'solid', border_color: '#E2E8F0', border_width: 1, logo_size: 54, card_padding: 14, shadow: 'none', badge_bg_color: '#EEF1FF', badge_text_color: '#2563EB', badge_border_color: '#DDE4F0', badge_radius: 20, template: 'classic', accent_color: '#E2E8F0', accent_position: 'none', title_color: '#17132D', company_color: '#6B7280', meta_color: '#7C8192', salary_color: '#2B9D68', icon_key: 'none', hover_effect: 'none',
  },
  indigo: {
    label: 'Indigo highlight', bg_type: 'gradient', bg_color1: '#FFFFFF', bg_color2: '#F0ECFF', gradient_angle: 135,
    border_style: 'solid', border_color: '#7664E8', border_width: 1, logo_size: 56, card_padding: 15, shadow: 'soft', badge_bg_color: '#E8E2FF', badge_text_color: '#5732C4', badge_border_color: '#C8B8FF', badge_radius: 18, template: 'highlight', accent_color: '#7664E8', accent_position: 'left', title_color: '#17132D', company_color: '#514A70', meta_color: '#6E6A82', salary_color: '#2475D1', icon_key: 'star', hover_effect: 'glow',
  },
  gold: {
    label: 'Premium gold', bg_type: 'gradient', bg_color1: '#FFFDF7', bg_color2: '#FBEDC7', gradient_angle: 135,
    border_style: 'solid', border_color: '#D4A12A', border_width: 2, logo_size: 60, card_padding: 16, shadow: 'strong', badge_bg_color: '#FBEDC7', badge_text_color: '#8A6416', badge_border_color: '#E7C86D', badge_radius: 18, template: 'spotlight', accent_color: '#D4A12A', accent_position: 'top', title_color: '#3E2D0B', company_color: '#735A20', meta_color: '#806F4B', salary_color: '#9A6C0A', icon_key: 'crown', hover_effect: 'glow',
  },
  emerald: {
    label: 'Emerald boost', bg_type: 'gradient', bg_color1: '#F4FDF9', bg_color2: '#D9F3E7', gradient_angle: 180,
    border_style: 'solid', border_color: '#059669', border_width: 2, logo_size: 62, card_padding: 16, shadow: 'strong', badge_bg_color: '#D9F3E7', badge_text_color: '#0B7A50', badge_border_color: '#A9DFC4', badge_radius: 18, template: 'promoted', accent_color: '#059669', accent_position: 'top', title_color: '#123D2E', company_color: '#28654F', meta_color: '#4E7768', salary_color: '#087A53', icon_key: 'rocket', hover_effect: 'glow',
  },
});

const SHADOW_LABELS = { none: 'Flat', soft: 'Soft lift', strong: 'Strong lift' };
const TYPE_DESCRIPTIONS = {
  Free: 'The everyday listing style. Keep it calm, readable and neutral.',
  Featured: 'A visible highlight for selected jobs without changing their pin order.',
  Premium: 'A high-value treatment with a refined gold visual language.',
  Sponsored: 'A clear promotional treatment with an emerald commercial signal.',
};

function safeStyle(type, style) {
  return { ...DEFAULT_CARD_STYLES[type], ...(style || {}) };
}

function colorField(label, name, value, hint = '') {
  return `<label class="jcs-field jcs-color-field">
    <span class="jcs-label">${label}</span>
    <span class="jcs-color-control">
      <input type="color" name="${name}" value="${escapeHtml(value)}" aria-label="${label}" data-color-swatch="${name}">
      <input type="text" value="${escapeHtml(value)}" pattern="#[0-9a-fA-F]{6}" inputmode="text" aria-label="${label} hex value" data-color-text="${name}" class="adm-input jcs-hex-input">
    </span>
    ${hint ? `<small class="jcs-help">${hint}</small>` : ''}
  </label>`;
}

function selectField(label, name, value, options, hint = '') {
  return `<label class="jcs-field">
    <span class="jcs-label">${label}</span>
    <select class="adm-input" name="${name}">${options.map(option => `<option value="${option.value}" ${String(value) === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}</select>
    ${hint ? `<small class="jcs-help">${hint}</small>` : ''}
  </label>`;
}

function numberField(label, name, value, min, max, hint = '') {
  return `<label class="jcs-field">
    <span class="jcs-label">${label}</span>
    <span class="jcs-number-wrap"><input class="adm-input" type="number" name="${name}" value="${escapeHtml(value)}" min="${min}" max="${max}" inputmode="numeric"><span class="jcs-unit">px</span></span>
    ${hint ? `<small class="jcs-help">${hint}</small>` : ''}
  </label>`;
}

function previewCardHtml(type, style) {
  const meta = JOB_TYPE_META[type];
  const s = safeStyle(type, style);
  const cardAttr = buildCardStyleAttr(s);
  const badgeAttr = buildBadgeStyleAttr(s);
  return `<div class="jcs-preview-wrap">
    <div class="jcs-preview-head"><span>Live preview</span><span class="jcs-preview-status" data-preview-status>${SHADOW_LABELS[s.shadow] || 'Custom style'}</span></div>
    <div class="jcs-preview-stage">
      <a class="job-card jt-card-${type.toLowerCase()} jct-template-${s.template} jct-accent-${s.accent_position} jct-hover-${s.hover_effect}" data-preview-card style="--cat-color:#2563EB;${cardAttr};pointer-events:none;text-decoration:none;display:block">
        <div class="card-inner" data-preview-inner style="padding:${s.card_padding}px 16px;background:inherit">
          <div class="card-row1">
            <div class="co-logo" data-preview-logo style="width:${s.logo_size}px;height:${s.logo_size}px;display:flex;align-items:center;justify-content:center;font-weight:900;color:var(--brand);background:#fff;border:1px solid var(--border);border-radius:12px;flex-shrink:0">JF</div>
            <div class="card-body">
              <div class="card-badges">
                ${type !== 'Free' ? `<span class="jt-badge" data-preview-badge style="${badgeAttr}"><span data-preview-badge-icon>${jobTypeIconHtml(type, s, { size: 12, cls: 'jt-badge-icon' })}</span><span>${meta.label}</span></span>` : ''}
                <span class="cat-dot"><span class="dot"></span>Development</span>
              </div>
              <div class="job-title-card">Senior Backend Engineer</div>
              <div class="job-co-card">Acme Inc. <span class="verified-ico">✓</span></div>
              <div class="job-meta-row"><span class="tag tag-remote">Remote</span><span class="tag tag-type">Full-time</span></div>
            </div>
          </div>
          <div class="card-right"><div class="card-secondary-meta"><span class="job-location job-location-v2">${iconMapPin({ size: 10 })} Worldwide</span><span class="card-time-corner">2d ago</span></div><div class="salary-badge">$120k – $160k</div></div>
        </div>
      </a>
    </div>
    <div class="jcs-preview-foot"><span><i class="jcs-dot jcs-dot-border"></i>Card surface</span><span><i class="jcs-dot jcs-dot-badge"></i>Tier badge</span><span><i class="jcs-dot jcs-dot-logo"></i>Logo scale</span></div>
  </div>`;
}

function tierSection(type, style) {
  const meta = JOB_TYPE_META[type];
  const s = safeStyle(type, style);
  const presetOptions = Object.entries(STYLE_PRESETS).map(([value, preset]) => `<option value="${value}">${preset.label}</option>`).join('');
  return `<section class="jcs-tier" id="jcs-${type.toLowerCase()}" data-tier="${type}">
    <div class="jcs-tier-head">
      <div class="jcs-tier-identity">
        <span class="jcs-tier-icon jcs-tier-${type.toLowerCase()}">${jobTypeIconHtml(type, s, { size: 19 }) || '<span class="jcs-free-mark">○</span>'}</span>
        <div><h2>${type}</h2><p>${TYPE_DESCRIPTIONS[type]}</p></div>
      </div>
      <span class="jcs-tier-chip">${type === 'Free' ? 'Default listing' : 'Visual tier only'}</span>
    </div>
    <div class="jcs-tier-body">
      <form method="POST" action="/admin/card-styles/update" class="jcs-form" data-style-form>
        <input type="hidden" name="job_type" value="${type}">
        <div class="jcs-form-topline"><div><span class="jcs-eyebrow">Style preset</span><strong>Start with a curated look</strong></div><select class="adm-input jcs-preset" data-preset><option value="">Keep current style</option>${presetOptions}</select></div>

        <div class="jcs-control-section">
          <div class="jcs-section-heading"><span class="jcs-section-number">01</span><div><h3>Surface &amp; color</h3><p>Define the visual identity of this tier.</p></div></div>
          <div class="jcs-grid jcs-grid-3">
            ${selectField('Background mode', 'bg_type', s.bg_type, [{ value: 'solid', label: 'Solid color' }, { value: 'gradient', label: 'Two-color gradient' }])}
            ${colorField('Primary color', 'bg_color1', s.bg_color1)}
            <span data-gradient-controls>${colorField('Secondary color', 'bg_color2', s.bg_color2, 'Used when gradient is selected.')}</span>
          </div>
          <div class="jcs-grid jcs-grid-2" data-gradient-controls>
            ${numberField('Gradient angle', 'gradient_angle', s.gradient_angle, 0, 360, '0° horizontal · 135° diagonal · 180° vertical.')}
            <div class="jcs-angle-guide"><span style="transform:rotate(${Number(s.gradient_angle) || 135}deg)"></span><small>Direction preview</small></div>
          </div>
        </div>

        <div class="jcs-control-section">
          <div class="jcs-section-heading"><span class="jcs-section-number">02</span><div><h3>Border language</h3><p>Make hierarchy visible without overwhelming the content.</p></div></div>
          <div class="jcs-grid jcs-grid-3">
            ${selectField('Border style', 'border_style', s.border_style, [{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'none', label: 'No border' }])}
            ${colorField('Border color', 'border_color', s.border_color)}
            ${numberField('Border width', 'border_width', s.border_width, 0, 6, 'Maximum 6px.')}
          </div>
        </div>

        <div class="jcs-control-section">
          <div class="jcs-section-heading"><span class="jcs-section-number">03</span><div><h3>Card rhythm</h3><p>Balance logo presence, spacing and depth across devices.</p></div></div>
          <div class="jcs-grid jcs-grid-3">
            ${numberField('Logo size', 'logo_size', s.logo_size, 28, 96, 'Recommended 48–64px.')}
            ${numberField('Card padding', 'card_padding', s.card_padding, 8, 28, 'Recommended 12–18px.')}
            ${selectField('Shadow', 'shadow', s.shadow, [{ value: 'none', label: 'Flat' }, { value: 'soft', label: 'Soft lift' }, { value: 'strong', label: 'Strong lift' }])}
          </div>
        </div>

        <div class="jcs-control-section">
          <div class="jcs-section-heading"><span class="jcs-section-number">04</span><div><h3>Template &amp; emphasis</h3><p>Choose the card composition, accent placement and hover behavior.</p></div></div>
          <div class="jcs-grid jcs-grid-3">
            ${selectField('Card template', 'template', s.template, [{ value: 'classic', label: 'Classic' }, { value: 'highlight', label: 'Highlight' }, { value: 'spotlight', label: 'Spotlight' }, { value: 'promoted', label: 'Promoted' }])}
            ${selectField('Accent placement', 'accent_position', s.accent_position, [{ value: 'none', label: 'None' }, { value: 'top', label: 'Top bar' }, { value: 'left', label: 'Side rail' }, { value: 'both', label: 'Top + side' }])}
            ${selectField('Hover effect', 'hover_effect', s.hover_effect, [{ value: 'none', label: 'None' }, { value: 'lift', label: 'Lift' }, { value: 'glow', label: 'Accent glow' }])}
          </div>
          <div class="jcs-grid jcs-grid-2">
            ${colorField('Accent color', 'accent_color', s.accent_color, 'Used by bars, focus and glow effects.')}
            ${selectField('Tier icon', 'icon_key', s.icon_key, [{ value: 'none', label: 'No icon' }, { value: 'star', label: 'Featured star' }, { value: 'crown', label: 'Premium crown' }, { value: 'rocket', label: 'Sponsored rocket' }], 'SVG icon rendered consistently across the site.')}
          </div>
        </div>

        <div class="jcs-control-section">
          <div class="jcs-section-heading"><span class="jcs-section-number">05</span><div><h3>Typography &amp; tone</h3><p>Control the information hierarchy and salary emphasis.</p></div></div>
          <div class="jcs-grid jcs-grid-2">
            ${colorField('Job title color', 'title_color', s.title_color)}
            ${colorField('Company color', 'company_color', s.company_color)}
            ${colorField('Metadata color', 'meta_color', s.meta_color)}
            ${colorField('Salary color', 'salary_color', s.salary_color, 'Keep strong contrast for quick scanning.')}
          </div>
        </div>

        <div class="jcs-control-section jcs-badge-section">
          <div class="jcs-section-heading"><span class="jcs-section-number">06</span><div><h3>Tier badge</h3><p>${type === 'Free' ? 'Free cards do not display a tier badge, but these values remain ready for future use.' : 'Tune the badge so it stays readable against the card surface.'}</p></div></div>
          <div class="jcs-grid jcs-grid-2">
            ${colorField('Badge background', 'badge_bg_color', s.badge_bg_color)}
            ${colorField('Badge text', 'badge_text_color', s.badge_text_color)}
            ${colorField('Badge border', 'badge_border_color', s.badge_border_color)}
            ${numberField('Badge radius', 'badge_radius', s.badge_radius, 4, 30, '4px compact · 20px pill.')}
          </div>
        </div>

        <div class="jcs-form-actions"><button class="adm-btn adm-btn-primary jcs-save" type="submit"><span>Save ${type} style</span><b>✓</b></button><span class="jcs-save-note">Applies to homepage, jobs, related cards and detail views.</span></div>
      </form>
      <aside class="jcs-preview-column">${previewCardHtml(type, s)}<form method="POST" action="/admin/card-styles/reset" class="jcs-reset-form"><input type="hidden" name="job_type" value="${type}"><button class="adm-btn-sm jcs-reset" type="submit" onclick="return confirm('Reset ${type} to the curated default style?')">Reset ${type} to default</button></form></aside>
    </div>
  </section>`;
}

const CARD_STYLES_CSS = `<style>
.jcs-page{--jcs-ink:#17132d;--jcs-muted:#77738a;--jcs-line:#e8e5f0;--jcs-soft:#f8f7fb;max-width:1320px;padding-bottom:58px}
.jcs-hero{position:relative;overflow:hidden;margin-bottom:20px;padding:26px 28px;border:1px solid #e7e2f5;border-radius:22px;background:radial-gradient(circle at 88% 8%,rgba(121,92,237,.20),transparent 34%),linear-gradient(135deg,#21184b 0%,#352472 58%,#4f3aa0 100%);color:#fff;box-shadow:0 16px 38px rgba(53,36,114,.16)}
.jcs-hero:after{content:'';position:absolute;right:-70px;bottom:-110px;width:280px;height:280px;border:1px solid rgba(255,255,255,.16);border-radius:50%;box-shadow:0 0 0 28px rgba(255,255,255,.035),0 0 0 56px rgba(255,255,255,.025)}
.jcs-hero-content{position:relative;z-index:1;max-width:760px}.jcs-kicker,.jcs-eyebrow{display:block;color:#aaa1e5;font-size:9px;font-weight:900;letter-spacing:1.6px;text-transform:uppercase}.jcs-hero h1{margin:8px 0 7px;color:#fff;font:800 clamp(25px,3vw,34px) var(--font-heading,sans-serif);letter-spacing:-.7px}.jcs-hero p{max-width:680px;margin:0;color:rgba(255,255,255,.74);font-size:12px;line-height:1.7}.jcs-hero-note{display:flex;flex-wrap:wrap;gap:8px;margin-top:17px}.jcs-hero-note span{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.84);font-size:10px;font-weight:750}.jcs-hero-note b{color:#c9c0ff;font-size:13px}
.jcs-tier-nav{display:flex;gap:8px;overflow:auto;margin:0 0 20px;padding:3px 1px 8px;scrollbar-width:thin}.jcs-tier-nav a{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;padding:10px 13px;border:1px solid var(--border);border-radius:11px;background:var(--surface);color:var(--ink2);font-size:11px;font-weight:800;text-decoration:none;transition:.18s ease}.jcs-tier-nav a:hover{border-color:var(--brand);color:var(--brand);transform:translateY(-1px);box-shadow:0 5px 14px rgba(48,31,121,.08)}.jcs-tier-nav i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--tier-color,var(--brand))}.jcs-tier-nav .nav-free{--tier-color:#94a3b8}.jcs-tier-nav .nav-featured{--tier-color:#2563eb}.jcs-tier-nav .nav-premium{--tier-color:#d4a12a}.jcs-tier-nav .nav-sponsored{--tier-color:#059669}
.jcs-tier{margin-bottom:18px;border:1px solid var(--jcs-line);border-radius:18px;background:var(--surface);box-shadow:0 8px 24px rgba(35,25,83,.045);scroll-margin-top:20px;overflow:hidden}.jcs-tier-head{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:18px 20px;border-bottom:1px solid var(--jcs-line);background:linear-gradient(180deg,#fff,rgba(248,247,251,.76))}.jcs-tier-identity{display:flex;align-items:center;gap:12px;min-width:0}.jcs-tier-icon{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:12px;background:var(--tier-bg,#f1f3f7);font-size:18px}.jcs-tier-free{--tier-bg:#f1f3f7;color:#667085}.jcs-tier-featured{--tier-bg:#eaf0ff;color:#2563eb}.jcs-tier-premium{--tier-bg:#fff4d8;color:#b27c10}.jcs-tier-sponsored{--tier-bg:#e2f8ed;color:#078653}.jcs-tier h2{margin:0;color:var(--jcs-ink);font:800 17px var(--font-heading,sans-serif)}.jcs-tier-head p{margin:3px 0 0;color:var(--jcs-muted);font-size:11px;line-height:1.45}.jcs-tier-chip{flex-shrink:0;padding:6px 9px;border:1px solid var(--jcs-line);border-radius:999px;color:var(--jcs-muted);font-size:9px;font-weight:800;white-space:nowrap}.jcs-tier-body{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(340px,.9fr);gap:0;align-items:start}.jcs-form{min-width:0;padding:20px;border-right:1px solid var(--jcs-line)}.jcs-form-topline{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px;padding:12px 13px;border:1px solid #ebe8f3;border-radius:12px;background:var(--jcs-soft)}.jcs-form-topline strong{display:block;margin-top:3px;color:var(--jcs-ink);font-size:12px}.jcs-form-topline .jcs-preset{width:170px;min-width:0;padding:9px 10px;font-size:11px}.jcs-control-section{padding:17px 0;border-top:1px solid var(--jcs-line)}.jcs-control-section:first-of-type{padding-top:0;border-top:0}.jcs-section-heading{display:flex;align-items:flex-start;gap:10px;margin-bottom:13px}.jcs-section-number{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:8px;background:var(--brand-soft);color:var(--brand);font-size:9px;font-weight:900}.jcs-section-heading h3{margin:1px 0 2px;color:var(--jcs-ink);font:800 13px var(--font-heading,sans-serif)}.jcs-section-heading p{margin:0;color:var(--jcs-muted);font-size:10px;line-height:1.45}.jcs-grid{display:grid;gap:11px}.jcs-grid-2{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:11px}.jcs-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.jcs-field{display:flex;flex-direction:column;gap:6px;min-width:0}.jcs-label{color:var(--ink3);font-size:9px;font-weight:850;letter-spacing:.55px;text-transform:uppercase}.jcs-field .adm-input{width:100%;min-height:38px;padding:8px 10px;font-size:11px}.jcs-help{display:block;min-height:13px;color:var(--jcs-muted);font-size:9px;line-height:1.35}.jcs-color-control{display:flex;align-items:center;gap:7px}.jcs-color-control input[type=color]{width:38px;height:38px;padding:3px;border:1px solid var(--jcs-line);border-radius:9px;background:#fff;cursor:pointer}.jcs-hex-input{flex:1;min-width:0!important;font-family:var(--font-mono,monospace)!important;letter-spacing:.2px}.jcs-number-wrap{position:relative;display:block}.jcs-number-wrap .adm-input{padding-right:29px}.jcs-unit{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--jcs-muted);font-size:10px;pointer-events:none}.jcs-angle-guide{display:flex;align-items:center;gap:10px;min-height:38px;padding:8px 11px;border:1px dashed var(--jcs-line);border-radius:10px;background:var(--jcs-soft);color:var(--jcs-muted)}.jcs-angle-guide span{display:block;width:25px;height:3px;border-radius:99px;background:linear-gradient(90deg,var(--brand),var(--cyan));transform-origin:left center}.jcs-angle-guide small{font-size:9px}.jcs-badge-section{padding-bottom:3px}.jcs-form-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:4px;padding-top:17px;border-top:1px solid var(--jcs-line)}.jcs-save{display:inline-flex;align-items:center;gap:9px;min-height:40px;padding:0 14px}.jcs-save b{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.2);font-size:11px}.jcs-save-note{color:var(--jcs-muted);font-size:9px;line-height:1.4}
.jcs-preview-column{min-width:0;padding:20px;background:linear-gradient(145deg,#fbfaff,#f7f8fc)}.jcs-preview-wrap{height:100%;padding:14px;border:1px solid #ebe8f3;border-radius:15px;background:rgba(255,255,255,.72)}.jcs-preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;color:var(--jcs-ink);font-size:11px;font-weight:850}.jcs-preview-status{padding:4px 8px;border-radius:999px;background:var(--brand-soft);color:var(--brand);font-size:9px;font-weight:800}.jcs-preview-stage{display:flex;align-items:center;min-height:224px;padding:14px;border:1px dashed #ded9ee;border-radius:12px;background:repeating-linear-gradient(135deg,#fff 0,#fff 10px,#fbfaff 10px,#fbfaff 20px)}.jcs-preview-stage .job-card{width:100%;box-shadow:inherit}.jcs-preview-stage .job-title-card{font-size:12px}.jcs-preview-stage .job-co-card{font-size:10px}.jcs-preview-stage .card-right{gap:7px}.jcs-preview-stage .salary-badge{font-size:9px;padding:4px 7px}.jcs-preview-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;color:var(--jcs-muted);font-size:9px}.jcs-preview-foot span{display:inline-flex;align-items:center;gap:5px}.jcs-dot{display:inline-block;width:7px;height:7px;border-radius:50%}.jcs-dot-border{background:#7664e8}.jcs-dot-badge{background:#d4a12a}.jcs-dot-logo{background:#059669}.jcs-reset-form{display:flex;justify-content:flex-end;margin-top:10px}.jcs-reset{font-size:10px;color:var(--jcs-muted)}
@media(max-width:980px){.jcs-tier-body{grid-template-columns:1fr}.jcs-form{border-right:0;border-bottom:1px solid var(--jcs-line)}.jcs-preview-column{padding-top:17px}.jcs-preview-stage{min-height:200px}}
@media(max-width:640px){.jcs-page{padding-bottom:30px}.jcs-hero{padding:21px 18px;border-radius:17px}.jcs-hero h1{font-size:25px}.jcs-hero p{font-size:11px}.jcs-hero-note{gap:6px}.jcs-hero-note span{font-size:9px;padding:6px 8px}.jcs-tier-head{align-items:flex-start;padding:15px}.jcs-tier-chip{font-size:8px;padding:5px 7px}.jcs-tier-head p{font-size:10px}.jcs-form{padding:15px}.jcs-preview-column{padding:15px}.jcs-form-topline{align-items:flex-start;flex-direction:column;gap:9px}.jcs-form-topline .jcs-preset{width:100%}.jcs-grid-3,.jcs-grid-2{grid-template-columns:1fr}.jcs-grid-2[data-gradient-controls]{margin-top:11px}.jcs-angle-guide{min-height:42px}.jcs-form-actions{align-items:stretch;flex-direction:column}.jcs-save{justify-content:center;width:100%}.jcs-save-note{text-align:center}.jcs-preview-stage{padding:9px}.jcs-preview-stage .card-inner{padding-left:11px!important;padding-right:11px!important}.jcs-preview-stage .co-logo{width:45px!important;height:45px!important}.jcs-preview-stage .card-secondary-meta{display:none}.jcs-preview-stage .card-right{justify-content:flex-end}.jcs-preview-foot{gap:7px;font-size:8px}}
</style>`;

export async function renderCardStylesContent(env) {
  const styles = await getCardStyles(env);
  const sections = CARD_STYLE_JOB_TYPES.map(type => tierSection(type, styles[type])).join('');
  const nav = CARD_STYLE_JOB_TYPES.map(type => `<a href="#jcs-${type.toLowerCase()}" class="nav-${type.toLowerCase()}"><i></i>${type}</a>`).join('');
  const presetsJson = JSON.stringify(STYLE_PRESETS);

  return `${CARD_STYLES_CSS}
  <div class="adm-wrap jcs-page">
    <header class="jcs-hero">
      <div class="jcs-hero-content">
        <span class="jcs-kicker">Design system · job presentation</span>
        <h1>Job Card Styles</h1>
        <p>Shape a consistent visual language for every job tier. Choose a curated direction, fine-tune the details and see the exact card treatment before saving it across the public site.</p>
        <div class="jcs-hero-note"><span><b>4</b> independent tiers</span><span><b>1</b> shared renderer</span><span><b>◉</b> live preview</span><span><b>◎</b> pinning stays separate</span></div>
      </div>
    </header>
    <nav class="jcs-tier-nav" aria-label="Job card tiers">${nav}</nav>
    <div class="adm-alert" style="margin-bottom:18px;border-color:#ddd7f4;background:#f8f6ff;color:#5b4a9f"><strong>Design note:</strong> Card type changes appearance only. Featured pinning and listing order remain controlled separately, so a visual upgrade never moves a job to the top automatically.</div>
    ${sections}
  </div>
  <script>
  (function(){
    var presets=${presetsJson};
    var tierIcons=${JSON.stringify({ star: jobTypeIconHtml('Featured', { icon_key: 'star' }, { size: 12, cls: 'jt-badge-icon' }), crown: jobTypeIconHtml('Premium', { icon_key: 'crown' }, { size: 12, cls: 'jt-badge-icon' }), rocket: jobTypeIconHtml('Sponsored', { icon_key: 'rocket' }, { size: 12, cls: 'jt-badge-icon' }), none: '' })};
    var shadows={none:'none',soft:'0 4px 18px rgba(18,22,43,.10)',strong:'0 8px 26px rgba(18,22,43,.18)'};
    var shadowLabels={none:'Flat',soft:'Soft lift',strong:'Strong lift'};
    function validColor(v){return /^#[0-9a-fA-F]{6}$/.test(v||'');}
    function init(root){
      var form=root.querySelector('[data-style-form]'), card=root.querySelector('[data-preview-card]');
      if(!form||!card)return;
      var inner=root.querySelector('[data-preview-inner]'), logo=root.querySelector('[data-preview-logo]'), badge=root.querySelector('[data-preview-badge]'), badgeIcon=root.querySelector('[data-preview-badge-icon]'), status=root.querySelector('[data-preview-status]');
      var angleGuide=root.querySelector('.jcs-angle-guide span'), gradientControls=root.querySelectorAll('[data-gradient-controls]'), preset=root.querySelector('[data-preset]');
      function field(name){return form.elements[name]||null;}
      function value(name){var el=field(name);return el?el.value:'';}
      function setValue(name,val){var el=field(name);if(el){el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}var twin=form.querySelector('[data-color-text="'+name+'"]');if(twin) twin.value=val;}
      function draw(){
        var mode=value('bg_type'), one=value('bg_color1'), two=value('bg_color2'), angle=Math.max(0,Math.min(360,parseInt(value('gradient_angle'),10)||135)), borderStyle=value('border_style'), borderColor=value('border_color'), width=Math.max(0,Math.min(6,parseInt(value('border_width'),10)||0)), shadow=value('shadow'), pad=Math.max(8,Math.min(28,parseInt(value('card_padding'),10)||14)), logoSize=Math.max(28,Math.min(96,parseInt(value('logo_size'),10)||54)), template=value('template'), accent=value('accent_position'), hover=value('hover_effect');
        if(!validColor(one))one='#FFFFFF';if(!validColor(two))two=one;if(!validColor(borderColor))borderColor='#E2E8F0';
        card.style.background=mode==='gradient'?'linear-gradient('+angle+'deg,'+one+','+two+')':one;
        card.style.border=borderStyle==='none'?'none':width+'px '+borderStyle+' '+borderColor;
        card.style.boxShadow=shadows[shadow]||'none';
        ['classic','highlight','spotlight','promoted'].forEach(function(v){card.classList.remove('jct-template-'+v);});['none','top','left','both'].forEach(function(v){card.classList.remove('jct-accent-'+v);});['none','lift','glow'].forEach(function(v){card.classList.remove('jct-hover-'+v);});
        card.classList.add('jct-template-'+(template||'classic'),'jct-accent-'+(accent||'none'),'jct-hover-'+(hover||'none'));
        ['accent_color','title_color','company_color','meta_color','salary_color'].forEach(function(name){var color=value(name);if(validColor(color))card.style.setProperty('--card-'+(name==='accent_color'?'accent':name.replace('_color',''))+'-color',color);});
        if(inner)inner.style.padding=pad+'px 16px';if(logo){logo.style.width=logoSize+'px';logo.style.height=logoSize+'px';}
        if(badge){var bb=value('badge_bg_color'),bt=value('badge_text_color'),bc=value('badge_border_color'),br=Math.max(4,Math.min(30,parseInt(value('badge_radius'),10)||20));if(validColor(bb))badge.style.background=bb;if(validColor(bt))badge.style.color=bt;if(validColor(bc))badge.style.borderColor=bc;badge.style.borderRadius=br+'px';if(badgeIcon)badgeIcon.innerHTML=tierIcons[value('icon_key')]||'';}
        if(status)status.textContent=(shadowLabels[shadow]||'Custom style')+' · '+(template||'classic');
        if(angleGuide)angleGuide.style.transform='rotate('+angle+'deg)';
        gradientControls.forEach(function(el){var active=mode==='gradient';el.style.opacity=active?'1':'.48';el.setAttribute('aria-disabled',active?'false':'true');el.querySelectorAll('input,select').forEach(function(input){input.disabled=false;});});
      }
      form.querySelectorAll('input,select').forEach(function(el){el.addEventListener('input',draw);el.addEventListener('change',draw);});
      form.querySelectorAll('[data-color-swatch]').forEach(function(swatch){var name=swatch.getAttribute('data-color-swatch'),twin=form.querySelector('[data-color-text="'+name+'"]');if(twin)swatch.addEventListener('input',function(){twin.value=swatch.value;draw();});});
      form.querySelectorAll('[data-color-text]').forEach(function(twin){var name=twin.getAttribute('data-color-text'),swatch=form.querySelector('[data-color-swatch="'+name+'"]');twin.addEventListener('input',function(){if(validColor(twin.value)&&swatch)swatch.value=twin.value;draw();});});
      if(preset)preset.addEventListener('change',function(){var selected=presets[preset.value];if(!selected)return;Object.keys(selected).forEach(function(name){if(name!=='label')setValue(name,selected[name]);});draw();});
      draw();
    }
    document.querySelectorAll('[data-tier]').forEach(init);
  })();
  </script>`;
}
