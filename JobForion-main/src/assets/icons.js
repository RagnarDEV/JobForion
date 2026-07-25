// src/assets/icons.js
// Minimal inline SVG icon set replacing emoji across the site — Lucide-style
// (stroke-based line icons, 24x24 viewBox, currentColor so each icon
// inherits whatever color/size its surrounding CSS sets). No external
// library, no extra network request: every icon is a plain string
// function, safe to drop straight into any HTML template literal.
//
// Usage: iconMapPin() or iconMapPin({ size: 12, cls: 'my-class' })

function svg(paths, { size = 14, cls = '', strokeWidth = 2, fill = false } = {}) {
  const fillAttr = fill ? 'currentColor' : 'none';
  const strokeAttr = fill ? 'none' : 'currentColor';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="icon ${cls}" aria-hidden="true" style="display:inline-block;vertical-align:-2px;flex-shrink:0">${paths}</svg>`;
}

// Used for the "NEW" badge — filled 4-point sparkle.
export const iconSparkle = (opts) => svg(`<path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"/>`, { fill: true, ...opts });

// Used for the "HOT" badge.
export const iconFlame = (opts) => svg(`<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`, { fill: true, ...opts });

// Used for the "Pinned" badge (thumbtack — distinct from the map pin below).
export const iconPin = (opts) => svg(`<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>`, opts);

// Location badge.
export const iconMapPin = (opts) => svg(`<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>`, opts);

// Save/bookmark button.
export const iconBookmark = (opts) => svg(`<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>`, opts);

// Share/copy-link button.
export const iconLink = (opts) => svg(`<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>`, opts);

// Card arrow / "View" affordance.
export const iconArrowRight = (opts) => svg(`<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>`, opts);

// "Verified" checkmark next to company name.
export const iconBadgeCheck = (opts) => svg(`<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>`, opts);

// Posted-time footer.
export const iconClock = (opts) => svg(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`, opts);

// Remote-type tag: fully remote.
export const iconGlobe = (opts) => svg(`<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>`, opts);

// Remote-type tag: hybrid / on-site.
export const iconBuilding = (opts) => svg(`<path d="M6 22V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v18"/><path d="M6 12H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"/><path d="M18 9h2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>`, opts);

export const iconSearch = (opts) => svg(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`, opts);
export const iconX = (opts) => svg(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`, opts);
export const iconFilter = (opts) => svg(`<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>`, opts);
export const iconBell = (opts) => svg(`<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>`, opts);
export const iconCheck = (opts) => svg(`<path d="M20 6 9 17l-5-5"/>`, opts);
export const iconInfo = (opts) => svg(`<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`, opts);
export const iconAlertTriangle = (opts) => svg(`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>`, opts);
export const iconMenu = (opts) => svg(`<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>`, opts);
export const iconFolder = (opts) => svg(`<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`, opts);
export const iconFileText = (opts) => svg(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`, opts);
export const iconPlus = (opts) => svg(`<path d="M5 12h14"/><path d="M12 5v14"/>`, opts);
export const iconLock = (opts) => svg(`<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`, opts);
export const iconDollarSign = (opts) => svg(`<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`, opts);
