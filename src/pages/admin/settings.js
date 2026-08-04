// src/pages/admin/settings.js
// General Settings: site identity, contact/social info, analytics, and
// maintenance mode — all persisted in D1 (site_settings table) via
// lib/settings.js. This is the first concrete proof of the "no settings
// stored in JS files" architecture: every field below can be changed here
// and takes effect across the whole public site within ~60s (the settings
// cache TTL), with zero code edits and zero redeploy.

import { escapeHtml } from '../../lib/entities.js';
import { getSettings, SETTINGS_DEFAULTS } from '../../lib/settings.js';

function field(label, name, value, opts = {}) {
  const { type = 'text', placeholder = '', hint = '', full = false } = opts;
  return `<label style="display:block;${full ? 'grid-column:1 / -1;' : ''}">
    <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">${label}</span>
    <input class="adm-input" style="width:100%" type="${type}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
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
