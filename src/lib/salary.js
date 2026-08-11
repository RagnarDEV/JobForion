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
