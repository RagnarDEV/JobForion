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

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', href: '/admin' },
  { id: 'jobs', label: 'Jobs', icon: '💼', href: '/admin/jobs' },
  // Future phases plug in here, e.g.:
  // { id: 'companies', label: 'Companies', icon: '🏢', href: '/admin/companies' },
];

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
.adm-logo{display:flex;align-items:center;gap:8px;padding:6px 8px 18px;font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:16px;color:var(--ink)}
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
@media(max-width:768px){
  .adm-sidebar{display:none}
  .adm-mobile-nav{display:flex;gap:8px;overflow-x:auto;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface)}
  .adm-mobile-nav a{flex-shrink:0;padding:7px 14px;border-radius:20px;background:var(--surface2);color:var(--ink2);font-size:12.5px;font-weight:700;text-decoration:none;white-space:nowrap}
  .adm-mobile-nav a.active{background:var(--brand);color:#fff}
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
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${SHARED_CSS}${DARK_THEME_CSS}${SHELL_CSS}
.adm-wrap{max-width:1180px;margin:0 auto;padding:24px 20px 60px}
.adm-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;flex-wrap:wrap;gap:12px}
.adm-title{font-family:'Space Grotesk',sans-serif;font-size:24px;font-weight:700;color:var(--ink)}
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
@media(max-width:768px){.adm-grid{grid-template-columns:1fr}}
</style></head><body>
<div id="toast-host"></div>
<div class="adm-shell">
  <aside class="adm-sidebar">
    <div class="adm-logo"><img src="/favicon.svg" alt="JobForion">JobForion</div>
    ${NAV_ITEMS.map(n => `<a href="${n.href}" class="adm-nav-link${n.id === activeId ? ' active' : ''}">${n.icon} ${n.label}</a>`).join('')}
  </aside>
  <main class="adm-main">
    <nav class="adm-mobile-nav">
      ${NAV_ITEMS.map(n => `<a href="${n.href}" class="${n.id === activeId ? ' active' : ''}">${n.icon} ${n.label}</a>`).join('')}
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
