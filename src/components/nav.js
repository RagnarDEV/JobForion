// Shared desktop navigation, mobile header/menu, and mobile bottom navigation.

import { iconSearch, iconBuilding, iconFolder, iconBookmark, iconFileText, iconPlus, iconLock, iconMenu, iconGlobe, iconX, iconUser, iconLayoutDashboard, iconHome, iconBriefcase } from '../assets/icons.js';
import { escapeHtml } from '../lib/entities.js';
import { SETTINGS_DEFAULTS } from '../lib/settings.js';

function authLinksHtml(user, mobile = false) {
  if (!user) {
    return mobile
      ? `<a href="/login">${iconUser({ size: 16 })} Log in</a><a href="/register" class="mob-menu-post-btn">${iconPlus({ size: 16 })} Create account</a>`
      : `<a href="/login" class="nav-link">Sign in</a><a href="/register" class="nav-link">Create account</a>`;
  }
  return mobile
    ? `<a href="/user/dashboard">${iconLayoutDashboard({ size: 16 })} Dashboard</a><form method="POST" action="/logout" style="margin:0"><button type="submit" style="width:100%">${iconX({ size: 16 })} Log out</button></form>`
    : `<a href="/user/dashboard" class="nav-link">${iconLayoutDashboard({ size: 14 })} Dashboard</a>`;
}

export function navHtml(settings, menuPages = [], navButtons = [], user = null) {
  const siteName = escapeHtml(settings?.site_name || SETTINGS_DEFAULTS.site_name);
  const extraLinks = [
    ...menuPages.map(p => `<a href="/${escapeHtml(p.slug)}" class="nav-link">${escapeHtml(p.title)}</a>`),
    ...navButtons.map(b => `<a href="${escapeHtml(b.url)}" class="nav-link" style="color:${escapeHtml(b.color)}">${escapeHtml(b.icon)} ${escapeHtml(b.label)}</a>`),
  ].join('');
  return `
<nav class="nav" aria-label="Primary navigation">
  <a href="/" class="nav-logo"><img src="/favicon.svg" alt="${siteName}"><span>${siteName}</span><span class="dot"></span></a>
  <div class="nav-links">
    <a href="/" class="nav-link">Find jobs</a>
    <a href="/companies" class="nav-link">Companies</a>
    <a href="/?remote_type=fully_remote" class="nav-link">Remote jobs</a>
    <a href="/categories" class="nav-link">Categories</a>
    <a href="/blog" class="nav-link">Resources</a>
    ${extraLinks}
    <button class="nav-link" onclick="if(window.goView){goView('saved')}else{location='/' }">Saved jobs</button>
    ${authLinksHtml(user, false)}
    <button class="nav-cta" onclick="openPostJobModal()">${iconPlus({ size: 14 })} Post a job</button>
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
  <button class="mob-burger" onclick="toggleMobMenu()" id="mobBurgerBtn" aria-label="Open navigation menu">${iconMenu({ size: 18 })}</button>
  <a href="${user ? '/user/dashboard' : '/login'}" class="mob-account-indicator" aria-label="${user ? 'Open dashboard' : 'Log in'}"><span></span></a>
</div>
<div class="mob-menu" id="mobMenu" aria-label="Mobile navigation">
  <a href="/">${iconSearch({ size: 16 })} Find jobs</a>
  <a href="/companies">${iconBuilding({ size: 16 })} Companies</a>
  <a href="/?remote_type=fully_remote">${iconGlobe({ size: 16 })} Remote jobs</a>
  <a href="/categories">${iconFolder({ size: 16 })} Categories</a>
  <button onclick="if(window.goView){goView('saved');closeMobMenu();}else{location='/'}">${iconBookmark({ size: 16 })} Saved jobs</button>
  <a href="/blog">${iconFileText({ size: 16 })} Resources</a>
  <a href="/privacy">${iconLock({ size: 16 })} Privacy</a>
  ${extraMenuItems}
  ${authLinksHtml(user, true)}
  <button class="mob-menu-post-btn" onclick="openPostJobModal();closeMobMenu();">${iconPlus({ size: 18 })} Post a job</button>
</div>
<script>
(function(){
  var MENU_ICON=${JSON.stringify(iconMenu({ size: 18 }))};
  var CLOSE_ICON=${JSON.stringify(iconX({ size: 18 }))};
  window.toggleMobMenu=function(){
    var menu=document.getElementById('mobMenu');
    var btn=document.getElementById('mobBurgerBtn');
    var willOpen=!menu.classList.contains('open');
    menu.classList.toggle('open'); btn.classList.toggle('is-open',willOpen);
    btn.innerHTML=willOpen?CLOSE_ICON:MENU_ICON;
    btn.setAttribute('aria-label',willOpen?'Close navigation menu':'Open navigation menu');
  };
  window.closeMobMenu=function(){
    document.getElementById('mobMenu').classList.remove('open');
    var btn=document.getElementById('mobBurgerBtn'); btn.classList.remove('is-open');
    btn.innerHTML=MENU_ICON; btn.setAttribute('aria-label','Open navigation menu');
  };
})();
</script>`;
}

export function mobileBottomNavHtml(currentPath = '/', user = null) {
  const path = currentPath || '/';
  const active = path.startsWith('/job') ? 'jobs' : path.startsWith('/companies') ? 'companies' : path.startsWith('/user/saved') ? 'saved' : path.startsWith('/user/applications') ? 'jobs' : path.startsWith('/user') ? 'profile' : 'home';
  const profileHref = user ? '/user/dashboard' : '/login';
  const item = (key, href, label, markup, click = '') => `<a href="${href}" class="mobile-bottom-item${active === key ? ' active' : ''}"${active === key ? ' aria-current="page"' : ''}${click ? ` onclick="${click}"` : ''}>${markup}<span>${label}</span></a>`;
  return `<nav class="mobile-bottom-nav" aria-label="Mobile primary navigation">
    ${item('home', '/', 'Home', iconHome({ size: 18 }))}
    ${item('jobs', '/', 'Jobs', iconBriefcase({ size: 18 }), "if(window.goView){goView('jobs');event.preventDefault();}")}
    ${item('companies', '/companies', 'Companies', iconBuilding({ size: 18 }))}
    ${item('saved', '/', 'Saved', iconBookmark({ size: 18 }), "if(window.goView){goView('saved');event.preventDefault();}")}
    ${item('profile', profileHref, 'Profile', iconUser({ size: 18 }))}
  </nav>`;
}
