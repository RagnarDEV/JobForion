// src/components/dashboard-shell.js
// Shared sidebar/mobile-tabs/header chrome for the User Dashboard
// (pages/user-dashboard.js) and Company Dashboard (pages/company-dashboard.js).
// Deliberately NOT the same component as pages/admin/shell.js — the plan
// (§20) explicitly says "don't make the user dashboard a copy of the
// admin dashboard" — but the two intentionally share a similar visual
// language (sidebar + content, mobile pill-tabs) because it's already
// the site's established "logged-in app" pattern, just restyled with
// the public-facing tokens in styles/accounts-css.js instead of the
// admin-only dark-mode-capable shell.

import { escapeHtml } from '../lib/entities.js';

export function dashboardShell({ activeId, navItems, title, subtitle, content, headerActions = '', switchPill = '', user = null }) {
  const displayName = user?.full_name || user?.email || 'Your account';
  const initials = String(displayName).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'J';
  const userBar = user ? `<div class="dash-userbar"><div class="dash-userbar-copy"><span class="dash-kicker">YOUR JOBFORION ACCOUNT</span><span class="dash-userbar-name">${escapeHtml(displayName)}</span></div><div class="dash-userbar-actions"><span class="dash-avatar" aria-hidden="true">${escapeHtml(initials)}</span><a href="/user/profile" class="dash-userbar-link">Profile</a><form method="POST" action="/logout"><button type="submit" class="dash-userbar-link dash-logout-link">Sign out</button></form></div></div>` : '';
  return `
<div class="page dash-page">
  <div id="dash-toast-host" class="dash-toast-host"></div>
  ${switchPill}
  ${userBar}
  <nav class="dash-mobile-nav" aria-label="Account navigation">
    ${navItems.map(n => `<a href="${n.href}" class="${n.id === activeId ? 'active' : ''}"${n.id === activeId ? ' aria-current="page"' : ''}>${n.icon({ size: 13 })} ${escapeHtml(n.label)}</a>`).join('')}
  </nav>
  <div class="dash-shell">
    <aside class="dash-sidebar" aria-label="Account navigation">
      <div class="dash-sidebar-label">ACCOUNT</div>${navItems.map(n => `<a href="${n.href}" class="dash-nav-link${n.id === activeId ? ' active' : ''}"${n.id === activeId ? ' aria-current="page"' : ''}>${n.icon({ size: 16 })} <span>${escapeHtml(n.label)}</span></a>`).join('')}
    </aside>
    <main class="dash-main">
      <div class="dash-hdr">
        <div><h1 class="dash-title">${escapeHtml(title)}</h1>${subtitle ? `<p class="dash-sub">${escapeHtml(subtitle)}</p>` : ''}</div>
        ${headerActions}
      </div>
      ${content}
    </main>
  </div>
</div>
<script>
// Same "?flash=message" -> toast pattern as the admin shell
// (pages/admin/shell.js) — a POST action redirects here with a short
// status message instead of rendering its own success/error page, and
// this reads it off the URL once, shows it, then strips it so a page
// refresh doesn't re-show a stale toast.
(function(){
  var params = new URLSearchParams(window.location.search);
  var flash = params.get('flash');
  if (!flash) return;
  var host = document.getElementById('dash-toast-host');
  var el = document.createElement('div');
  el.textContent = flash;
  el.style.cssText = 'background:var(--ink);color:#fff;font-size:13px;font-weight:600;padding:11px 16px;border-radius:10px;box-shadow:0 16px 40px rgba(18,22,43,.2);opacity:0;transform:translateY(8px);transition:all .25s;max-width:320px';
  host.appendChild(el);
  requestAnimationFrame(function(){ el.style.opacity='1'; el.style.transform='translateY(0)'; });
  setTimeout(function(){ el.style.opacity='0'; }, 3200);
  params.delete('flash');
  var clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  window.history.replaceState({}, '', clean);
})();
</script>`;
}

// Shown at the top of both dashboards when a user has BOTH a Job Seeker
// identity and at least one active company membership (plan §26 — "let
// them switch between Job Seeker and Company without logging out").
export function accountSwitchPill(activeSide, companies = []) {
  if (!companies.length) return '';
  const target = companies.length === 1 ? `/company/dashboard` : '/company/dashboard';
  return `<div style="margin-bottom:16px"><div class="switch-pill">
    <a href="/user/dashboard" class="${activeSide === 'user' ? 'active' : ''}">Job Seeker</a>
    <a href="${target}" class="${activeSide === 'company' ? 'active' : ''}">Company</a>
  </div></div>`;
}
