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

export function dashboardShell({ activeId, navItems, title, subtitle, content, headerActions = '', switchPill = '' }) {
  return `
<div class="page" style="max-width:1180px;padding-top:20px">
  ${switchPill}
  <nav class="dash-mobile-nav">
    ${navItems.map(n => `<a href="${n.href}" class="${n.id === activeId ? 'active' : ''}">${n.icon({ size: 13 })} ${escapeHtml(n.label)}</a>`).join('')}
  </nav>
  <div class="dash-shell">
    <aside class="dash-sidebar">
      ${navItems.map(n => `<a href="${n.href}" class="dash-nav-link${n.id === activeId ? ' active' : ''}">${n.icon({ size: 16 })} ${escapeHtml(n.label)}</a>`).join('')}
    </aside>
    <main class="dash-main">
      <div class="dash-hdr">
        <div>
          <div class="dash-title">${escapeHtml(title)}</div>
          ${subtitle ? `<div class="dash-sub">${escapeHtml(subtitle)}</div>` : ''}
        </div>
        ${headerActions}
      </div>
      ${content}
    </main>
  </div>
</div>`;
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
