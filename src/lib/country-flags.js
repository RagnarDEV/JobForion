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
