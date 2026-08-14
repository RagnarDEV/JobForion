// src/lib/category-icons.js
// ════════════════════════════════════════════════════════════════
// Maps a category `key` to a Lucide-style SVG icon function (see
// src/assets/icons.js), for surfaces that want the site's consistent
// monochrome icon system instead of the admin-editable emoji field.
//
// WHY THIS CAN'T BE FULLY DYNAMIC: categories are admin-creatable with
// an arbitrary key (see lib/categories.js) and an arbitrary emoji the
// admin types in — there is no reliable way to turn free-typed emoji
// into a matching SVG icon. So this covers the 13 built-in categories
// the site ships with by name, and anything else (a category an admin
// adds later with a key this map doesn't recognize) safely falls back
// to a generic tag icon — never a crash, never a blank spot.
//
// Scope: currently used only by the homepage's "Browse by Category"
// grid (see pages/home.js) — the emoji field itself is untouched
// everywhere else (admin category editor, /categories index, job
// detail chips, etc.), so this is additive, not a replacement of the
// existing emoji system.
// ════════════════════════════════════════════════════════════════

import {
  iconCode, iconPalette, iconMegaphone, iconBarChart3, iconSettingsGear,
  iconEdit3, iconBriefcase, iconHeadphones, iconPackage, iconDollarSign,
  iconUsers, iconBadgeCheck, iconTag,
} from '../assets/icons.js';

const CATEGORY_ICON_MAP = {
  developer: iconCode,
  designer: iconPalette,
  marketing: iconMegaphone,
  data: iconBarChart3,
  devops: iconSettingsGear,
  writer: iconEdit3,
  sales: iconBriefcase,
  support: iconHeadphones,
  product: iconPackage,
  finance: iconDollarSign,
  recruit: iconUsers,
  quality: iconBadgeCheck,
  manager: iconUsers,
};

// Returns ready-to-embed SVG markup (string) for a category key, sized
// and styled via `opts` exactly like any other icon in assets/icons.js.
export function categoryIconSvg(key, opts = {}) {
  const iconFn = CATEGORY_ICON_MAP[key] || iconTag;
  return iconFn(opts);
}
