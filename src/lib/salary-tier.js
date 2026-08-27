// Central salary-tier classification. This module consumes the existing normalized
// annual USD values from lib/salary.js and never reads presentation labels from D1.
// The initial thresholds are annual USD baselines; regional cost-of-living rules can
// be added later without changing the public enum or frontend components.

import { parseSalary, extractSalaryFromDescription } from './salary.js';

export const SALARY_TIERS = Object.freeze(['HIGH', 'GOOD', 'STANDARD', 'UNKNOWN']);
export const SALARY_CONFIDENCE = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);
export const DEFAULT_SALARY_TIER_HIGH_MIN_USD = 120000;
export const DEFAULT_SALARY_TIER_GOOD_MIN_USD = 70000;
export const MAX_REASONABLE_ANNUAL_USD = 10000000;

const finitePositive = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function boundedThreshold(value, fallback) {
  const n = finitePositive(value);
  return n === null ? fallback : Math.min(Math.round(n), MAX_REASONABLE_ANNUAL_USD);
}

export function salaryTierThresholds(settings = {}) {
  const high = boundedThreshold(settings.salary_tier_high_min_usd, DEFAULT_SALARY_TIER_HIGH_MIN_USD);
  const configuredGood = boundedThreshold(settings.salary_tier_good_min_usd, DEFAULT_SALARY_TIER_GOOD_MIN_USD);
  return {
    highMinUsd: high,
    goodMinUsd: Math.min(configuredGood, high),
  };
}

function normalizedComparableValue(parsed) {
  if (!parsed || parsed.reason !== 'parsed') return null;
  const min = finitePositive(parsed.annualMinUsd);
  const max = finitePositive(parsed.annualMaxUsd);
  if (min === null && max === null) return null;
  const value = min !== null && max !== null ? (min + max) / 2 : (min ?? max);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_REASONABLE_ANNUAL_USD) return null;
  return Math.round(value);
}

function confidenceFor(parsed) {
  if (!parsed || parsed.reason !== 'parsed') return 'LOW';
  if (parsed.currencyExplicit && parsed.periodExplicit && parsed.annualMinUsd !== parsed.annualMaxUsd) return 'HIGH';
  if (parsed.currencyExplicit || parsed.periodExplicit || parsed.annualMinUsd !== parsed.annualMaxUsd) return 'MEDIUM';
  return 'LOW';
}

export function classifySalaryFromParsed(parsed, settings = {}) {
  const normalizedAnnualSalary = normalizedComparableValue(parsed);
  if (normalizedAnnualSalary === null) {
    return { tier: 'UNKNOWN', normalizedAnnualSalary: null, confidence: 'LOW', reason: parsed?.reason || 'missing_or_invalid' };
  }
  const { highMinUsd, goodMinUsd } = salaryTierThresholds(settings);
  const tier = normalizedAnnualSalary >= highMinUsd ? 'HIGH' : normalizedAnnualSalary >= goodMinUsd ? 'GOOD' : 'STANDARD';
  return { tier, normalizedAnnualSalary, confidence: confidenceFor(parsed), reason: 'normalized_annual_usd' };
}

function storedAnnualParsed(job = {}) {
  const storedMin = job.salary_min_usd === null || job.salary_min_usd === undefined || job.salary_min_usd === '' ? null : Number(job.salary_min_usd);
  const storedMax = job.salary_max_usd === null || job.salary_max_usd === undefined || job.salary_max_usd === '' ? null : Number(job.salary_max_usd);
  if ([storedMin, storedMax].some(Number.isFinite) && [storedMin, storedMax].some(value => value !== null && value < 0)) {
    return { reason: 'invalid_stored_salary', annualMinUsd: null, annualMaxUsd: null };
  }
  if (storedMin !== null || storedMax !== null) {
    return { reason: 'parsed', annualMinUsd: finitePositive(storedMin), annualMaxUsd: finitePositive(storedMax), currencyExplicit: true, periodExplicit: true };
  }
  return null;
}

export function classifySalary(job = {}, settings = {}) {
  const stored = storedAnnualParsed(job);
  if (stored) return classifySalaryFromParsed(stored, settings);
  const raw = job.salary || extractSalaryFromDescription(job.description);
  const parsed = parseSalary(raw);
  return classifySalaryFromParsed(parsed, settings);
}

export function salaryClassificationForJob(job = {}, settings = {}) {
  const stored = storedAnnualParsed(job);
  const parsed = stored || parseSalary(job.salary || extractSalaryFromDescription(job.description));
  return { ...classifySalaryFromParsed(parsed, settings), parsed };
}

export function salaryTierEnabled(settings = {}) {
  return settings.salary_tier_badges_enabled !== '0' && settings.salary_tier_badges_enabled !== false;
}
