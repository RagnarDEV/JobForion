// src/pages/admin/settings.js
// General Settings: site identity, contact/social info, analytics, and
// maintenance mode — all persisted in D1 (site_settings table) via
// lib/settings.js. This is the first concrete proof of the "no settings
// stored in JS files" architecture: every field below can be changed here
// and takes effect across the whole public site within ~60s (the settings
// cache TTL), with zero code edits and zero redeploy.

import { escapeHtml } from '../../lib/entities.js';
import { getSettings, SETTINGS_DEFAULTS, THEME_DEFAULTS, COMPONENT_DEFAULTS, HOMEPAGE_COPY_DEFAULTS, HERO_FONT_OPTIONS } from '../../lib/settings.js';
import { salaryTierBadgeHtml } from '../../components/job-card.js';

function field(label, name, value, opts = {}) {
  const { type = 'text', placeholder = '', hint = '', full = false } = opts;
  return `<label style="display:block;${full ? 'grid-column:1 / -1;' : ''}">
    <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">${label}</span>
    <input class="adm-input" style="width:100%${type === 'color' ? ';height:40px;padding:3px' : ''}" type="${type}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
    ${hint ? `<span style="font-size:11px;color:var(--ink3);display:block;margin-top:4px">${hint}</span>` : ''}
  </label>`;
}

// Renders one Feature Flag checkbox row. Uses the SAME '1'/'0' string
// convention as maintenance_mode/ads_enabled — see lib/settings.js —
// and the SAME allow-list save path (SETTINGS_KEYS) in
// admin.router.js's /admin/settings/update handler, so a flag here is
// never a parallel system, just another entry in the existing one.
function featureFlag(name, label, value, hint) {
  const on = value !== '0';
  return `<label style="display:flex;align-items:flex-start;gap:9px;padding:8px 0;cursor:pointer">
    <input type="checkbox" name="${name}" value="1" ${on ? 'checked' : ''} style="width:17px;height:17px;margin-top:1px;flex-shrink:0">
    <span>
      <span style="font-size:12.5px;font-weight:700;color:var(--ink);display:block">${label}</span>
      ${hint ? `<span style="font-size:10.5px;color:var(--ink3)">${hint}</span>` : ''}
    </span>
  </label>`;
}

function enumField(label, name, value, options, hint = '') {
  return `<label style="display:block">
    <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">${label}</span>
    <select class="adm-input" style="width:100%" name="${name}">${options.map(option => `<option value="${escapeHtml(option.value)}" ${String(value) === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>
    ${hint ? `<span style="font-size:11px;color:var(--ink3);display:block;margin-top:4px">${hint}</span>` : ''}
  </label>`;
}

export async function renderSettingsContent(env) {
  const s = await getSettings(env);

  return `
  <div class="adm-wrap" style="max-width:820px">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">⚙️ Settings</div>
        <div class="adm-sub">Site-wide configuration — stored in Cloudflare D1, applied instantly across the site (no redeploy)</div>
      </div>
    </div>

    <form method="POST" action="/admin/settings/update" style="display:flex;flex-direction:column;gap:16px">

      <div class="adm-card">
        <div class="adm-card-title">General</div>
        <div class="adm-form-grid">
          ${field('Site Name', 'site_name', s.site_name, { placeholder: SETTINGS_DEFAULTS.site_name })}
          ${field('Tagline', 'site_tagline', s.site_tagline, { placeholder: SETTINGS_DEFAULTS.site_tagline })}
          ${field('Meta Description', 'site_description', s.site_description, { full: true, hint: 'Used as the homepage <meta description> and social share preview text.' })}
          ${field('Contact Email', 'contact_email', s.contact_email, { type: 'email' })}
        </div>
      </div>

      <div class="adm-card" id="settings-hero">
        <div class="adm-card-title">🎨 Hero &amp; Branding <span style="font-weight:400;color:var(--ink3);font-size:12px">— the homepage banner (title, search bar, font; colors use Appearance Theme)</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
          ${field('Title — line 1', 'hero_title_line1', s.hero_title_line1, { placeholder: SETTINGS_DEFAULTS.hero_title_line1 })}
          ${field('Title — line 2 (highlighted)', 'hero_title_line2', s.hero_title_line2, { placeholder: SETTINGS_DEFAULTS.hero_title_line2 })}
          ${field('Subtitle', 'hero_subtitle', s.hero_subtitle, { full: true })}
          ${field('Search placeholder', 'hero_search_placeholder', s.hero_search_placeholder, { placeholder: SETTINGS_DEFAULTS.hero_search_placeholder })}
          ${field('Search button text', 'hero_search_button_text', s.hero_search_button_text, { placeholder: SETTINGS_DEFAULTS.hero_search_button_text })}
        </div>
        <label style="display:block;max-width:280px">
          <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Heading Font</span>
          <select class="adm-input" style="width:100%" name="hero_heading_font">
            ${HERO_FONT_OPTIONS.map(f => `<option value="${escapeHtml(f.name)}" ${s.hero_heading_font === f.name ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
          </select>
          <span style="font-size:11px;color:var(--ink3);display:block;margin-top:4px">Applies to the homepage headline only.</span>
        </label>
        <div style="margin-top:16px;border-radius:12px;overflow:hidden;border:1px solid var(--border2)">
          <div id="heroPreviewBg" style="padding:26px 22px;background:linear-gradient(135deg,${escapeHtml(s.appearance_primary_color || THEME_DEFAULTS.appearance_primary_color)} 0%,${escapeHtml(s.appearance_secondary_color || THEME_DEFAULTS.appearance_secondary_color)} 100%)">
            <div id="heroPreviewTitle" style="font-family:'${escapeHtml(s.hero_heading_font)}',sans-serif;font-size:22px;font-weight:800;color:#fff;margin-bottom:6px">${escapeHtml(s.hero_title_line1)} ${escapeHtml(s.hero_title_line2)}</div>
            <div id="heroPreviewSubtitle" style="font-size:12px;line-height:1.55;color:rgba(255,255,255,.85);max-width:620px;margin-bottom:12px">${escapeHtml(s.hero_subtitle)}</div>
            <div id="heroPreviewSearch" style="display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:rgba(255,255,255,.8);margin-bottom:12px"><span style="padding:7px 10px;border-radius:7px;background:rgba(255,255,255,.14)">${escapeHtml(s.hero_search_placeholder)}</span><span id="heroPreviewBtn" style="display:inline-block;background:${escapeHtml(s.appearance_primary_color || THEME_DEFAULTS.appearance_primary_color)};color:#fff;padding:8px 18px;border-radius:9px;font-size:12px;font-weight:700">${escapeHtml(s.hero_search_button_text)}</span></div>
            <div style="font-size:11px;color:rgba(255,255,255,.72)">Live preview — updates as you edit Hero content and typography</div>
          </div>
        </div>
        <script>
        (function(){
          var script = document.currentScript;
          function boot(){
            var form = script && script.closest('form');
            if (!form) return;
            function val(name){ var el = form.querySelector('[name="'+name+'"]'); return el ? el.value : ''; }
            function update(){
              var bg = document.getElementById('heroPreviewBg');
              var title = document.getElementById('heroPreviewTitle');
              var subtitle = document.getElementById('heroPreviewSubtitle');
              var search = document.getElementById('heroPreviewSearch');
              var btn = document.getElementById('heroPreviewBtn');
              if (!bg || !title || !subtitle || !search || !btn) return;
              bg.style.background = 'linear-gradient(135deg,' + val('appearance_primary_color') + ' 0%,' + val('appearance_secondary_color') + ' 100%)';
              title.style.fontFamily = "'" + val('hero_heading_font') + "',sans-serif";
              title.textContent = val('hero_title_line1') + ' ' + val('hero_title_line2');
              subtitle.textContent = val('hero_subtitle');
              var placeholder = search.querySelector('span');
              if (placeholder) placeholder.textContent = val('hero_search_placeholder');
              btn.style.background = val('appearance_primary_color');
              btn.textContent = val('hero_search_button_text') || 'Search';
            }
            ['appearance_primary_color','appearance_secondary_color','hero_title_line1','hero_title_line2','hero_subtitle','hero_search_placeholder','hero_search_button_text','hero_heading_font'].forEach(function(name){
              var el = form.querySelector('[name="'+name+'"]');
              if (el) { el.addEventListener('input', update); el.addEventListener('change', update); }
            });
          }
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
        })();
        </script>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">🎨 Appearance Theme <span style="font-weight:400;color:var(--ink3);font-size:12px">— validated Design System tokens used across the public site</span></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:14px">
          ${field('Primary color', 'appearance_primary_color', s.appearance_primary_color || THEME_DEFAULTS.appearance_primary_color, { type: 'color' })}
          ${field('Secondary color', 'appearance_secondary_color', s.appearance_secondary_color || THEME_DEFAULTS.appearance_secondary_color, { type: 'color' })}
          ${field('Accent color', 'appearance_accent_color', s.appearance_accent_color || THEME_DEFAULTS.appearance_accent_color, { type: 'color' })}
          ${field('Page background', 'appearance_page_background', s.appearance_page_background || THEME_DEFAULTS.appearance_page_background, { type: 'color' })}
          ${field('Surface', 'appearance_surface', s.appearance_surface || THEME_DEFAULTS.appearance_surface, { type: 'color' })}
          ${field('Elevated surface', 'appearance_elevated_surface', s.appearance_elevated_surface || THEME_DEFAULTS.appearance_elevated_surface, { type: 'color' })}
          ${field('Primary text', 'appearance_text_primary', s.appearance_text_primary || THEME_DEFAULTS.appearance_text_primary, { type: 'color' })}
          ${field('Secondary text', 'appearance_text_secondary', s.appearance_text_secondary || THEME_DEFAULTS.appearance_text_secondary, { type: 'color' })}
          ${field('Muted text', 'appearance_text_muted', s.appearance_text_muted || THEME_DEFAULTS.appearance_text_muted, { type: 'color' })}
          ${field('Border color', 'appearance_border_color', s.appearance_border_color || THEME_DEFAULTS.appearance_border_color, { type: 'color' })}
          ${field('Base radius (px)', 'appearance_radius', s.appearance_radius || THEME_DEFAULTS.appearance_radius, { type: 'number', hint: 'Safe range: 6–24px.' })}
          ${field('Container width (px)', 'appearance_container_width', s.appearance_container_width || THEME_DEFAULTS.appearance_container_width, { type: 'number', hint: 'Safe range: 960–1440px.' })}
          ${field('Section spacing (px)', 'appearance_section_spacing', s.appearance_section_spacing || THEME_DEFAULTS.appearance_section_spacing, { type: 'number', hint: 'Safe range: 20–96px.' })}
          ${field('Card gap (px)', 'appearance_card_gap', s.appearance_card_gap || THEME_DEFAULTS.appearance_card_gap, { type: 'number', hint: 'Safe range: 6–32px.' })}
          <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Density</span><select class="adm-input" style="width:100%" name="appearance_density"><option value="compact" ${s.appearance_density === 'compact' ? 'selected' : ''}>Compact</option><option value="comfortable" ${!s.appearance_density || s.appearance_density === 'comfortable' ? 'selected' : ''}>Comfortable</option><option value="spacious" ${s.appearance_density === 'spacious' ? 'selected' : ''}>Spacious</option></select></label>
          <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Body font</span><select class="adm-input" style="width:100%" name="appearance_font_family">${['Manrope','Inter','Plus Jakarta Sans','Poppins'].map(font => `<option value="${font}" ${s.appearance_font_family === font ? 'selected' : ''}>${font}</option>`).join('')}</select></label>
          <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Heading font</span><select class="adm-input" style="width:100%" name="appearance_heading_font">${['Space Grotesk','Plus Jakarta Sans','Poppins','Sora','Outfit'].map(font => `<option value="${font}" ${s.appearance_heading_font === font ? 'selected' : ''}>${font}</option>`).join('')}</select></label>
        </div>
        <div id="themePreview" style="border:1px solid var(--border2);border-radius:12px;padding:16px;background:${escapeHtml(s.appearance_page_background || THEME_DEFAULTS.appearance_page_background)};color:${escapeHtml(s.appearance_text_primary || THEME_DEFAULTS.appearance_text_primary)}">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.7;margin-bottom:6px">Live Design System preview</div>
          <div id="themePreviewCard" style="border-radius:${escapeHtml(s.appearance_radius || THEME_DEFAULTS.appearance_radius)}px;padding:16px;background:${escapeHtml(s.appearance_surface || THEME_DEFAULTS.appearance_surface)};border:1px solid ${escapeHtml(s.appearance_border_color || THEME_DEFAULTS.appearance_border_color)};box-shadow:0 8px 24px rgba(37,24,92,.08)">
            <strong id="themePreviewTitle" style="font-family:'${escapeHtml(s.appearance_heading_font || THEME_DEFAULTS.appearance_heading_font)}',sans-serif">JobForion Design System</strong>
            <p id="themePreviewText" style="margin-top:6px;color:${escapeHtml(s.appearance_text_secondary || THEME_DEFAULTS.appearance_text_secondary)};font-size:12px">Preview uses the same validated tokens as the public renderer.</p>
            <span id="themePreviewButton" style="display:inline-block;margin-top:10px;padding:8px 12px;border-radius:${escapeHtml(s.appearance_radius || THEME_DEFAULTS.appearance_radius)}px;background:${escapeHtml(s.appearance_primary_color || THEME_DEFAULTS.appearance_primary_color)};color:#fff;font-size:11px;font-weight:800">Primary action</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="adm-btn" type="submit" name="settings_scope" value="appearance">Save with settings</button><button class="adm-btn" type="submit" formaction="/admin/settings/reset-appearance" formmethod="POST" onclick="return confirm('Reset only Appearance theme values to defaults?')">Reset Appearance Defaults</button></div>
        <script>
        (function(){var form=document.currentScript.closest('form');if(!form)return;function get(n){var e=form.querySelector('[name="'+n+'"]');return e?e.value:''}function draw(){var root=document.getElementById('themePreview'),card=document.getElementById('themePreviewCard'),title=document.getElementById('themePreviewTitle'),text=document.getElementById('themePreviewText'),button=document.getElementById('themePreviewButton');root.style.background=get('appearance_page_background');root.style.color=get('appearance_text_primary');card.style.background=get('appearance_surface');card.style.borderColor=get('appearance_border_color');card.style.borderRadius=get('appearance_radius')+'px';title.style.fontFamily="'"+get('appearance_heading_font')+"',sans-serif";text.style.color=get('appearance_text_secondary');button.style.background=get('appearance_primary_color');button.style.borderRadius=get('appearance_radius')+'px'}['appearance_primary_color','appearance_page_background','appearance_surface','appearance_border_color','appearance_radius','appearance_heading_font','appearance_text_primary','appearance_text_secondary'].forEach(function(n){var e=form.querySelector('[name="'+n+'"]');if(e)e.addEventListener('input',draw)});})();
        </script>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">Company Card <span style="font-weight:400;color:var(--ink3);font-size:12px">— structured controls for the authoritative company component</span></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px">
          ${field('Radius (px)', 'company_card_radius', s.company_card_radius || COMPONENT_DEFAULTS.company_card_radius, { type: 'number', hint: 'Safe range: 8–24px.' })}
          ${field('Padding (px)', 'company_card_padding', s.company_card_padding || COMPONENT_DEFAULTS.company_card_padding, { type: 'number', hint: 'Safe range: 10–28px.' })}
          ${field('Logo size (px)', 'company_card_logo_size', s.company_card_logo_size || COMPONENT_DEFAULTS.company_card_logo_size, { type: 'number', hint: 'Safe range: 36–76px.' })}
          ${field('Grid gap (px)', 'company_card_gap', s.company_card_gap || COMPONENT_DEFAULTS.company_card_gap, { type: 'number', hint: 'Safe range: 6–28px.' })}
          <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Shadow</span><select class="adm-input" style="width:100%" name="company_card_shadow"><option value="none" ${s.company_card_shadow === 'none' ? 'selected' : ''}>None</option><option value="soft" ${!s.company_card_shadow || s.company_card_shadow === 'soft' ? 'selected' : ''}>Soft</option><option value="strong" ${s.company_card_shadow === 'strong' ? 'selected' : ''}>Strong</option></select></label>
          <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Hover</span><select class="adm-input" style="width:100%" name="company_card_hover"><option value="lift" ${!s.company_card_hover || s.company_card_hover === 'lift' ? 'selected' : ''}>Lift</option><option value="none" ${s.company_card_hover === 'none' ? 'selected' : ''}>None</option></select></label>
        </div>
        <div id="companyCardPreview" style="display:flex;align-items:center;gap:12px;max-width:440px;padding:${escapeHtml(s.company_card_padding || COMPONENT_DEFAULTS.company_card_padding)}px;border:1px solid ${escapeHtml(s.appearance_border_color || THEME_DEFAULTS.appearance_border_color)};border-radius:${escapeHtml(s.company_card_radius || COMPONENT_DEFAULTS.company_card_radius)}px;background:${escapeHtml(s.appearance_surface || THEME_DEFAULTS.appearance_surface)};box-shadow:var(--company-card-shadow,0 8px 24px rgba(48,31,121,.10))"><span id="companyCardPreviewLogo" style="width:${escapeHtml(s.company_card_logo_size || COMPONENT_DEFAULTS.company_card_logo_size)}px;height:${escapeHtml(s.company_card_logo_size || COMPONENT_DEFAULTS.company_card_logo_size)}px;border-radius:10px;background:${escapeHtml(s.appearance_elevated_surface || THEME_DEFAULTS.appearance_elevated_surface)};display:inline-flex;align-items:center;justify-content:center;color:${escapeHtml(s.appearance_primary_color || THEME_DEFAULTS.appearance_primary_color)};font-weight:900">J</span><span><strong style="display:block;color:${escapeHtml(s.appearance_text_primary || THEME_DEFAULTS.appearance_text_primary)};font-family:'${escapeHtml(s.appearance_heading_font || THEME_DEFAULTS.appearance_heading_font)}'">Company Card preview</strong><small style="color:${escapeHtml(s.appearance_text_secondary || THEME_DEFAULTS.appearance_text_secondary)}">12 open jobs · Verified</small></span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="adm-btn" type="submit" name="settings_scope" value="company_card">Save Company Card</button><button class="adm-btn" type="submit" formaction="/admin/settings/reset-components" formmethod="POST" onclick="return confirm('Reset Company Card and Navigation controls only?')">Reset Component Controls</button></div>
        <script>
        (function(){var form=document.currentScript.closest('form'),card=document.getElementById('companyCardPreview'),logo=document.getElementById('companyCardPreviewLogo');if(!form||!card||!logo)return;function v(n){var e=form.querySelector('[name="'+n+'"]');return e?e.value:''}function draw(){card.style.padding=v('company_card_padding')+'px';card.style.borderRadius=v('company_card_radius')+'px';logo.style.width=v('company_card_logo_size')+'px';logo.style.height=v('company_card_logo_size')+'px'}['company_card_padding','company_card_radius','company_card_logo_size'].forEach(function(n){var e=form.querySelector('[name="'+n+'"]');if(e)e.addEventListener('input',draw)});})();
        </script>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">Navigation <span style="font-weight:400;color:var(--ink3);font-size:12px">— safe header and CTA controls for desktop and mobile</span></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
          ${field('Logo size (px)', 'nav_logo_size', s.nav_logo_size || COMPONENT_DEFAULTS.nav_logo_size, { type: 'number', hint: 'Safe range: 24–44px.' })}
          ${field('Header height (px)', 'nav_header_height', s.nav_header_height || COMPONENT_DEFAULTS.nav_header_height, { type: 'number', hint: 'Safe range: 56–88px.' })}
          ${field('Navigation gap (px)', 'nav_gap', s.nav_gap || COMPONENT_DEFAULTS.nav_gap, { type: 'number', hint: 'Safe range: 8–48px.' })}
          ${field('CTA label', 'nav_cta_text', s.nav_cta_text || COMPONENT_DEFAULTS.nav_cta_text, { placeholder: COMPONENT_DEFAULTS.nav_cta_text, hint: 'Text only; max 40 characters.' })}
        </div>
        ${featureFlag('nav_cta_enabled', 'Show navigation CTA', s.nav_cta_enabled, 'Controls the Post a job CTA in desktop and mobile navigation.')}
      </div>

      <div class="adm-card" id="settings-homepage-copy">
        <div class="adm-card-title">Homepage Copy <span style="font-weight:400;color:var(--ink3);font-size:12px">— structured text only; section order and visibility remain in Homepage Builder</span></div>
        <div class="adm-form-grid">
          ${field('Featured companies title', 'homepage_featured_title', s.homepage_featured_title || HOMEPAGE_COPY_DEFAULTS.homepage_featured_title, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_featured_title })}
          ${field('Categories title', 'homepage_categories_title', s.homepage_categories_title || HOMEPAGE_COPY_DEFAULTS.homepage_categories_title, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_categories_title })}
          ${field('Jobs eyebrow', 'homepage_jobs_eyebrow', s.homepage_jobs_eyebrow || HOMEPAGE_COPY_DEFAULTS.homepage_jobs_eyebrow, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_jobs_eyebrow })}
          ${field('Jobs section title', 'homepage_jobs_title', s.homepage_jobs_title || HOMEPAGE_COPY_DEFAULTS.homepage_jobs_title, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_jobs_title })}
          ${field('Jobs CTA label', 'homepage_jobs_cta', s.homepage_jobs_cta || HOMEPAGE_COPY_DEFAULTS.homepage_jobs_cta, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_jobs_cta })}
          ${field('Alerts title', 'homepage_alerts_title', s.homepage_alerts_title || HOMEPAGE_COPY_DEFAULTS.homepage_alerts_title, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_alerts_title })}
          ${field('Alerts description', 'homepage_alerts_text', s.homepage_alerts_text || HOMEPAGE_COPY_DEFAULTS.homepage_alerts_text, { full: true })}
          ${field('Alerts CTA label', 'homepage_alerts_cta', s.homepage_alerts_cta || HOMEPAGE_COPY_DEFAULTS.homepage_alerts_cta, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_alerts_cta })}
          ${field('Career title', 'homepage_career_title', s.homepage_career_title || HOMEPAGE_COPY_DEFAULTS.homepage_career_title, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_career_title })}
          ${field('Career description', 'homepage_career_text', s.homepage_career_text || HOMEPAGE_COPY_DEFAULTS.homepage_career_text, { full: true })}
          ${field('Career CTA label', 'homepage_career_cta', s.homepage_career_cta || HOMEPAGE_COPY_DEFAULTS.homepage_career_cta, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_career_cta })}
          ${field('Resources title', 'homepage_resources_title', s.homepage_resources_title || HOMEPAGE_COPY_DEFAULTS.homepage_resources_title, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_resources_title })}
          ${field('Blog section title', 'homepage_blog_title', s.homepage_blog_title || HOMEPAGE_COPY_DEFAULTS.homepage_blog_title, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_blog_title })}
          ${field('Blog CTA label', 'homepage_blog_cta', s.homepage_blog_cta || HOMEPAGE_COPY_DEFAULTS.homepage_blog_cta, { placeholder: HOMEPAGE_COPY_DEFAULTS.homepage_blog_cta })}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="adm-btn" type="submit" name="settings_scope" value="homepage_copy">Save Homepage Copy</button><button class="adm-btn" type="submit" formaction="/admin/settings/reset-homepage-copy" formmethod="POST" onclick="return confirm('Reset Homepage Copy only?')">Reset Homepage Copy</button></div>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">Social Links <span style="font-weight:400;color:var(--ink3);font-size:12px">— placeholder buttons are always shown; entered URLs become live links</span></div>
        <div class="adm-form-grid">
          ${field('Twitter / X URL', 'social_twitter', s.social_twitter, { type: 'url', placeholder: 'https://x.com/yourhandle' })}
          ${field('LinkedIn URL', 'social_linkedin', s.social_linkedin, { type: 'url', placeholder: 'https://linkedin.com/company/...' })}
          ${field('Facebook URL', 'social_facebook', s.social_facebook, { type: 'url', placeholder: 'https://facebook.com/...' })}
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">SEO &amp; Indexing <span style="font-weight:400;color:var(--ink3);font-size:12px">— controls page-level search indexing without changing routes</span></div>
        ${featureFlag('seo_indexing_enabled', 'Allow public pages to be indexed', s.seo_indexing_enabled, 'When disabled, public HTML pages emit noindex, nofollow. Sitemap routes remain available for operational inspection.')}
      </div>

      <div class="adm-card">
        <div class="adm-card-title">Analytics</div>
        ${field('Google Analytics Measurement ID', 'ga_measurement_id', s.ga_measurement_id, { placeholder: 'G-XXXXXXXXXX', hint: 'Applied to every public page. The admin panel itself is never tracked.' })}
      </div>

      <div class="adm-card">
        <div class="adm-card-title">Job Sync — Warm-up Governor <span style="font-weight:400;color:var(--ink3);font-size:12px">— prevents a mass job dump on first sync</span></div>
        <div style="font-size:12px;color:var(--ink2);line-height:1.7;margin-bottom:14px">While the site's total job count is below the threshold, every source is capped at a small number of new jobs per run instead of its full board — the cap lifts automatically once the threshold is crossed.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
          ${field('Warm-up Threshold (total jobs)', 'sync_warmup_threshold', s.sync_warmup_threshold, { type: 'number', placeholder: SETTINGS_DEFAULTS.sync_warmup_threshold, hint: 'Below this many jobs site-wide, warm-up mode stays active.' })}
          ${field('Warm-up Cap (per source/run)', 'sync_warmup_cap_per_provider', s.sync_warmup_cap_per_provider, { type: 'number', placeholder: SETTINGS_DEFAULTS.sync_warmup_cap_per_provider, hint: 'Max NEW jobs saved per source while in warm-up.' })}
          ${field('Hard Cap (per source/run, always on)', 'sync_hard_cap_per_provider', s.sync_hard_cap_per_provider, { type: 'number', placeholder: SETTINGS_DEFAULTS.sync_hard_cap_per_provider, hint: 'Permanent ceiling, even after warm-up ends.' })}
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">🔥 HOT PAY <span style="font-weight:400;color:var(--ink3);font-size:12px">— high-salary job indicator</span></div>
        <div style="font-size:12px;color:var(--ink2);line-height:1.7;margin-bottom:14px">Jobs are classified from normalized annual USD salary data. A salary range uses its midpoint; a minimum-only value uses the minimum and a maximum-only value uses the maximum. Missing or unparseable salaries are never marked HOT PAY.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
          ${featureFlag('hot_pay_enabled', 'Enable HOT PAY badges', s.hot_pay_enabled, 'Shows the shared HOT PAY indicator on qualifying jobs.')}
          ${field('Annual threshold (USD)', 'hot_pay_threshold_usd', s.hot_pay_threshold_usd, { type: 'number', placeholder: SETTINGS_DEFAULTS.hot_pay_threshold_usd, hint: 'Compared against the normalized annual salary value for each job.' })}
        </div>
      </div>

      <div class="adm-card" id="settings-salary-tier">
        <div class="adm-card-title">Salary Tier Classification <span style="font-weight:400;color:var(--ink3);font-size:12px">— persisted annual USD classification; UNKNOWN is never treated as STANDARD</span></div>
        <div style="font-size:12px;color:var(--ink2);line-height:1.7;margin-bottom:14px">The central classifier uses normalized annual USD values. Ranges use their midpoint, while missing, unsupported, or invalid salary data remains UNKNOWN. These controls change thresholds and presentation only; HOT PAY remains an independent indicator.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
          ${featureFlag('salary_tier_badges_enabled', 'Show salary tier badges', s.salary_tier_badges_enabled, 'Applies to public job cards and job detail chips. UNKNOWN is intentionally not shown as a badge.')}
          <div></div>
          ${field('HIGH minimum (annual USD)', 'salary_tier_high_min_usd', s.salary_tier_high_min_usd, { type: 'number', placeholder: SETTINGS_DEFAULTS.salary_tier_high_min_usd, hint: 'Safe range: $1,000–$10,000,000.' })}
          ${field('GOOD minimum (annual USD)', 'salary_tier_good_min_usd', s.salary_tier_good_min_usd, { type: 'number', placeholder: SETTINGS_DEFAULTS.salary_tier_good_min_usd, hint: 'Values below GOOD are STANDARD.' })}
          ${field('HIGH label', 'salary_tier_high_label', s.salary_tier_high_label, { placeholder: SETTINGS_DEFAULTS.salary_tier_high_label })}
          ${field('GOOD label', 'salary_tier_good_label', s.salary_tier_good_label, { placeholder: SETTINGS_DEFAULTS.salary_tier_good_label })}
          ${field('STANDARD label', 'salary_tier_standard_label', s.salary_tier_standard_label, { placeholder: SETTINGS_DEFAULTS.salary_tier_standard_label })}
          <div></div>
          ${enumField('HIGH color token', 'salary_tier_high_token', s.salary_tier_high_token, [{ value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }, { value: 'slate', label: 'Slate' }])}
          ${enumField('GOOD color token', 'salary_tier_good_token', s.salary_tier_good_token, [{ value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }, { value: 'slate', label: 'Slate' }])}
          ${enumField('STANDARD color token', 'salary_tier_standard_token', s.salary_tier_standard_token, [{ value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }, { value: 'slate', label: 'Slate' }])}
        </div>
        <div style="margin-top:16px;padding:14px;border:1px solid var(--border2);border-radius:10px;background:var(--surface2)">
          <div style="font-size:10px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--ink3);margin-bottom:9px">Live badge preview</div>
          <div id="salaryTierPreview" style="display:${s.salary_tier_badges_enabled === '0' ? 'none' : 'flex'};gap:7px;flex-wrap:wrap;align-items:center">
            ${salaryTierBadgeHtml('HIGH', s)}${salaryTierBadgeHtml('GOOD', s)}${salaryTierBadgeHtml('STANDARD', s)}
          </div>
          <div id="salaryTierPreviewDisabled" style="display:${s.salary_tier_badges_enabled === '0' ? 'block' : 'none'};font-size:11px;color:var(--ink3)">Badges are disabled in the public interface.</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="adm-btn" type="submit" name="settings_scope" value="salary_tier">Save Salary Tier Settings</button></div>
        <script>
        (function(){var form=document.currentScript.closest('form'),preview=document.getElementById('salaryTierPreview'),disabled=document.getElementById('salaryTierPreviewDisabled');if(!form||!preview||!disabled)return;function v(n){var e=form.querySelector('[name="'+n+'"]');return e?e.value:''}function draw(){var on=form.querySelector('[name="salary_tier_badges_enabled"]');var enabled=!!on&&on.checked;preview.style.display=enabled?'flex':'none';disabled.style.display=enabled?'none':'block';var labels=[v('salary_tier_high_label'),v('salary_tier_good_label'),v('salary_tier_standard_label')];preview.querySelectorAll('.salary-tier-badge').forEach(function(el,i){if(labels[i])el.textContent=labels[i]});}['salary_tier_badges_enabled','salary_tier_high_label','salary_tier_good_label','salary_tier_standard_label','salary_tier_high_token','salary_tier_good_token','salary_tier_standard_token'].forEach(function(n){var e=form.querySelector('[name="'+n+'"]');if(e){e.addEventListener('input',draw);e.addEventListener('change',draw)}});draw();})();
        </script>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">AI Foundation <span style="font-weight:400;color:var(--ink3);font-size:12px">— server-side enhancement layer</span></div>
        <div style="font-size:12px;color:var(--ink2);line-height:1.7;margin-bottom:8px">Workers AI is available only to authorized backend operations. Public pages never call AI, and disabling this switch fails AI requests safely without affecting JobForion.</div>
        ${featureFlag('ai_enabled', 'Enable the AI foundation', s.ai_enabled, 'Global kill switch for all protected AI operations.')}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin-top:6px">
          ${featureFlag('ai_foundation_smoke_enabled', 'Foundation smoke test', s.ai_foundation_smoke_enabled, 'Protected admin connectivity check.')}
          ${featureFlag('ai_job_intelligence_enabled', 'Job intelligence', s.ai_job_intelligence_enabled, 'Protected job analysis and enrichment.')}
          ${featureFlag('ai_matching_enabled', 'User matching', s.ai_matching_enabled, 'Private profile-to-job matching.')}
          ${featureFlag('ai_career_assistant_enabled', 'Career assistant', s.ai_career_assistant_enabled, 'Authenticated career guidance.')}
          ${featureFlag('ai_content_intelligence_enabled', 'Content intelligence', s.ai_content_intelligence_enabled, 'Admin editorial review only.')}
          ${featureFlag('ai_admin_assistant_enabled', 'Admin assistant', s.ai_admin_assistant_enabled, 'Protected admin operational assistant.')}
        </div>
      </div>

      <div class="adm-card" style="border-color:${s.maintenance_mode === '1' ? 'rgba(255,92,122,.4)' : 'var(--border)'}">
        <div class="adm-card-title">Maintenance Mode</div>
        <label style="display:flex;align-items:center;gap:10px;margin-bottom:14px;cursor:pointer">
          <input type="checkbox" name="maintenance_mode" value="1" ${s.maintenance_mode === '1' ? 'checked' : ''} style="width:18px;height:18px">
          <span style="font-size:13px;font-weight:700;color:var(--ink)">Enable maintenance mode</span>
          ${s.maintenance_mode === '1' ? '<span style="font-size:11px;font-weight:800;color:var(--coral);background:rgba(255,92,122,.12);padding:3px 9px;border-radius:20px">● CURRENTLY LIVE</span>' : ''}
        </label>
        <label style="display:block">
          <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Message shown to visitors</span>
          <textarea class="adm-input" name="maintenance_message" style="width:100%;min-height:80px;font-family:inherit">${escapeHtml(s.maintenance_message)}</textarea>
        </label>
        <div style="font-size:11px;color:var(--ink3);margin-top:8px">While enabled, every public page returns HTTP 503 with this message. The admin panel (this page included) always stays reachable so you can turn it back off.</div>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">Feature Flags <span style="font-weight:400;color:var(--ink3);font-size:12px">— turn whole sections of the site on/off without a redeploy</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 20px">
          ${featureFlag('feature_blog', 'Blog', s.feature_blog, 'Enforced now — /blog 404s site-wide when off.')}
          ${featureFlag('feature_job_alerts', 'Job Alerts', s.feature_job_alerts, 'Enforced now — the subscribe form returns a disabled message when off.')}
          ${featureFlag('feature_company_pages', 'Company Pages', s.feature_company_pages, 'Enforced — /companies 404s site-wide when off.')}
          ${featureFlag('feature_country_pages', 'Country Pages', s.feature_country_pages, 'Enforced — /countries 404s site-wide when off.')}
          ${featureFlag('feature_skill_pages', 'Skill Pages', s.feature_skill_pages, 'Enforced — /skills 404s site-wide when off.')}
          ${featureFlag('feature_featured_jobs', 'Featured Jobs Badges', s.feature_featured_jobs, 'Enforced — pin/unpin blocked, "Pinned" badge hidden everywhere.')}
        </div>
      </div>

      <div style="display:flex;gap:10px">
        <button class="adm-btn adm-btn-primary" type="submit">Save Settings</button>
        <a href="/" target="_blank" class="adm-btn">View Live Site</a>
      </div>
    </form>
  </div>`;
}
