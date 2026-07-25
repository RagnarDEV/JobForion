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

// ===== Navigation & UI Icons =====
export const Menu = (size = 24) => svgWrap(`
  <line x1="4" y1="6" x2="20" y2="6"/>
  <line x1="4" y1="12" x2="20" y2="12"/>
  <line x1="4" y1="18" x2="20" y2="18"/>
`, size);

export const X = (size = 24) => svgWrap(`
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
`, size);

export const ChevronDown = (size = 24) => svgWrap(`
  <polyline points="6 9 12 15 18 9"/>
`, size);

export const ChevronRight = (size = 24) => svgWrap(`
  <polyline points="9 18 15 12 9 6"/>
`, size);

// ===== Search =====
export const Search = (size = 24) => svgWrap(`
  <circle cx="11" cy="11" r="8"/>
  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
`, size);

// ===== Jobs & Categories =====
export const Briefcase = (size = 24) => svgWrap(`
  <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
`, size);

export const Folder = (size = 24) => svgWrap(`
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
`, size);

// ===== Companies & Buildings =====
export const Building2 = (size = 24) => svgWrap(`
  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
  <path d="M10 6h4"/>
  <path d="M10 10h4"/>
  <path d="M10 14h4"/>
  <path d="M10 18h4"/>
`, size);

export const Building = (size = 24) => svgWrap(`
  <rect x="4" y="2" width="16" height="20" rx="2" ry="2"/>
  <path d="M9 22v-4h6v4"/>
  <path d="M8 6h.01"/>
  <path d="M16 6h.01"/>
  <path d="M8 10h.01"/>
  <path d="M16 10h.01"/>
  <path d="M8 14h.01"/>
  <path d="M16 14h.01"/>
  <path d="M8 18h.01"/>
  <path d="M16 18h.01"/>
`, size);

// ===== Countries & Globe =====
export const Globe = (size = 24) => svgWrap(`
  <circle cx="12" cy="12" r="10"/>
  <line x1="2" y1="12" x2="22" y2="12"/>
  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
`, size);

// ===== Experience & Awards =====
export const Award = (size = 24) => svgWrap(`
  <circle cx="12" cy="8" r="7"/>
  <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
`, size);

// ===== Employment Type =====
export const Clock = (size = 24) => svgWrap(`
  <circle cx="12" cy="12" r="10"/>
  <polyline points="12 6 12 12 16 14"/>
`, size);

// ===== Navigation Menu Items =====
export const Home = (size = 24) => svgWrap(`
  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
  <polyline points="9 22 9 12 15 12 15 22"/>
`, size);

export const Compass = (size = 24) => svgWrap(`
  <circle cx="12" cy="12" r="10"/>
  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
`, size);

export const Users = (size = 24) => svgWrap(`
  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
  <circle cx="9" cy="7" r="4"/>
  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
`, size);

export const Tag = (size = 24) => svgWrap(`
  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
  <line x1="7" y1="7" x2="7.01" y2="7"/>
`, size);

export const FileText = (size = 24) => svgWrap(`
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="16" y1="13" x2="8" y2="13"/>
  <line x1="16" y1="17" x2="8" y2="17"/>
  <polyline points="10 9 9 9 8 9"/>
`, size);

export const Mail = (size = 24) => svgWrap(`
  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
  <polyline points="22,6 12,13 2,6"/>
`, size);

export const PlusCircle = (size = 24) => svgWrap(`
  <circle cx="12" cy="12" r="10"/>
  <line x1="12" y1="8" x2="12" y2="16"/>
  <line x1="8" y1="12" x2="16" y2="12"/>
`, size);

// ===== Logo =====
export const Logo = (size = 28) => {
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

// ===== Job Card & Job Page Icons =====
export const iconSparkle = (size = 24) => svgWrap(`
  <path d="M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5L12 3Z"/>
`, size);

export const iconFlame = (size = 24) => svgWrap(`
  <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
`, size);

export const iconPin = (size = 24) => svgWrap(`
  <path d="M12 17v5"/>
  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a3 3 0 1 0-6 0v3.76z"/>
`, size);

export const iconMapPin = (size = 24) => svgWrap(`
  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
  <circle cx="12" cy="10" r="3"/>
`, size);

export const iconBadgeCheck = (size = 24) => svgWrap(`
  <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.78 4.78 4 4 0 0 1-6.74 0 4 4 0 0 1-4.78-4.78 4 4 0 0 1 0-6.74z"/>
  <path d="m9 12 2 2 4-4"/>
`, size);

export const iconDollarSign = (size = 24) => svgWrap(`
  <line x1="12" y1="1" x2="12" y2="23"/>
  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
`, size);

export const iconBookmark = (size = 24) => svgWrap(`
  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
`, size);

export const iconLink = (size = 24) => svgWrap(`
  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
`, size);

// ===== Additional Common Icons =====
export const DollarSign = (size = 24) => svgWrap(`
  <line x1="12" y1="1" x2="12" y2="23"/>
  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
`, size);

export const ArrowRight = (size = 24) => svgWrap(`
  <line x1="5" y1="12" x2="19" y2="12"/>
  <polyline points="12 5 19 12 12 19"/>
`, size);

export const MapPin = (size = 24) => svgWrap(`
  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
  <circle cx="12" cy="10" r="3"/>
`, size);

export const Calendar = (size = 24) => svgWrap(`
  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
  <line x1="16" y1="2" x2="16" y2="6"/>
  <line x1="8" y1="2" x2="8" y2="6"/>
  <line x1="3" y1="10" x2="21" y2="10"/>
`, size);

export const ExternalLink = (size = 24) => svgWrap(`
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
  <polyline points="15 3 21 3 21 9"/>
  <line x1="10" y1="14" x2="21" y2="3"/>
`, size);

export const Star = (size = 24) => svgWrap(`
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
`, size);

export const Filter = (size = 24) => svgWrap(`
  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
`, size);

export const Check = (size = 24) => svgWrap(`
  <polyline points="20 6 9 17 4 12"/>
`, size);

export const Loader = (size = 24) => svgWrap(`
  <line x1="12" y1="2" x2="12" y2="6"/>
  <line x1="12" y1="18" x2="12" y2="22"/>
  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
  <line x1="2" y1="12" x2="6" y2="12"/>
  <line x1="18" y1="12" x2="22" y2="12"/>
  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
  <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
`, size);

// ===== Aliases for backward compatibility =====
// These ensure old imports still work
export const iconArrowRight = ChevronRight;
export const iconChevronDown = ChevronDown;
export const iconSearch = Search;
export const iconMenu = Menu;
export const iconX = X;
export const iconBriefcase = Briefcase;
export const iconFolder = Folder;
export const iconBuilding2 = Building2;
export const iconBuilding = Building;
export const iconGlobe = Globe;
export const iconAward = Award;
export const iconClock = Clock;
export const iconHome = Home;
export const iconCompass = Compass;
export const iconUsers = Users;
export const iconTag = Tag;
export const iconFileText = FileText;
export const iconMail = Mail;
export const iconPlusCircle = PlusCircle;
export const iconLogo = Logo;
