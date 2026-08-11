// src/lib/geo-data.js
// ════════════════════════════════════════════════════════════════
// Lightweight canonicalization dictionary for free-text location strings
// coming from job providers (e.g. "Austin, TX", "Remote - US", "London, UK",
// "Bengaluru, Karnataka, India"). This does NOT replace the existing
// manual /admin/directory override system (lib/directory-overrides.js) —
// admins can still rename/merge anything by hand. This file exists to
// shrink how MUCH manual cleanup is needed in the first place, by
// resolving the most common, unambiguous aliases automatically before a
// human ever has to look at it.
//
// Deliberately NOT exhaustive (no full ISO-3166 country list, no full
// US Census place database) — covers the aliases that actually show up
// repeatedly in ATS location fields. Anything not covered here still
// falls through to the original heuristic (see lib/entities.js's
// splitLocation), unchanged from before this file existed.
// ════════════════════════════════════════════════════════════════

// Common country-name aliases → canonical display name.
export const COUNTRY_ALIASES = {
  'usa': 'United States', 'us': 'United States', 'u.s.': 'United States',
  'u.s.a.': 'United States', 'united states of america': 'United States',
  'uk': 'United Kingdom', 'u.k.': 'United Kingdom', 'great britain': 'United Kingdom',
  'england': 'United Kingdom',
  'uae': 'United Arab Emirates', 'u.a.e.': 'United Arab Emirates',
  'south korea': 'South Korea', 'korea': 'South Korea', 'republic of korea': 'South Korea',
  'czechia': 'Czech Republic',
  'netherlands': 'Netherlands', 'the netherlands': 'Netherlands', 'holland': 'Netherlands',
  'russia': 'Russia', 'russian federation': 'Russia',
  'vietnam': 'Vietnam', 'viet nam': 'Vietnam',
};

// US state abbreviations + full names → canonical full name. Used to
// detect "this last location segment is a US STATE, not a country" so
// splitLocation() can correctly report region = "United States" instead
// of e.g. "TX" being treated as its own top-level "country" in the
// /countries directory.
export const US_STATES = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California',
  co: 'Colorado', ct: 'Connecticut', de: 'Delaware', fl: 'Florida', ga: 'Georgia',
  hi: 'Hawaii', id: 'Idaho', il: 'Illinois', in: 'Indiana', ia: 'Iowa',
  ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana', me: 'Maine', md: 'Maryland',
  ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota', ms: 'Mississippi', mo: 'Missouri',
  mt: 'Montana', ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire', nj: 'New Jersey',
  nm: 'New Mexico', ny: 'New York', nc: 'North Carolina', nd: 'North Dakota', oh: 'Ohio',
  ok: 'Oklahoma', or: 'Oregon', pa: 'Pennsylvania', ri: 'Rhode Island', sc: 'South Carolina',
  sd: 'South Dakota', tn: 'Tennessee', tx: 'Texas', ut: 'Utah', vt: 'Vermont',
  va: 'Virginia', wa: 'Washington', wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming',
  dc: 'District of Columbia',
};
const US_STATE_FULL_NAMES = new Set(Object.values(US_STATES).map(s => s.toLowerCase()));

// Resolves a single trailing location segment (whatever splitLocation()
// currently treats as "region") to a canonical value. Returns the input
// unchanged if nothing in the dictionary matches — never throws, never
// returns empty for non-empty input.
export function canonicalizeRegion(raw) {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const key = trimmed.toLowerCase().replace(/\.$/, '');

  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  if (US_STATES[key]) return 'United States';
  if (US_STATE_FULL_NAMES.has(key)) return 'United States';

  return trimmed;
}
