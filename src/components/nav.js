// src/components/nav.js
import {
  Logo, Menu, X, Home, Compass, Users,
  Tag, FileText, Mail, PlusCircle
} from '../assets/icons.js';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/search', label: 'Browse Jobs', icon: Compass },
  { href: '/companies', label: 'Companies', icon: Users },
  { href: '/categories', label: 'Categories', icon: Tag },
  { href: '/blog', label: 'Blog', icon: FileText },
  { href: '/contact', label: 'Contact', icon: Mail },
];

export const navHtml = (currentPath = '/') => {
  const logoLink = '/';
  
  const navItemsHtml = NAV_ITEMS.map(item => {
    const isActive = currentPath === item.href || (item.href !== '/' && currentPath.startsWith(item.href));
    return `
      <a href="${item.href}" class="nav__dropdown-item${isActive ? ' active' : ''}" aria-current="${isActive ? 'page' : 'false'}">
        ${item.icon(20)}
        <span>${item.label}</span>
      </a>
    `;
  }).join('');

  return `
    <nav class="nav" role="navigation" aria-label="Main navigation">
      <div class="nav__container">
        <a href="${logoLink}" class="nav__logo" aria-label="JobForion Home">
          <span class="nav__logo-icon">${Logo(28)}</span>
          <span>JobForion</span>
        </a>
        
        <div class="nav__actions">
          <button 
            class="nav__hamburger" 
            id="navHamburger" 
            aria-label="Open menu" 
            aria-expanded="false"
            aria-controls="navDropdown"
          >
            ${Menu(22)}
          </button>
        </div>
      </div>
      
      <div class="nav__dropdown" id="navDropdown" role="menu" aria-hidden="true">
        ${navItemsHtml}
        <a href="/post-job" class="nav__dropdown-item nav__dropdown-item--primary" role="menuitem">
          ${PlusCircle(20)}
          <span>Post a Job</span>
        </a>
      </div>
    </nav>
    
    <script>
      (function() {
        const hamburger = document.getElementById('navHamburger');
        const dropdown = document.getElementById('navDropdown');
        if (!hamburger || !dropdown) return;
        
        let isOpen = false;
        const toggleMenu = () => {
          isOpen = !isOpen;
          hamburger.classList.toggle('active', isOpen);
          dropdown.classList.toggle('open', isOpen);
          hamburger.setAttribute('aria-expanded', String(isOpen));
          dropdown.setAttribute('aria-hidden', String(!isOpen));
          hamburger.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
        };
        
        hamburger.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
        document.addEventListener('click', (e) => {
          if (isOpen && !dropdown.contains(e.target) && !hamburger.contains(e.target)) {
            isOpen = false;
            hamburger.classList.remove('active');
            dropdown.classList.remove('open');
            hamburger.setAttribute('aria-expanded', 'false');
            dropdown.setAttribute('aria-hidden', 'true');
          }
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) toggleMenu(); });
      })();
    </script>
  `;
};

// أسماء مستعارة لضمان التوافق مع أي ملف آخر في المشروع
export const renderNav = navHtml;
export const mobileHeaderHtml = navHtml;
