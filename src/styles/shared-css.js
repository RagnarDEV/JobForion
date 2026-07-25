// src/styles/shared-css.js
// Shared CSS — all design tokens, colors, and common styles

export const CSS_VARS = `
  :root {
    /* Brand Colors */
    --color-primary: #6366f1;
    --color-primary-light: #818cf8;
    --color-primary-dark: #4f46e5;
    --color-accent: #a78bfa;
    --color-accent-light: #c4b5fd;
    
    /* Hero Gradient */
    --gradient-hero: linear-gradient(135deg, #c4b5fd 0%, #818cf8 40%, #4f46e5 100%);
    --gradient-hero-deep: linear-gradient(135deg, #a78bfa 0%, #6366f1 50%, #312e81 100%);
    
    /* Neutrals */
    --color-bg: #fafafa;
    --color-surface: #ffffff;
    --color-text: #1f2937;
    --color-text-muted: #6b7280;
    --color-text-light: #9ca3af;
    --color-border: #e5e7eb;
    --color-border-light: #f3f4f6;
    
    /* Shadows */
    --shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
    --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    --shadow-filter: 0 4px 12px rgba(99, 102, 241, 0.15);
    --shadow-dropdown: 0 10px 40px rgba(0, 0, 0, 0.12);
    
    /* Border Radius */
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 14px;
    --radius-xl: 18px;
    --radius-full: 9999px;
    
    /* Spacing */
    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1rem;
    --space-5: 1.25rem;
    --space-6: 1.5rem;
    --space-8: 2rem;
    --space-10: 2.5rem;
    --space-12: 3rem;
    --space-16: 4rem;
    
    /* Typography */
    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-display: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    
    /* Transitions */
    --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
    --transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
    --transition-smooth: 300ms cubic-bezier(0.4, 0, 0.2, 1);
  }
`;

export const RESET_CSS = `
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  html {
    scroll-behavior: smooth;
    -webkit-text-size-adjust: 100%;
  }
  body {
    font-family: var(--font-sans);
    color: var(--color-text);
    background: var(--color-bg);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  a {
    color: inherit;
    text-decoration: none;
  }
  button {
    font: inherit;
    cursor: pointer;
    border: none;
    background: none;
  }
  img, svg {
    display: block;
    max-width: 100%;
  }
`;

export const NAV_CSS = `
  /* ===== Navigation Bar ===== */
  .nav {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    padding: var(--space-5) var(--space-6);
  }
  .nav__container {
    max-width: 1280px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .nav__logo {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 1.35rem;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.02em;
  }
  .nav__logo-icon {
    display: flex;
    align-items: center;
  }
  .nav__actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .nav__icon-btn {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    transition: all var(--transition-base);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .nav__icon-btn:hover {
    background: rgba(255, 255, 255, 0.25);
    transform: translateY(-1px);
  }
  .nav__icon-btn svg {
    width: 22px;
    height: 22px;
  }
  
  /* Hamburger Animation */
  .nav__hamburger {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    transition: all var(--transition-base);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .nav__hamburger:hover {
    background: rgba(255, 255, 255, 0.25);
  }
  .nav__hamburger.active {
    background: #ffffff;
    color: var(--color-primary);
  }
  .nav__hamburger svg {
    width: 22px;
    height: 22px;
    transition: transform var(--transition-smooth);
  }
  .nav__hamburger.active svg {
    transform: rotate(90deg);
  }
  
  /* Dropdown Menu */
  .nav__dropdown {
    position: absolute;
    top: calc(100% + var(--space-3));
    right: var(--space-6);
    width: 260px;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-dropdown);
    padding: var(--space-2);
    opacity: 0;
    visibility: hidden;
    transform: translateY(-8px);
    transition: all var(--transition-smooth);
  }
  .nav__dropdown.open {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }
  .nav__dropdown-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    color: var(--color-text);
    font-size: 0.95rem;
    font-weight: 500;
    transition: all var(--transition-fast);
  }
  .nav__dropdown-item svg {
    width: 20px;
    height: 20px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
  .nav__dropdown-item:hover {
    background: var(--color-border-light);
    color: var(--color-primary);
  }
  .nav__dropdown-item:hover svg {
    color: var(--color-primary);
  }
  .nav__dropdown-item--primary {
    background: var(--color-primary);
    color: #ffffff;
    margin-top: var(--space-2);
  }
  .nav__dropdown-item--primary svg {
    color: #ffffff;
  }
  .nav__dropdown-item--primary:hover {
    background: var(--color-primary-dark);
    color: #ffffff;
  }
  
  @media (max-width: 768px) {
    .nav {
      padding: var(--space-4);
    }
    .nav__dropdown {
      right: var(--space-4);
      width: calc(100% - var(--space-8));
    }
  }
`;

export const HERO_CSS = `
  /* ===== Hero Section ===== */
  .hero {
    position: relative;
    background: var(--gradient-hero-deep);
    min-height: 520px;
    padding: calc(80px + var(--space-10)) var(--space-6) var(--space-16);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .hero::before {
    content: '';
    position: absolute;
    top: -50%;
    left: -20%;
    width: 140%;
    height: 200%;
    background: radial-gradient(ellipse at 30% 20%, rgba(196, 181, 253, 0.3) 0%, transparent 50%),
                radial-gradient(ellipse at 70% 80%, rgba(99, 102, 241, 0.2) 0%, transparent 50%);
    pointer-events: none;
  }
  .hero__container {
    position: relative;
    z-index: 1;
    max-width: 760px;
    width: 100%;
    text-align: center;
  }
  .hero__title {
    font-family: var(--font-display);
    font-size: clamp(2rem, 5vw, 3.25rem);
    font-weight: 800;
    color: #ffffff;
    line-height: 1.15;
    letter-spacing: -0.03em;
    margin-bottom: var(--space-4);
  }
  .hero__subtitle {
    font-size: clamp(1rem, 2vw, 1.15rem);
    color: rgba(255, 255, 255, 0.85);
    font-weight: 400;
    margin-bottom: var(--space-8);
    line-height: 1.5;
  }
  
  /* ===== Search Box ===== */
  .search {
    position: relative;
    max-width: 600px;
    margin: 0 auto var(--space-8);
  }
  .search__box {
    display: flex;
    align-items: center;
    background: var(--color-surface);
    border-radius: var(--radius-full);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-5);
    box-shadow: var(--shadow-xl);
    transition: all var(--transition-base);
  }
  .search__box:focus-within {
    box-shadow: 0 20px 40px rgba(99, 102, 241, 0.25);
    transform: translateY(-2px);
  }
  .search__icon {
    color: var(--color-text-muted);
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }
  .search__icon svg {
    width: 22px;
    height: 22px;
  }
  .search__input {
    flex: 1;
    border: none;
    outline: none;
    font-size: 1rem;
    padding: var(--space-3) var(--space-4);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
  }
  .search__input::placeholder {
    color: var(--color-text-light);
  }
  .search__btn {
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    border-radius: var(--radius-full);
    background: var(--color-primary);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-base);
  }
  .search__btn:hover {
    background: var(--color-primary-dark);
    transform: scale(1.05);
  }
  .search__btn svg {
    width: 20px;
    height: 20px;
  }
  
  /* ===== Filter Bar ===== */
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    justify-content: center;
    max-width: 720px;
    margin: 0 auto;
  }
  .filter {
    position: relative;
  }
  .filter__btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-filter);
    color: var(--color-text);
    font-size: 0.9rem;
    font-weight: 500;
    transition: all var(--transition-base);
    border: 1px solid rgba(255, 255, 255, 0.3);
    white-space: nowrap;
  }
  .filter__btn:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
    border-color: var(--color-primary-light);
  }
  .filter__btn.active {
    background: var(--color-primary);
    color: #ffffff;
    border-color: var(--color-primary);
  }
  .filter__btn svg {
    width: 18px;
    height: 18px;
  }
  .filter__btn svg.chevron {
    width: 16px;
    height: 16px;
    transition: transform var(--transition-base);
  }
  .filter__btn.active svg.chevron {
    transform: rotate(180deg);
  }
  
  /* ===== Filter Dropdown ===== */
  .filter__dropdown {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 50%;
    transform: translateX(-50%) translateY(-8px);
    min-width: 220px;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-dropdown);
    padding: var(--space-2);
    opacity: 0;
    visibility: hidden;
    transition: all var(--transition-smooth);
    z-index: 50;
  }
  .filter__dropdown.open {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) translateY(0);
  }
  .filter__dropdown-title {
    padding: var(--space-2) var(--space-3);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .filter__dropdown-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text);
    font-size: 0.9rem;
    transition: all var(--transition-fast);
    cursor: pointer;
  }
  .filter__dropdown-item svg {
    width: 18px;
    height: 18px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
  .filter__dropdown-item:hover {
    background: rgba(167, 139, 250, 0.12);
    color: var(--color-primary);
  }
  .filter__dropdown-item:hover svg {
    color: var(--color-primary);
  }
  .filter__dropdown-item.selected {
    background: rgba(99, 102, 241, 0.1);
    color: var(--color-primary);
    font-weight: 500;
  }
  .filter__dropdown-item.selected svg {
    color: var(--color-primary);
  }
  
  @media (max-width: 768px) {
    .hero {
      min-height: auto;
      padding: calc(70px + var(--space-8)) var(--space-4) var(--space-10);
    }
    .filters {
      gap: var(--space-2);
    }
    .filter__btn {
      padding: var(--space-2) var(--space-3);
      font-size: 0.85rem;
    }
    .filter__dropdown {
      left: 0;
      transform: translateX(0) translateY(-8px);
      min-width: 200px;
    }
    .filter__dropdown.open {
      transform: translateX(0) translateY(0);
    }
  }
  
  @media (max-width: 480px) {
    .filter__btn span {
      display: none;
    }
    .filter__btn {
      padding: var(--space-2);
    }
  }
`;

export const SHARED_CSS = `
  ${CSS_VARS}
  ${RESET_CSS}
  ${NAV_CSS}
  ${HERO_CSS}
  
  /* ===== Common Layout ===== */
  .container {
    max-width: 1280px;
    margin: 0 auto;
    padding: 0 var(--space-6);
  }
  @media (max-width: 768px) {
    .container {
      padding: 0 var(--space-4);
    }
  }
  
  /* ===== Footer ===== */
  .footer {
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
    padding: var(--space-12) 0 var(--space-8);
  }
  .footer__grid {
    display: grid;
    grid-template-columns: 2fr repeat(3, 1fr);
    gap: var(--space-8);
    margin-bottom: var(--space-8);
  }
  @media (max-width: 768px) {
    .footer__grid {
      grid-template-columns: 1fr 1fr;
      gap: var(--space-6);
    }
  }
  @media (max-width: 480px) {
    .footer__grid {
      grid-template-columns: 1fr;
    }
  }
  .footer__brand {
    font-size: 0.9rem;
    color: var(--color-text-muted);
    line-height: 1.7;
  }
  .footer__title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: var(--space-4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .footer__links {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .footer__link {
    font-size: 0.9rem;
    color: var(--color-text-muted);
    transition: color var(--transition-fast);
  }
  .footer__link:hover {
    color: var(--color-primary);
  }
  .footer__bottom {
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-border);
    text-align: center;
    font-size: 0.85rem;
    color: var(--color-text-light);
  }
  
  /* ===== Utility ===== */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
`;

export default SHARED_CSS;
