// src/components/nav.js
// Desktop nav bar + mobile header/menu (shared across every page).

import { iconSearch, iconBuilding, iconFolder, iconBookmark, iconFileText, iconPlus, iconLock, iconMenu, iconGlobe, iconX } from '../assets/icons.js';
import { escapeHtml } from '../lib/entities.js';
import { SETTINGS_DEFAULTS } from '../lib/settings.js';

// `settings` is optional everywhere in this file — every call site that
// doesn't pass one gets the exact same hardcoded "JobForion" branding as
// before (SETTINGS_DEFAULTS.site_name), so this change is zero-risk for
// any caller not yet updated to fetch dynamic settings. `menuPages` (CMS
// pages with show_in_menu=1, see lib/pages-cms.js) and `navButtons`
// (arbitrary admin-added buttons, see lib/nav-buttons.js) are likewise
// optional and default to empty — a caller that doesn't pass them just
// gets the original static menu, unchanged.
export function navHtml(settings, menuPages = [], navButtons = []) {
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
    <button class="nav-cta" onclick="openPostJobModal()">+ Post a Job</button>
  </div>
</nav>`;
}

export function mobileHeaderHtml(settings, menuPages = [], navButtons = []) {
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
