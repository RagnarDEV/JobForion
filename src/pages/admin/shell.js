// src/pages/admin/shell.js
// Shared HTML shell for every admin page: sidebar nav, dark/light theme
// (persisted client-side, admin-only — does not touch the public site's
// styles), and a small toast helper for post-action flash messages.
//
// New admin pages just call adminShell('pageId', innerHtmlContent) instead
// of building their own <html>...</html> wrapper — keeps every future page
// (Job Management, Providers, etc.) visually consistent for free.

import { ICON_HEAD } from '../../assets/favicon.js';
import { SHARED_CSS } from '../../styles/shared-css.js';
import {
  iconLayoutDashboard, iconBriefcase, iconBuilding, iconPlug, iconTag, iconGlobe,
  iconFileText, iconEdit3, iconPalette, iconSettingsGear, iconMegaphone,
  iconServer, iconShieldCheck, iconLogOut, iconHome, iconSparkle, iconUser, iconUsers,
} from '../../assets/icons.js';

// ── Admin Dashboard V2 sidebar IA ──────────────────────────────────
// Grouped to mirror the site's real management surface (Overview / Jobs &
// Companies / Job Sources / Taxonomy & Directory / Content / Website /
// Monetization / System / Security) instead of one flat list. Adding a
// future admin page is still "one entry in the right group" — no new
// architecture, just a clearer map of what's already here.
const NAV_GROUPS = [
  { title: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', icon: iconLayoutDashboard, href: '/admin' },
  ]},
  { title: 'Jobs & Companies', items: [
    { id: 'jobs', label: 'Jobs', icon: iconBriefcase, href: '/admin/jobs' },
    { id: 'companies', label: 'Companies', icon: iconBuilding, href: '/admin/companies' },
    { id: 'sources', label: 'Job Sources', icon: iconPlug, href: '/admin/sources' },
  ]},
  { title: 'Accounts', items: [
    { id: 'users', label: 'Users', icon: iconUser, href: '/admin/accounts/users' },
    { id: 'company-accounts', label: 'Company Accounts', icon: iconUsers, href: '/admin/accounts/companies' },
  ]},
  { title: 'Taxonomy & Directory', items: [
    { id: 'categories', label: 'Categories', icon: iconTag, href: '/admin/categories' },
    { id: 'directory', label: 'Directory', icon: iconGlobe, href: '/admin/directory' },
  ]},
  { title: 'Content', items: [
    { id: 'pages', label: 'Pages', icon: iconFileText, href: '/admin/pages' },
    { id: 'blog', label: 'Blog', icon: iconEdit3, href: '/admin/blog' },
    { id: 'blog-automation', label: 'Blog Automation', icon: iconSparkle, href: '/admin/blog-automation' },
  ]},
  { title: 'Website', items: [
    { id: 'homepage', label: 'Homepage', icon: iconHome, href: '/admin/homepage' },
    { id: 'card-styles', label: 'Card Styles', icon: iconPalette, href: '/admin/card-styles' },
    { id: 'settings', label: 'Settings', icon: iconSettingsGear, href: '/admin/settings' },
  ]},
  { title: 'Monetization', items: [
    { id: 'ads', label: 'Ads', icon: iconMegaphone, href: '/admin/ads' },
  ]},
  { title: 'System & Security', items: [
    { id: 'system', label: 'System', icon: iconServer, href: '/admin/system' },
    { id: 'security', label: 'Security', icon: iconShieldCheck, href: '/admin/security' },
  ]},
];
// Flat list — used for the mobile horizontal nav (no grouping there, same
// as before) and to find the active item's label/group.
const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);

const DARK_THEME_CSS = `
[data-theme="dark"]{
  --bg:#0b0f16; --surface:#131923; --surface2:#1a2230;
  --border:#232c3d; --border2:#2c374a;
  --ink:#eef2f8; --ink2:#c3cbdb; --ink3:#7c8aa3;
  --shadow:0 1px 2px rgba(0,0,0,.4); --shadow-lg:0 10px 30px rgba(0,0,0,.5);
}
[data-theme="dark"] body{background:var(--bg)}
`;

const SHELL_CSS = `
.adm-shell{display:flex;min-height:100vh}
.adm-sidebar{width:210px;flex-shrink:0;background:var(--surface);border-right:1px solid var(--border);padding:18px 12px;position:sticky;top:0;height:100vh;overflow-y:auto}
.adm-logo{display:flex;align-items:center;gap:8px;padding:6px 8px 18px;font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:16px;color:var(--ink)}
.adm-logo img{width:26px;height:26px;border-radius:7px}
.adm-nav-link{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:9px;font-size:13px;font-weight:600;color:var(--ink2);text-decoration:none;margin-bottom:2px}
.adm-nav-link:hover{background:var(--surface2)}
.adm-nav-link.active{background:var(--brand);color:#fff}
.adm-main{flex:1;min-width:0}
.adm-topbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:14px 20px;border-bottom:1px solid var(--border)}
.theme-toggle{width:34px;height:34px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);color:var(--ink2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px}
#toast-host{position:fixed;bottom:18px;right:18px;z-index:999;display:flex;flex-direction:column;gap:8px}
.toast{background:var(--ink);color:var(--bg);font-size:13px;font-weight:600;padding:11px 16px;border-radius:10px;box-shadow:var(--shadow-lg);opacity:0;transform:translateY(8px);transition:all .25s}
.toast.show{opacity:1;transform:translateY(0)}
.skeleton{background:linear-gradient(90deg,var(--surface2) 25%,var(--border) 50%,var(--surface2) 75%);background-size:200% 100%;animation:skel 1.3s ease-in-out infinite;border-radius:8px}
@keyframes skel{0%{background-position:200% 0}100%{background-position:-200% 0}}
.adm-mobile-nav{display:none}
.adm-nav-group-title{font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--ink3);padding:14px 10px 6px}
.adm-nav-group-title:first-child{padding-top:2px}
.adm-nav-link svg{flex-shrink:0}
.adm-sidebar-footer{margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
@media(max-width:768px){
  .adm-sidebar{display:none}
  .adm-mobile-nav{display:flex;gap:8px;overflow-x:auto;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface)}
  .adm-mobile-nav a{flex-shrink:0;display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:20px;background:var(--surface2);color:var(--ink2);font-size:12.5px;font-weight:700;text-decoration:none;white-space:nowrap}
  .adm-mobile-nav a.active{background:var(--brand);color:#fff}
}
`;

// ── Provider companies bulk-add / inline-edit (API Sources card) ──
const PROVIDER_COMPANIES_CSS = `
.pc-info{font-size:12px;color:var(--ink2);background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:14px;line-height:1.8}
.pc-info code{background:var(--surface);border:1px solid var(--border2);border-radius:5px;padding:1px 6px;font-size:11px}
.pc-bulk-form{margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--border)}
.pc-bulk-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.pc-bulk-footer{display:flex;justify-content:space-between;align-items:center;margin-top:8px;flex-wrap:wrap;gap:8px}
.pc-list{display:flex;flex-direction:column}
.pc-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap}
.pc-row-main{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.pc-row-actions{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap}
.pc-edit-row{display:none;gap:8px;align-items:center;flex-wrap:wrap;padding:12px;margin-bottom:10px;background:var(--surface2);border:1px solid var(--border2);border-radius:10px}
.pc-edit-row.open{display:flex}
.pc-edit-row input.adm-input{flex:1;min-width:140px}
.pc-active-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink2);white-space:nowrap}
.pc-edit-actions{display:flex;gap:6px}
@media(max-width:768px){
  .pc-row{flex-direction:column;align-items:flex-start;padding:12px 0}
  .pc-row-actions{width:100%;justify-content:flex-start}
  .pc-bulk-row{flex-direction:column;align-items:stretch}
  .pc-edit-row{flex-direction:column;align-items:stretch}
  .pc-edit-row input.adm-input{min-width:0}
}
`;

const SHELL_SCRIPT = `
(function(){
  var saved = localStorage.getItem('jn_admin_theme');
  var theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  window.jnToggleTheme = function(){
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('jn_admin_theme', next);
    var btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
  };
  window.jnToast = function(msg){
    var host = document.getElementById('toast-host');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(function(){ el.classList.add('show'); });
    setTimeout(function(){ el.classList.remove('show'); setTimeout(function(){ el.remove(); }, 300); }, 3200);
  };
  document.addEventListener('DOMContentLoaded', function(){
    var params = new URLSearchParams(window.location.search);
    var flash = params.get('flash');
    if (flash) {
      window.jnToast(flash);
      params.delete('flash');
      var clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', clean);
    }
    var btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
  });
})();
`;

export function adminShell(activeId, content) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin — JobForion</title><meta name="robots" content="noindex, nofollow">${ICON_HEAD}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${SHARED_CSS}${DARK_THEME_CSS}${SHELL_CSS}${PROVIDER_COMPANIES_CSS}
.adm-wrap{max-width:1180px;margin:0 auto;padding:24px 20px 60px}
.adm-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;flex-wrap:wrap;gap:12px}
.adm-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:700;color:var(--ink)}
.adm-sub{font-size:13px;color:var(--ink3)}
.adm-btn{padding:9px 16px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);color:var(--ink2);font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.adm-btn-primary{background:var(--brand);border-color:var(--brand);color:#fff}
.adm-btn-sm{padding:6px 12px;border-radius:7px;border:1px solid var(--border2);background:var(--surface);color:var(--coral);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit}
.adm-btn-approve{color:var(--green);border-color:rgba(15,174,121,.3)}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:16px}
.adm-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.adm-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:var(--shadow)}
.adm-card-title{font-size:13px;font-weight:700;color:var(--ink);margin-bottom:14px}
.adm-row{display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)}
.adm-row:last-child{border-bottom:none}
.adm-row-label{font-size:12px;color:var(--ink2);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%}
.adm-row-val{font-size:12px;font-weight:700;color:var(--ink)}
.adm-empty{font-size:12px;color:var(--ink3);padding:8px 0}
.adm-input{background:var(--surface2);border:1.5px solid var(--border2);border-radius:9px;padding:9px 12px;font-size:13px;font-family:inherit;outline:none;color:var(--ink)}
.adm-input:focus{border-color:var(--brand)}
.pp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);flex-wrap:wrap}
.pp-row:last-child{border-bottom:none}
.pp-title{font-size:13px;font-weight:700;color:var(--ink)}
.pp-meta{font-size:11px;color:var(--ink3);margin:3px 0}
.pp-actions{display:flex;gap:8px;flex-shrink:0}
.health-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)}
.health-row:last-child{border-bottom:none}
.health-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
.health-ok{background:var(--green)}
.health-warn{background:#e0a83a}
.health-off{background:var(--ink3)}
.health-err{background:var(--coral)}

/* ── Bulk Actions bar (Admin Dashboard V2, Phase 2) — sticky, mobile-first;
     hidden until at least one row checkbox is checked (see jobs.js) ── */
.bulk-bar{display:none;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:var(--ink);color:#fff;border-radius:12px;padding:10px 14px;margin-bottom:10px;position:sticky;top:8px;z-index:20;box-shadow:var(--shadow-lg)}
.bulk-bar.show{display:flex}
.bulk-bar-count{font-size:12.5px;font-weight:700;flex-shrink:0}
.bulk-bar-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.bulk-bar .adm-btn-sm{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:#fff}
.bulk-bar .adm-input{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:#fff}
@media(max-width:640px){
  .bulk-bar{position:fixed;left:10px;right:10px;bottom:10px;top:auto;margin-bottom:0}
}
@media(max-width:768px){.adm-grid{grid-template-columns:1fr}}
</style></head><body>
<div id="toast-host"></div>
<div class="adm-shell">
  <aside class="adm-sidebar">
    <div class="adm-logo"><img src="/favicon.svg" alt="JobForion">JobForion</div>
    ${NAV_GROUPS.map(g => `
      <div class="adm-nav-group-title">${g.title}</div>
      ${g.items.map(n => `<a href="${n.href}" class="adm-nav-link${n.id === activeId ? ' active' : ''}">${n.icon({ size: 15 })} ${n.label}</a>`).join('')}
    `).join('')}
    <div class="adm-sidebar-footer">
      <a href="/admin/logout" class="adm-nav-link">${iconLogOut({ size: 15 })} Logout</a>
    </div>
  </aside>
  <main class="adm-main">
    <nav class="adm-mobile-nav">
      ${NAV_ITEMS.map(n => `<a href="${n.href}" class="${n.id === activeId ? 'active' : ''}">${n.icon({ size: 13 })} ${n.label}</a>`).join('')}
    </nav>
    <div class="adm-topbar">
      <button class="theme-toggle" id="themeToggleBtn" onclick="jnToggleTheme()" title="Toggle dark mode">🌙</button>
    </div>
    ${content}
  </main>
</div>
<script>${SHELL_SCRIPT}</script>
</body></html>`;
}
