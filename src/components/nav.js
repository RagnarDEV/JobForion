// src/components/nav.js
// Desktop nav bar + mobile header/menu (shared across every page).

import { iconSearch, iconBuilding, iconFolder, iconBookmark, iconFileText, iconPlus, iconLock, iconMenu, iconGlobe, iconX, iconUser, iconLayoutDashboard } from '../assets/icons.js';
import { escapeHtml } from '../lib/entities.js';
import { SETTINGS_DEFAULTS } from '../lib/settings.js';

// `user` (optional, new) is the safe session-user row from
// lib/accounts/session.js's getSessionUser() — { id, email, ... } or
// null for a signed-out visitor. Every call site that doesn't pass one
// gets the exact same "Login / Register" links as a signed-out visitor,
// so this is zero-risk for any page not yet updated to thread the
// session through (see routes/pages.router.js for which pages currently
// do — homepage and every new /user, /company, auth page; the rest
// still render correctly, they just show the generic signed-out nav).
function authLinksHtml(user, mobile = false) {
  if (!user) {
    return mobile
      ? `<a href="/login">${iconUser({ size: 16 })} Log In</a><a href="/register" class="mob-menu-post-btn" style="background:var(--ink);margin-top:4px">${iconPlus({ size: 16 })} Create Account</a>`
      : `<a href="/login" class="nav-link">Log In</a><a href="/register" class="nav-link" style="color:#fff;font-weight:700">Sign Up</a>`;
  }
  return mobile
    ? `<a href="/user/dashboard">${iconLayoutDashboard({ size: 16 })} Dashboard</a><form method="POST" action="/logout" style="margin:0"><button type="submit" style="width:100%">${iconX({ size: 16 })} Log Out</button></form>`
    : `<a href="/user/dashboard" class="nav-link">${iconLayoutDashboard({ size: 14 })} Dashboard</a>`;
}

// `settings` is optional everywhere in this file — every call site that
// doesn't pass one gets the exact same hardcoded "JobForion" branding as
// before (SETTINGS_DEFAULTS.site_name), so this change is zero-risk for
// any caller not yet updated to fetch dynamic settings. `menuPages` (CMS
// pages with show_in_menu=1, see lib/pages-cms.js) and `navButtons`
// (arbitrary admin-added buttons, see lib/nav-buttons.js) are likewise
// optional and default to empty — a caller that doesn't pass them just
// gets the original static menu, unchanged.
export function navHtml(settings, menuPages = [], navButtons = [], user = null) {
  const siteName = escapeHtml(settings?.site_name || SETTINGS_DEFAULTS.site_name);
  const extraLinks = [
    ...menuPages.map(p => `<a href="/${escapeHtml(p.slug)}" class="nav-link">${escapeHtml(p.title)}</a>`),
    ...navButtons.map(b => `<a href="${escapeHtml(b.url)}" class="nav-link" style="color:${escapeHtml(b.color)}">${escapeHtml(b.icon)} ${escapeHtml(b.label)}</a>`),
  ].join('');
  return `
<nav class="nav">
  <a href="/" class="nav-logo"><img src="/favicon.svg" alt="${siteName}"><span>${siteName}</span><span class="dot"></span></a>
  <div class="nav-links">
    <a href="/" class="nav-link">Browse Jobs</a>
    <a href="/companies" class="nav-link">Companies</a>
    <a href="/categories" class="nav-link">Categories</a>
    <a href="/blog" class="nav-link">Blog</a>
    ${extraLinks}
    <button class="nav-link" onclick="if(window.goView){goView('saved')}else{location='/'}">Saved</button>
    ${authLinksHtml(user, false)}
    <button class="nav-cta" onclick="openPostJobModal()">+ Post a Job</button>
  </div>
</nav>`;
}

export function mobileHeaderHtml(settings, menuPages = [], navButtons = [], user = null) {
  const siteName = escapeHtml(settings?.site_name || SETTINGS_DEFAULTS.site_name);
  const extraMenuItems = [
    ...menuPages.map(p => `<a href="/${escapeHtml(p.slug)}">${iconFileText({ size: 16 })} ${escapeHtml(p.title)}</a>`),
    ...navButtons.map(b => `<a href="${escapeHtml(b.url)}" style="color:${escapeHtml(b.color)}"><span style="width:16px;display:inline-flex;justify-content:center">${escapeHtml(b.icon)}</span> ${escapeHtml(b.label)}</a>`),
  ].join('');
  return `
<div class="mob-hdr">
  <a href="/" class="mob-logo"><img src="/favicon.svg" alt="${siteName}">${siteName}</a>
  <button class="mob-burger" onclick="toggleMobMenu()" id="mobBurgerBtn">${iconMenu({ size: 18 })}</button>
</div>
<div class="mob-menu" id="mobMenu">
  <a href="/">${iconSearch({ size: 16 })} Browse Jobs</a>
  <a href="/companies">${iconBuilding({ size: 16 })} Companies</a>
  <a href="/categories">${iconFolder({ size: 16 })} Categories</a>
  <a href="/countries">${iconGlobe({ size: 16 })} Countries</a>
  <button onclick="if(window.goView){goView('saved');closeMobMenu();}else{location='/'}">${iconBookmark({ size: 16 })} Saved Jobs</button>
  <a href="/blog">${iconFileText({ size: 16 })} Career Blog</a>
  <a href="/privacy">${iconLock({ size: 16 })} Privacy</a>
  ${extraMenuItems}
  ${authLinksHtml(user, true)}
  <button class="mob-menu-post-btn" onclick="openPostJobModal();closeMobMenu();">${iconPlus({ size: 18 })} Post a Job</button>
</div>
<script>
(function(){
  var MENU_ICON=${JSON.stringify(iconMenu({ size: 18 }))};
  var CLOSE_ICON=${JSON.stringify(iconX({ size: 18 }))};
  window.toggleMobMenu=function(){
    var menu=document.getElementById('mobMenu');
    var btn=document.getElementById('mobBurgerBtn');
    var willOpen=!menu.classList.contains('open');
    menu.classList.toggle('open');
    btn.classList.toggle('is-open',willOpen);
    btn.innerHTML=willOpen?CLOSE_ICON:MENU_ICON;
  };
  window.closeMobMenu=function(){
    document.getElementById('mobMenu').classList.remove('open');
    var btn=document.getElementById('mobBurgerBtn');
    btn.classList.remove('is-open');
    btn.innerHTML=MENU_ICON;
  };
})();
</script>`;
}
