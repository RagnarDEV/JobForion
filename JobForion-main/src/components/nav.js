// src/components/nav.js
// Desktop nav bar + mobile header/menu (shared across every page).

import { iconSearch, iconBuilding, iconFolder, iconBookmark, iconFileText, iconPlus, iconLock, iconMenu, iconGlobe } from '../assets/icons.js';

export function navHtml() {
  return `
<nav class="nav">
  <a href="/" class="nav-logo"><img src="/favicon.svg" alt="JobForion"><span>JobForion</span><span class="dot"></span></a>
  <div class="nav-links">
    <a href="/" class="nav-link">Browse Jobs</a>
    <a href="/companies" class="nav-link">Companies</a>
    <a href="/categories" class="nav-link">Categories</a>
    <a href="/blog" class="nav-link">Blog</a>
    <button class="nav-link" onclick="if(window.goView){goView('saved')}else{location='/'}">Saved</button>
    <button class="nav-cta" onclick="openPostJobModal()">+ Post a Job</button>
  </div>
</nav>`;
}

export function mobileHeaderHtml() {
  return `
<div class="mob-hdr">
  <a href="/" class="mob-logo"><img src="/favicon.svg" alt="JobForion">JobForion</a>
  <div class="mob-btns">
    <button class="mob-cta" onclick="openPostJobModal()">+ Post</button>
    <button class="mob-burger" onclick="toggleMobMenu()" id="mobBurgerBtn">${iconMenu({ size: 18 })}</button>
  </div>
</div>
<div class="mob-menu" id="mobMenu">
  <a href="/">${iconSearch({ size: 16 })} Browse Jobs</a>
  <a href="/companies">${iconBuilding({ size: 16 })} Companies</a>
  <a href="/categories">${iconFolder({ size: 16 })} Categories</a>
  <a href="/countries">${iconGlobe({ size: 16 })} Countries</a>
  <button onclick="if(window.goView){goView('saved');closeMobMenu();}else{location='/'}">${iconBookmark({ size: 16 })} Saved Jobs</button>
  <a href="/blog">${iconFileText({ size: 16 })} Career Blog</a>
  <button onclick="openPostJobModal();closeMobMenu();">${iconPlus({ size: 16 })} Post a Job</button>
  <a href="/privacy">${iconLock({ size: 16 })} Privacy</a>
</div>
<script>
function toggleMobMenu(){document.getElementById('mobMenu').classList.toggle('open');}
function closeMobMenu(){document.getElementById('mobMenu').classList.remove('open');}
</script>`;
}
