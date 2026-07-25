// src/assets/icons.js
// Lucide-style SVG icons — pure SVG, no external library

const iconAttrs = (size = 24) => ({
  xmlns: 'http://www.w3.org/2000/svg',
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round'
});

const svgWrap = (paths, size) => {
  const attrs = Object.entries(iconAttrs(size))
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  return `<svg ${attrs}>${paths}</svg>`;
};

// ===== Navigation & UI =====
export const MenuIcon = (size = 24) => svgWrap(`
  <line x1="4" y1="6" x2="20" y2="6"/>
  <line x1="4" y1="12" x2="20" y2="12"/>
  <line x1="4" y1="18" x2="20" y2="18"/>
`, size);

export const XIcon = (size = 24) => svgWrap(`
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
`, size);

export const ChevronDownIcon = (size = 24) => svgWrap(`
  <polyline points="6 9 12 15 18 9"/>
`, size);

export const ChevronRightIcon = (size = 24) => svgWrap(`
  <polyline points="9 18 15 12 9 6"/>
`, size);

// ===== Search =====
export const SearchIcon = (size = 24) => svgWrap(`
  <circle cx="11" cy="11" r="8"/>
  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
`, size);

// ===== Jobs & Categories =====
export const BriefcaseIcon = (size = 24) => svgWrap(`
  <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
`, size);

export const FolderIcon = (size = 24) => svgWrap(`
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
`, size);

// ===== Companies & Buildings =====
export const Building2Icon = (size = 24) => svgWrap(`
  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
  <path d="M10 6h4"/>
  <path d="M10 10h4"/>
  <path d="M10 14h4"/>
  <path d="M10 18h4"/>
`, size);

// ===== Countries & Globe =====
export const GlobeIcon = (size = 24) => svgWrap(`
  <circle cx="12" cy="12" r="10"/>
  <line x1="2" y1="12" x2="22" y2="12"/>
  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
`, size);

// ===== Experience & Awards =====
export const AwardIcon = (size = 24) => svgWrap(`
  <circle cx="12" cy="8" r="7"/>
  <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
`, size);

// ===== Employment Type =====
export const ClockIcon = (size = 24) => svgWrap(`
  <circle cx="12" cy="12" r="10"/>
  <polyline points="12 6 12 12 16 14"/>
`, size);

// ===== Navigation Menu Items =====
export const HomeIcon = (size = 24) => svgWrap(`
  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
  <polyline points="9 22 9 12 15 12 15 22"/>
`, size);

export const CompassIcon = (size = 24) => svgWrap(`
  <circle cx="12" cy="12" r="10"/>
  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
`, size);

export const UsersIcon = (size = 24) => svgWrap(`
  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
  <circle cx="9" cy="7" r="4"/>
  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
`, size);

export const TagIcon = (size = 24) => svgWrap(`
  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
  <line x1="7" y1="7" x2="7.01" y2="7"/>
`, size);

export const FileTextIcon = (size = 24) => svgWrap(`
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="16" y1="13" x2="8" y2="13"/>
  <line x1="16" y1="17" x2="8" y2="17"/>
  <polyline points="10 9 9 9 8 9"/>
`, size);

export const MailIcon = (size = 24) => svgWrap(`
  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
  <polyline points="22,6 12,13 2,6"/>
`, size);

export const PlusCircleIcon = (size = 24) => svgWrap(`
  <circle cx="12" cy="12" r="10"/>
  <line x1="12" y1="8" x2="12" y2="16"/>
  <line x1="8" y1="12" x2="16" y2="12"/>
`, size);

// ===== Logo Icon =====
export const LogoIcon = (size = 28) => {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
    <path d="M12 2L2 7l10 5 10-5-10-5z" fill="url(#logoGrad1)"/>
    <path d="M2 17l10 5 10-5" stroke="url(#logoGrad2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M2 12l10 5 10-5" stroke="url(#logoGrad3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <defs>
      <linearGradient id="logoGrad1" x1="2" y1="2" x2="22" y2="12">
        <stop offset="0%" stop-color="#a78bfa"/>
        <stop offset="100%" stop-color="#6366f1"/>
      </linearGradient>
      <linearGradient id="logoGrad2" x1="2" y1="17" x2="22" y2="22">
        <stop offset="0%" stop-color="#a78bfa"/>
        <stop offset="100%" stop-color="#6366f1"/>
      </linearGradient>
      <linearGradient id="logoGrad3" x1="2" y1="12" x2="22" y2="17">
        <stop offset="0%" stop-color="#c4b5fd"/>
        <stop offset="100%" stop-color="#818cf8"/>
      </linearGradient>
    </defs>
  </svg>`;
};
