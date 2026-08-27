// src/lib/hot-pay.js
// Single source of truth for high-salary classification. It consumes the
// normalized annual USD columns persisted on jobs whenever they exist, and
// only falls back to the shared salary parser for legacy rows.

import { parseSalary, extractSalaryFromDescription } from './salary.js';
import { classifySalary } from './salary-tier.js';

export const DEFAULT_HOT_PAY_THRESHOLD_USD = 150000;
export const HOT_PAY_LABEL = 'HOT PAY';

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function hotPayThresholdUsd(settings = {}) {
  const configured = finiteNonNegative(settings?.hot_pay_threshold_usd);
  return configured === null ? DEFAULT_HOT_PAY_THRESHOLD_USD : Math.min(configured, 1000000000);
}

export function normalizeAnnualSalary(job = {}) {
  // -1 is the existing backfill sentinel for "checked but unparseable" and
  // must never be treated as a real salary or retried with a fragile regex.
  const storedMin = finiteNonNegative(job.salary_min_usd);
  const storedMax = finiteNonNegative(job.salary_max_usd);
  if (storedMin !== null || storedMax !== null) {
    return { annualMinUsd: storedMin, annualMaxUsd: storedMax };
  }
  if (job.salary_min_usd !== null && job.salary_min_usd !== undefined && Number(job.salary_min_usd) < 0) return null;
  if (job.salary_max_usd !== null && job.salary_max_usd !== undefined && Number(job.salary_max_usd) < 0) return null;

  const rawSalary = job.salary || extractSalaryFromDescription(job.description);
  const parsed = parseSalary(rawSalary);
  if (parsed.annualMinUsd === null || parsed.annualMaxUsd === null) return null;
  return { annualMinUsd: parsed.annualMinUsd, annualMaxUsd: parsed.annualMaxUsd };
}

export function normalizedHotPayValue(annual) {
  if (!annual) return null;
  const min = finiteNonNegative(annual.annualMinUsd);
  const max = finiteNonNegative(annual.annualMaxUsd);
  // A disclosed minimum is the safest signal. For a genuine range, use its
  // midpoint rather than the maximum, avoiding false HOT PAY labels based on
  // the top of a broad range. A maximum is used only when no minimum exists.
  if (min !== null && max !== null) return min === max ? min : (min + max) / 2;
  if (min !== null) return min;
  if (max !== null) return max;
  return null;
}

export function isHotPayJob(job = {}, settings = {}) {
  if (settings?.hot_pay_enabled === '0' || settings?.hot_pay_enabled === false) return false;
  const value = normalizedHotPayValue(normalizeAnnualSalary(job));
  return value !== null && value >= hotPayThresholdUsd(settings);
}

export function annotateHotPay(jobs, settings = {}) {
  return (Array.isArray(jobs) ? jobs : []).map(job => {
    const salaryClassification = classifySalary(job, settings);
    return {
      ...job,
      salary_tier: salaryClassification.tier,
      salary_tier_confidence: salaryClassification.confidence,
      isHotPay: isHotPayJob(job, settings),
    };
  });
}

// Listing queries intentionally omit the large description column. For old
// rows whose salary was disclosed only inside that description, fetch all
// missing sources in one bounded IN query (never one query per job), then use
// the same classifier as every other render surface.
export async function hydrateHotPay(env, jobs, settings = {}) {
  const input = Array.isArray(jobs) ? jobs : [];
  const missingIds = input
    .filter(job => job && !job.salary && !job.description && job.id !== null && job.id !== undefined)
    .map(job => Number(job.id))
    .filter(id => Number.isInteger(id) && id > 0);
  if (!missingIds.length) return annotateHotPay(input, settings);

  const uniqueIds = [...new Set(missingIds)].slice(0, 100);
  try {
    const placeholders = uniqueIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, salary, description, salary_min_usd, salary_max_usd FROM jobs WHERE id IN (${placeholders})`
    ).bind(...uniqueIds).all();
    const byId = new Map((results || []).map(row => [Number(row.id), row]));
    return annotateHotPay(input.map(job => ({ ...job, ...(byId.get(Number(job.id)) || {}) })), settings);
  } catch (e) {
    return annotateHotPay(input, settings);
  }
}
