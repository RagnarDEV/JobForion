// src/pages/admin/homepage.js
// Homepage Sections Builder — the admin-facing half of
// lib/homepage-sections.js. Deliberately simple: a sorted list of cards,
// each with an Enable/Disable button and Up/Down reorder buttons. No
// drag-and-drop (unreliable on mobile — see the project's "Mobile First"
// rule) and no free-form section creation (see lib/homepage-sections.js
// header for why that would be a parallel, unsupported system).

import { escapeHtml } from '../../lib/entities.js';
import { getAllHomepageSections } from '../../lib/homepage-sections.js';

export async function renderHomepageBuilderContent(env) {
  const sections = await getAllHomepageSections(env);

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

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">🏠 Homepage Sections</div>
        <div class="adm-sub">Enable, disable, and reorder the blocks that make up the homepage — changes are live immediately</div>
      </div>
      <a href="/" target="_blank" class="adm-btn">View Live Homepage →</a>
    </div>

    <div class="adm-card" style="margin-bottom:14px">
      <div style="font-size:12px;color:var(--ink2);line-height:1.7">
        <b>Hero</b> and <b>Job Listing</b> can\u2019t be disabled \u2014 they carry the site\u2019s search box and the job list itself, so turning them off would break the homepage rather than customize it. Everything else is optional.
      </div>
    </div>

    <div class="adm-card" style="padding:6px 0">
      ${rows}
    </div>
  </div>
  <style>
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
    .hp-row-toggle{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0}
    .hp-status-on{font-size:10px;font-weight:700;color:var(--green)}
    .hp-status-off{font-size:10px;font-weight:700;color:var(--ink3)}
    @media(max-width:560px){
      .hp-row{flex-wrap:wrap}
      .hp-row-toggle{flex-direction:row;align-items:center;margin-left:40px}
    }
  </style>`;
}
