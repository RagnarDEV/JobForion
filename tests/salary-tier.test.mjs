import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSalary } from '../src/lib/salary.js';
import { classifySalary, classifySalaryFromParsed } from '../src/lib/salary-tier.js';
import { isHotPayJob, annotateHotPay } from '../src/lib/hot-pay.js';
import { salaryTierBadgeHtml, salaryTierCardTint, jobCardSSR } from '../src/components/job-card.js';

const defaults = { salary_tier_badges_enabled: '1', salary_tier_high_min_usd: '120000', salary_tier_good_min_usd: '70000' };

assert.equal(parseSalary('$120,000 - $160,000 USD/year').annualMinUsd, 120000);
assert.equal(parseSalary('$120,000 - $160,000 USD/year').annualMaxUsd, 160000);
assert.equal(parseSalary('$2,000/week').annualMinUsd, 104000);
assert.equal(parseSalary('$8,000/month').annualMinUsd, 96000);
assert.equal(parseSalary('$50/hour').annualMinUsd, 104000);
assert.equal(parseSalary('$300/day').annualMinUsd, 78000);
assert.equal(parseSalary('€70k - €80k/year').annualMinUsd, 75600);
assert.equal(parseSalary('CAD 100k/year').annualMinUsd, 73000);
assert.equal(parseSalary('JPY 7,000,000/year').reason, 'unsupported_currency');
assert.equal(parseSalary('$120,000 per quarter').reason, 'unsupported_period');
assert.equal(parseSalary('$0/year').annualMinUsd, null);
assert.equal(parseSalary('-$90,000/year').reason, 'negative_salary');
assert.equal(parseSalary('Competitive').reason, 'missing_or_invalid');

assert.equal(classifySalary({ salary_min_usd: 150000, salary_max_usd: 150000 }, defaults).tier, 'HIGH');
assert.equal(classifySalary({ salary_min_usd: 90000, salary_max_usd: 100000 }, defaults).tier, 'GOOD');
assert.equal(classifySalary({ salary_min_usd: 30000, salary_max_usd: 50000 }, defaults).tier, 'STANDARD');
assert.equal(classifySalary({ salary_min_usd: -1, salary_max_usd: -1, salary: '$200,000/year' }, defaults).tier, 'UNKNOWN');
assert.equal(classifySalary({ salary: '' }, defaults).tier, 'UNKNOWN');
assert.equal(classifySalary({ salary: '$20,000,000/year' }, defaults).tier, 'UNKNOWN');
assert.equal(classifySalary({ salary: '$90,000 - $110,000/year' }, defaults).normalizedAnnualSalary, 100000);
assert.equal(classifySalary({ salary: '', description: '<p>Compensation: $130,000/year</p>' }, defaults).tier, 'HIGH');

const hotSettings = { ...defaults, hot_pay_enabled: '1', hot_pay_threshold_usd: '150000' };
assert.equal(isHotPayJob({ salary_min_usd: 120000, salary_max_usd: 120000 }, hotSettings), false);
assert.equal(isHotPayJob({ salary_min_usd: 160000, salary_max_usd: 160000 }, hotSettings), true);
assert.equal(classifySalary({ salary_min_usd: 160000, salary_max_usd: 160000 }, hotSettings).tier, 'HIGH');
assert.equal(isHotPayJob({ salary_min_usd: 160000, salary_max_usd: 160000 }, { ...hotSettings, hot_pay_enabled: '0' }), false);
const annotated = annotateHotPay([{ id: 1, salary_min_usd: 160000, salary_max_usd: 160000 }], hotSettings)[0];
assert.equal(annotated.salary_tier, 'HIGH');
assert.equal(annotated.isHotPay, true);

assert.match(salaryTierBadgeHtml('HIGH', { ...defaults, salary_tier_high_label: 'Top Pay' }), /salary-tier-high/);
assert.match(salaryTierBadgeHtml('HIGH', { ...defaults, salary_tier_high_label: 'Top Pay' }), /Top Pay/);
assert.equal(salaryTierBadgeHtml('UNKNOWN', defaults), '');
assert.equal(salaryTierBadgeHtml('HIGH', { ...defaults, salary_tier_badges_enabled: '0' }), '');
assert.equal(salaryTierCardTint({ salary_tier: 'HIGH' }), 'var(--salary-high-bg,#eafaf1)');
assert.equal(salaryTierCardTint({ salary_tier: 'GOOD' }), 'var(--salary-good-bg,#f0ecff)');
assert.equal(salaryTierCardTint({ salary_tier: 'STANDARD' }), 'var(--salary-standard-bg,#f5f5f7)');
assert.equal(salaryTierCardTint({ salary_tier: 'UNKNOWN' }), '');
const card = jobCardSSR({ id: 1, title: 'Engineer', company: 'Acme', salary: '$160k/year', salary_tier: 'HIGH', job_type: 'Free', skills: '[]' }, 0, undefined, undefined, undefined, {}, true, new Set(), { ...defaults, hot_pay_enabled: '1', hot_pay_threshold_usd: '150000' });
assert.match(card, /background:var\(--salary-high-bg/);
const paidCard = jobCardSSR({ id: 2, title: 'Engineer', company: 'Acme', salary: '$160k/year', salary_tier: 'HIGH', job_type: 'Premium', skills: '[]' }, 0, undefined, undefined, undefined, {}, true, new Set(), { ...defaults, hot_pay_enabled: '1', hot_pay_threshold_usd: '150000' });
assert.doesNotMatch(paidCard, /background:var\(--salary-high-bg/);

const homeSource = fs.readFileSync(new URL('../src/pages/home.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../src/routes/api.router.js', import.meta.url), 'utf8');
assert.match(homeSource, /id="fSalaryTier"/);
assert.match(homeSource, /salaryTierBadgeClient\(j\.salary_tier\)/);
assert.match(apiSource, /COALESCE\(salary_tier, 'UNKNOWN'\)/);
assert.match(apiSource, /salaryTierRaw/);

console.log('salary-tier tests: all assertions passed');
