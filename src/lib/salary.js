// src/lib/salary.js
// ════════════════════════════════════════════════════════════════
// SINGLE SOURCE OF TRUTH for salary parsing. Before this file existed,
// four different places (components/job-card.js ×2, pages/job-page.js,
// routes/api.router.js, pages/admin/dashboard.js) each ran their own
// ad-hoc `parseInt(salary.replace(/\D/g,'').slice(0,3)) >= 150` — fragile,
// mutually inconsistent, and wrong for anything that isn't shaped exactly
// like "$XXXk - $YYYk" (e.g. "90,000 - 130,000 USD/year", "€70k", "$45/hr"
// all parsed incorrectly or not at all).
//
// parseSalary() is called ONCE per job, at sync time (see db/sync.js),
// and its result is stored in jobs.salary_min_usd / salary_max_usd.
// Every other place in the codebase should read those two columns
// instead of re-parsing the raw salary string — see the "hot" badge
// logic in job-card.js and job-page.js, and the salary_min filter in
// api.router.js, all updated to do exactly that.
// ════════════════════════════════════════════════════════════════

const CURRENCY_TO_USD = {
  '$': 1,
  '€': 1.08,
  '£': 1.27,
  'c$': 0.73,
  'a$': 0.66,
};

function detectCurrency(text) {
  const s = text.toLowerCase();
  if (s.includes('€') || /\beur\b/.test(s)) return '€';
  if (s.includes('£') || /\bgbp\b/.test(s)) return '£';
  if (/c\$|\bcad\b/.test(s)) return 'c$';
  if (/a\$|\baud\b/.test(s)) return 'a$';
  return '$'; // default assumption — the large majority of listings here are USD
}

function detectPeriod(text) {
  const s = text.toLowerCase();
  if (/\/\s*(hr|hour)\b|\bhourly\b/.test(s)) return 'hour';
  if (/\/\s*(mo|month)\b|\bmonthly\b/.test(s)) return 'month';
  if (/\/\s*(wk|week)\b|\bweekly\b/.test(s)) return 'week';
  return 'year'; // default — the large majority of listed salaries are annual
}

// Deliberately approximate (2080 working hours/year for hourly, 12 for
// monthly, 52 for weekly) — good enough for sorting/filtering/"hot"
// badges, not intended as a precise payroll conversion tool.
function toAnnualUsd(amount, currency, period) {
  const usdRate = CURRENCY_TO_USD[currency] ?? 1;
  let annual = amount * usdRate;
  if (period === 'hour') annual *= 2080;
  else if (period === 'month') annual *= 12;
  else if (period === 'week') annual *= 52;
  return Math.round(annual);
}

// Extracts numeric figures, correctly handling BOTH "90k" (k-suffix
// shorthand) and "90,000" (comma-grouped full number) in the same string.
// The old naive `match(/\d+/g)` read "$90,000 - $130,000" as four separate
// numbers ([90, 000, 130, 000]) instead of two ([90000, 130000]) — this
// treats a comma-grouped run of digits as one figure.
function extractFigures(text) {
  const matches = text.match(/\d[\d,]*\.?\d*\s*k?/gi) || [];
  return matches
    .map(m => {
      const isK = /k\s*$/i.test(m.trim());
      const num = parseFloat(m.replace(/[^\d.]/g, ''));
      if (Number.isNaN(num)) return null;
      return isK ? num * 1000 : num;
    })
    .filter(n => n !== null && n > 0);
}

// Never throws — always returns this shape, with every field `null` if
// the string couldn't be parsed at all (e.g. "Competitive", "DOE", "").
export function parseSalary(raw) {
  const empty = { min: null, max: null, currency: null, period: null, annualMinUsd: null, annualMaxUsd: null };
  if (!raw || typeof raw !== 'string') return empty;
  const text = raw.trim();
  if (!text) return empty;

  const figures = extractFigures(text);
  if (!figures.length) return empty;

  const currency = detectCurrency(text);
  const period = detectPeriod(text);
  const min = figures[0];
  const max = figures.length > 1 ? figures[figures.length - 1] : figures[0];
  // Real salary figures are essentially never below 1000 once written out
  // in full, regardless of currency/period — guards against a stray
  // small number (e.g. a misplaced "5" from "5+ years") being read as a
  // salary figure.
  if (min < 1 || max < 1) return empty;

  return {
    min, max, currency, period,
    annualMinUsd: toAnnualUsd(min, currency, period),
    annualMaxUsd: toAnnualUsd(max, currency, period),
  };
}

// ════════════════════════════════════════════════════════════════
// extractSalaryFromDescription() — ROOT-CAUSE FIX for salary badges
// being empty on almost every synced job. None of the 9 ATS providers
// (see src/providers/*.js) expose a dedicated, structured salary field
// in their public job-board APIs — every provider's map() hardcodes
// `salary: ''`, because there is genuinely nothing to read there. When a
// salary IS disclosed, it's written as free text somewhere inside the
// job description ("Compensation: $90,000 - $120,000/year").
//
// This scans that description text for a salary-looking substring and
// returns it as a plain string — the SAME shape parseSalary() above
// already expects, so db/sync.js just does:
//   j.salary = j.salary || extractSalaryFromDescription(j.description)
// before its existing `parseSalary(j.salary)` call, with zero changes
// needed to parseSalary() itself or anything downstream that reads
// jobs.salary / salary_min_usd / salary_max_usd.
//
// Deliberately conservative: returns null (no badge shown) rather than
// guess wrong. A currency symbol is the strongest, least ambiguous
// signal a nearby number is actually a salary (as opposed to a
// headcount, a founding year, or "5+ years experience") — that's tried
// first. The secondary pattern only fires next to an explicit
// salary/compensation/pay label, for the (less common) postings that
// state a range in words without a currency symbol.
// ════════════════════════════════════════════════════════════════
const CURRENCY_RANGE_RE = /[$€£]\s?\d[\d,]*\.?\d*\s?[kK]?(?:\s*(?:-|–|—|to)\s*[$€£]?\s?\d[\d,]*\.?\d*\s?[kK]?)?/;
const LABELED_RANGE_RE = /(?:salary|compensation|pay\s*range)[^.\n]{0,40}?(\d[\d,]*\.?\d*\s?[kK]?(?:\s*(?:-|–|—|to)\s*\d[\d,]*\.?\d*\s?[kK]?)?\s?(?:usd|eur|gbp|per\s?year|annually|\/\s?yr)?)/i;

export function extractSalaryFromDescription(text) {
  if (!text) return null;
  const plain = String(text).replace(/<[^>]+>/g, ' ');
  const trimPunctuation = (s) => s.trim().replace(/[.,;:]+$/, '');

  const currencyMatch = plain.match(CURRENCY_RANGE_RE);
  if (currencyMatch) return trimPunctuation(currencyMatch[0]);

  const labeledMatch = plain.match(LABELED_RANGE_RE);
  if (labeledMatch) return trimPunctuation(labeledMatch[1]);

  return null;
}
