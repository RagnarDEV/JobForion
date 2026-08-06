// src/pages/admin/ads.js
// Ad Slot Manager: a global on/off switch for every ad on the site, plus
// per-slot code, enable/disable, and box size — see lib/ad-slots.js for
// the data layer and the three-state rendering rule (global off / slot
// off / slot on) that components/ad-slot.js follows.

import { escapeHtml } from '../../lib/entities.js';
import { getAdSlotsConfig, AD_SLOT_DEFS } from '../../lib/ad-slots.js';
import { getSettings } from '../../lib/settings.js';

function slotCard(def, slot) {
  return `
  <div class="adm-card" style="margin-bottom:16px${slot.enabled ? '' : ';opacity:.6'}">
    <div class="adm-card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <span>${slot.enabled ? '🟢' : '⚪'} ${escapeHtml(def.label)}</span>
      <span style="font-size:10px;font-weight:700;color:var(--ink3);font-family:monospace">${def.id}</span>
    </div>
    <form method="POST" action="/admin/ads/update" style="display:flex;flex-direction:column;gap:12px">
      <input type="hidden" name="slot_id" value="${def.id}">

      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--ink)">
        <input type="checkbox" name="enabled" value="1" ${slot.enabled ? 'checked' : ''}> Enabled
      </label>

      <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Ad Code <span style="font-weight:400;text-transform:none">(script/HTML from your ad network — pasted exactly as given)</span></span>
        <textarea class="adm-input" name="code" style="width:100%;min-height:110px;font-family:monospace;font-size:12px" spellcheck="false">${escapeHtml(slot.code || '')}</textarea>
      </label>

      <div style="display:flex;gap:14px">
        <label style="display:flex;flex-direction:column;gap:6px">
          <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Width (px)</span>
          <input class="adm-input" type="number" name="width" value="${slot.width}" min="50" max="1000" style="width:90px">
        </label>
        <label style="display:flex;flex-direction:column;gap:6px">
          <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase">Height (px)</span>
          <input class="adm-input" type="number" name="height" value="${slot.height}" min="50" max="1000" style="width:90px">
        </label>
      </div>

      <div style="display:flex;gap:10px">
        <button class="adm-btn adm-btn-primary" type="submit">Save</button>
      </div>
    </form>
    <form method="POST" action="/admin/ads/reset" style="margin-top:8px">
      <input type="hidden" name="slot_id" value="${def.id}">
      <button class="adm-btn-sm" type="submit" onclick="return confirm('Reset this slot to its default ad code and size?')">Reset to Default</button>
    </form>
  </div>`;
}

export async function renderAdsContent(env) {
  const settings = await getSettings(env);
  const config = await getAdSlotsConfig(env);
  const globalOn = settings.ads_enabled !== '0';

  const sections = AD_SLOT_DEFS.map(def => slotCard(def, config[def.id])).join('');

  return `
  <div class="adm-wrap" style="max-width:760px">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">📢 Ads</div>
        <div class="adm-sub">Full control over every ad placement — code, on/off, and box size, with a master switch for the whole site</div>
      </div>
    </div>

    <div class="adm-card" style="margin-bottom:20px;border-color:${globalOn ? 'var(--border)' : 'rgba(255,92,122,.4)'}">
      <div class="adm-card-title">Master Switch</div>
      <form method="POST" action="/admin/ads/toggle-global" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" name="ads_enabled" value="1" ${globalOn ? 'checked' : ''} style="width:20px;height:20px">
          <span style="font-size:14px;font-weight:700;color:var(--ink)">Ads enabled site-wide</span>
        </label>
        <button class="adm-btn adm-btn-primary" type="submit">Save</button>
      </form>
      <div style="font-size:11px;color:var(--ink3);margin-top:8px">When off, no ad code runs anywhere on the site — instantly, regardless of each slot's individual setting below.</div>
    </div>

    ${sections}
  </div>`;
}
