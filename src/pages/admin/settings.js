// src/pages/admin/settings.js
// General Settings: site identity, contact/social info, analytics, and
// maintenance mode — all persisted in D1 (site_settings table) via
// lib/settings.js. This is the first concrete proof of the "no settings
// stored in JS files" architecture: every field below can be changed here
// and takes effect across the whole public site within ~60s (the settings
// cache TTL), with zero code edits and zero redeploy.

import { escapeHtml } from '../../lib/entities.js';
import { getSettings, SETTINGS_DEFAULTS, HERO_FONT_OPTIONS } from '../../lib/settings.js';

function field(label, name, value, opts = {}) {
  const { type = 'text', placeholder = '', hint = '', full = false } = opts;
  return `<label style="display:block;${full ? 'grid-column:1 / -1;' : ''}">
    <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">${label}</span>
    <input class="adm-input" style="width:100%${type === 'color' ? ';height:40px;padding:3px' : ''}" type="${type}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          ${field('Site Name', 'site_name', s.site_name, { placeholder: SETTINGS_DEFAULTS.site_name })}
          ${field('Tagline', 'site_tagline', s.site_tagline, { placeholder: SETTINGS_DEFAULTS.site_tagline })}
          ${field('Meta Description', 'site_description', s.site_description, { full: true, hint: 'Used as the homepage <meta description> and social share preview text.' })}
          ${field('Contact Email', 'contact_email', s.contact_email, { type: 'email' })}
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">🎨 Hero &amp; Branding <span style="font-weight:400;color:var(--ink3);font-size:12px">— the homepage banner (title, gradient, search bar, font)</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
          ${field('Title — line 1', 'hero_title_line1', s.hero_title_line1, { placeholder: SETTINGS_DEFAULTS.hero_title_line1 })}
          ${field('Title — line 2 (highlighted)', 'hero_title_line2', s.hero_title_line2, { placeholder: SETTINGS_DEFAULTS.hero_title_line2 })}
          ${field('Subtitle', 'hero_subtitle', s.hero_subtitle, { full: true })}
          ${field('Search placeholder', 'hero_search_placeholder', s.hero_search_placeholder, { placeholder: SETTINGS_DEFAULTS.hero_search_placeholder })}
          ${field('Search button text', 'hero_search_button_text', s.hero_search_button_text, { placeholder: SETTINGS_DEFAULTS.hero_search_button_text })}
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px">
          ${field('Gradient start', 'hero_gradient_start', s.hero_gradient_start, { type: 'color' })}
          ${field('Gradient middle', 'hero_gradient_mid', s.hero_gradient_mid, { type: 'color' })}
          ${field('Gradient end', 'hero_gradient_end', s.hero_gradient_end, { type: 'color' })}
          ${field('Search button color', 'hero_search_button_color', s.hero_search_button_color, { type: 'color' })}
        </div>
        <label style="display:block;max-width:280px">
          <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Heading Font</span>
          <select class="adm-input" style="width:100%" name="hero_heading_font">
            ${HERO_FONT_OPTIONS.map(f => `<option value="${escapeHtml(f.name)}" ${s.hero_heading_font === f.name ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
          </select>
          <span style="font-size:11px;color:var(--ink3);display:block;margin-top:4px">Applies to the homepage headline only.</span>
        </label>
        <div style="margin-top:16px;border-radius:12px;overflow:hidden;border:1px solid var(--border2)">
          <div id="heroPreviewBg" style="padding:26px 22px;background:linear-gradient(135deg,${escapeHtml(s.hero_gradient_start)} 0%,${escapeHtml(s.hero_gradient_mid)} 55%,${escapeHtml(s.hero_gradient_end)} 100%)">
            <div id="heroPreviewTitle" style="font-family:'${escapeHtml(s.hero_heading_font)}',sans-serif;font-size:22px;font-weight:800;color:#fff;margin-bottom:6px">${escapeHtml(s.hero_title_line1)} ${escapeHtml(s.hero_title_line2)}</div>
            <div style="font-size:12px;color:rgba(255,255,255,.85);margin-bottom:14px">Live preview — updates as you type/pick colors below</div>
            <span id="heroPreviewBtn" style="display:inline-block;background:${escapeHtml(s.hero_search_button_color)};color:#fff;padding:8px 18px;border-radius:9px;font-size:12px;font-weight:700">${escapeHtml(s.hero_search_button_text)}</span>
          </div>
        </div>
        <script>
        (function(){
          var form = document.currentScript.closest('form');
          if (!form) return;
          function val(name){ var el = form.querySelector('[name="'+name+'"]'); return el ? el.value : ''; }
          function update(){
            var bg = document.getElementById('heroPreviewBg');
            var title = document.getElementById('heroPreviewTitle');
            var btn = document.getElementById('heroPreviewBtn');
            bg.style.background = 'linear-gradient(135deg,' + val('hero_gradient_start') + ' 0%,' + val('hero_gradient_mid') + ' 55%,' + val('hero_gradient_end') + ' 100%)';
            title.style.fontFamily = "'" + val('hero_heading_font') + "',sans-serif";
            title.textContent = val('hero_title_line1') + ' ' + val('hero_title_line2');
            btn.style.background = val('hero_search_button_color');
            btn.textContent = val('hero_search_button_text') || 'Search';
          }
          ['hero_gradient_start','hero_gradient_mid','hero_gradient_end','hero_search_button_color','hero_title_line1','hero_title_line2','hero_search_button_text','hero_heading_font'].forEach(function(name){
            var el = form.querySelector('[name="'+name+'"]');
            if (el) el.addEventListener('input', update);
          });
        })();
        </script>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">Social Links <span style="font-weight:400;color:var(--ink3);font-size:12px">— shown in the site footer once filled in</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          ${field('Twitter / X URL', 'social_twitter', s.social_twitter, { type: 'url', placeholder: 'https://x.com/yourhandle' })}
          ${field('LinkedIn URL', 'social_linkedin', s.social_linkedin, { type: 'url', placeholder: 'https://linkedin.com/company/...' })}
          ${field('Facebook URL', 'social_facebook', s.social_facebook, { type: 'url', placeholder: 'https://facebook.com/...' })}
        </div>
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

      <div style="display:flex;gap:10px">
        <button class="adm-btn adm-btn-primary" type="submit">Save Settings</button>
        <a href="/" target="_blank" class="adm-btn">View Live Site</a>
      </div>
    </form>
  </div>`;
}
