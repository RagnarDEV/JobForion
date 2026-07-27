// src/lib/country-flags.js
// Best-effort country-name → flag-emoji lookup for location strings that
// originate as free text from external job APIs and employer submissions
// (see splitLocation() in lib/entities.js — countries/regions are derived
// heuristically from the free-text `jobs.location` column, there is no
// normalized ISO country table anywhere in the schema).
//
// This is NOT a full ISO 3166 dataset — it covers the country names and
// common aliases actually seen in remote job listings (the values that
// come out of splitLocation()/listCountries()). Anything unmatched or
// inherently ambiguous (e.g. "Remote", "Worldwide", a bare US state
// abbreviation picked up by the location-splitting heuristic) falls back
// to a neutral globe emoji rather than guessing and showing a wrong flag.

const COUNTRY_TO_ISO = {
  'united states': 'US', 'usa': 'US', 'us': 'US', 'u.s.': 'US', 'u.s.a.': 'US',
  'united kingdom': 'GB', 'uk': 'GB', 'u.k.': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
  'canada': 'CA',
  'germany': 'DE',
  'france': 'FR',
  'spain': 'ES',
  'italy': 'IT',
  'portugal': 'PT',
  'netherlands': 'NL', 'the netherlands': 'NL', 'holland': 'NL',
  'belgium': 'BE',
  'switzerland': 'CH',
  'austria': 'AT',
  'ireland': 'IE',
  'poland': 'PL',
  'sweden': 'SE',
  'norway': 'NO',
  'denmark': 'DK',
  'finland': 'FI',
  'iceland': 'IS',
  'greece': 'GR',
  'romania': 'RO',
  'bulgaria': 'BG',
  'ukraine': 'UA',
  'russia': 'RU',
  'czech republic': 'CZ', 'czechia': 'CZ',
  'hungary': 'HU',
  'slovakia': 'SK',
  'slovenia': 'SI',
  'croatia': 'HR',
  'serbia': 'RS',
  'estonia': 'EE',
  'latvia': 'LV',
  'lithuania': 'LT',
  'luxembourg': 'LU',
  'malta': 'MT',
  'cyprus': 'CY',
  'india': 'IN',
  'pakistan': 'PK',
  'bangladesh': 'BD',
  'sri lanka': 'LK',
  'nepal': 'NP',
  'philippines': 'PH',
  'indonesia': 'ID',
  'vietnam': 'VN', 'viet nam': 'VN',
  'thailand': 'TH',
  'malaysia': 'MY',
  'singapore': 'SG',
  'china': 'CN',
  'japan': 'JP',
  'south korea': 'KR', 'korea': 'KR',
  'taiwan': 'TW',
  'hong kong': 'HK',
  'israel': 'IL',
  'turkey': 'TR', 'türkiye': 'TR',
  'united arab emirates': 'AE', 'uae': 'AE',
  'saudi arabia': 'SA',
  'qatar': 'QA',
  'kuwait': 'KW',
  'egypt': 'EG',
  'morocco': 'MA',
  'tunisia': 'TN',
  'nigeria': 'NG',
  'kenya': 'KE',
  'south africa': 'ZA',
  'ghana': 'GH',
  'ethiopia': 'ET',
  'uganda': 'UG',
  'jordan': 'JO',
  'lebanon': 'LB',
  'australia': 'AU',
  'new zealand': 'NZ',
  'brazil': 'BR',
  'mexico': 'MX',
  'argentina': 'AR',
  'chile': 'CL',
  'colombia': 'CO',
  'peru': 'PE',
  'uruguay': 'UY',
  'ecuador': 'EC',
  'costa rica': 'CR',
  'panama': 'PA',
  'venezuela': 'VE',
};

// Regional Indicator Symbol conversion: a flag emoji is two Unicode
// "Regional Indicator Symbol" characters, one per ISO 3166-1 alpha-2
// letter (A→🇦 offset +127397 from ASCII 'A', etc.).
function isoToFlagEmoji(iso) {
  if (!iso || iso.length !== 2) return null;
  const codePoints = [...iso.toUpperCase()].map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export function countryFlag(name) {
  if (!name) return '🌍';
  const key = name.trim().toLowerCase();
  if (/^(remote|worldwide|anywhere|global)$/.test(key)) return '🌍';
  const iso = COUNTRY_TO_ISO[key];
  if (!iso) return '🌍';
  return isoToFlagEmoji(iso) || '🌍';
}

// ── Reusable country-confidence helpers ─────────────────────────────
// Used by pages/job-page.js to decide whether a job's free-text
// `location` value is trustworthy enough to publish as structured data
// (schema.org JobPosting.jobLocation requires a real PostalAddress with
// addressCountry) — publishing a wrong guess is worse than omitting the
// field entirely, so callers should only use these to confirm, not infer.

// Is `name` one of the countries this file already recognizes?
export function isKnownCountry(name) {
  if (!name) return false;
  return name.trim().toLowerCase() in COUNTRY_TO_ISO;
}

// ISO 3166-1 alpha-2 code for a recognized country name, or null.
export function countryIso(name) {
  if (!name) return null;
  return COUNTRY_TO_ISO[name.trim().toLowerCase()] || null;
}

// US state/territory postal abbreviations — by far the most common
// non-country value seen in the free-text `location` column (e.g.
// "Austin, TX"), since many US-sourced listings only capture the state,
// not "United States" explicitly. Recognizing these lets us still
// publish valid, honest structured data (addressCountry: US,
// addressRegion: TX) for this large bucket of jobs instead of omitting
// jobLocation for all of them.
export const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
]);
