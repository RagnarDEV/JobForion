// src/lib/schema.js
// ════════════════════════════════════════════════════════════════
// JSON-LD structured data builders. Every function returns a plain
// object; callers wrap it in <script type="application/ld+json">.
// Keep these pure (no I/O) so they're trivially testable.
// ════════════════════════════════════════════════════════════════

// SECURITY: JSON.stringify() does NOT escape "<", so any DB-derived or
// user-submitted value (company name, country name, skill name, search
// query) that ends up in one of these schema objects and happens to
// contain "</script>" could break out of this <script> block and inject
// a real executable tag. Escaping "<" as a unicode sequence keeps the
// JSON value byte-identical while making that break-out impossible.
// This mirrors the safeJsonLd() helper already used in job-page.js —
// centralizing it here means every caller of ldJsonTag() across the
// entire site (categories, companies, skills, countries, search,
// breadcrumbs, home) is protected automatically, not just job pages.
export function ldJsonTag(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

export function websiteSchema(base) {
  return {
    "@context": "https://schema.org", "@type": "WebSite",
    "name": "JobForion", "url": base,
    "potentialAction": {
      "@type": "SearchAction",
      "target": `${base}/search/{search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  };
}

export function organizationSchema(base) {
  return {
    "@context": "https://schema.org", "@type": "Organization",
    "name": "JobForion", "url": base, "logo": `${base}/icon-512.png`
  };
}

// ════════════════════════════════════════════════════════════════
// JobPosting (Google Jobs rich results) — SINGLE SOURCE OF TRUTH.
// This used to be duplicated: an outdated, buggy copy lived here
// (unused — nothing imported it) while pages/job-page.js kept its own
// inline copy that received bug fixes over time. That drift is exactly
// how bugs like these survive: a fix lands in one copy and never
// reaches the other. From now on pages/job-page.js imports and calls
// this function — there is only one implementation to keep correct.
//
// Fixed in this pass (Search Console flagged both as real errors):
//  1. employmentType — must be the exact enum with an UNDERSCORE
//     ("FULL_TIME"), not a space ("FULL TIME"). A previous
//     .replace('_',' ') silently broke this for every job.
//  2. baseSalary.value — must be a real NUMBER (e.g. 90000), not the
//     raw display string ("$90k - $130k"). Google can't validate a
//     string there, so it was rejecting the whole field.
//  3. jobLocation — many jobs are remote with an EMPTY remote_type
//     column (provider didn't set it) but a location string that says
//     "Remote" in plain text. Previously that combination produced
//     NEITHER jobLocationType NOR jobLocation — the field just vanished
//     for those listings. Now free-text "Remote"/"Worldwide"/"Anywhere"
//     is recognized as a fallback signal, but ONLY when remote_type is
//     genuinely unset (an explicit 'hybrid'/'on_site' from the provider
//     is never overridden by wording in the location text).
// https://developers.google.com/search/docs/appearance/structured-data/job-posting
// ════════════════════════════════════════════════════════════════

import { isKnownCountry, US_STATE_CODES } from './country-flags.js';
import { parseSalaryRange } from './entities.js';

// Google's enum, underscore-separated. "CONTRACT" isn't valid — the
// closest accepted value is "CONTRACTOR".
const EMPLOYMENT_TYPE_SCHEMA_MAP = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  contract: 'CONTRACTOR',
  internship: 'INTERN',
  temporary: 'TEMPORARY',
  volunteer: 'VOLUNTEER',
};

// Builds a schema.org PostalAddress for jobLocation — but ONLY when the
// country can be confidently determined from the free-text `location`
// column (a recognized country name, or a US state code). Publishing a
// wrong guess is worse than omitting the field entirely, since this
// column has no normalized country data to begin with (see
// splitLocation() in entities.js). Remote jobs don't need this at all —
// they use jobLocationType instead (see isFullyRemoteJob below).
function buildJobLocationSchema(location) {
  if (!location) return null;
  const parts = location.split(',').map(s => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;

  if (isKnownCountry(last)) {
    const address = { "@type": "PostalAddress", "addressCountry": last };
    if (parts.length > 1) address.addressLocality = parts[0];
    return { "@type": "Place", "address": address };
  }
  if (US_STATE_CODES.has(last.toUpperCase())) {
    const address = { "@type": "PostalAddress", "addressCountry": "US", "addressRegion": last.toUpperCase() };
    if (parts.length > 1) address.addressLocality = parts[0];
    return { "@type": "Place", "address": address };
  }
  return null; // not confident enough to publish — omit rather than guess
}

// A job counts as fully remote for structured-data purposes if EITHER:
//  - the provider explicitly set remote_type = 'fully_remote', OR
//  - remote_type was left blank AND the free-text location itself
//    clearly says so ("Remote", "Remote - US", "Worldwide", "Anywhere",
//    "WFH"). This text fallback never fires when remote_type holds an
//    explicit 'hybrid'/'on_site' — a real provider signal always wins
//    over guessing from wording.
function isFullyRemoteJob(job) {
  if (job.remote_type === 'fully_remote') return true;
  if (job.remote_type) return false;
  const loc = (job.location || '').trim();
  return /^remote\b/i.test(loc) || /^(anywhere|worldwide|work from home|wfh)$/i.test(loc);
}

// job.salary is stored/displayed as a "k-shorthand" string like
// "$90k - $130k" (same convention used everywhere on the site — see
// parseSalaryRange() in entities.js, which returns {min:90, max:130}).
// Google's baseSalary needs the REAL annual figure, so these get
// multiplied by 1000 here specifically for the schema output. Returns
// null (field omitted) when the salary text has no parseable digits
// (e.g. "Competitive") rather than emitting a value Google can't
// validate.
function buildBaseSalarySchema(salaryText) {
  const range = parseSalaryRange(salaryText);
  if (!range) return null;
  const min = range.min * 1000, max = range.max * 1000;
  const value = min === max
    ? { "@type": "QuantitativeValue", "value": min, "unitText": "YEAR" }
    : { "@type": "QuantitativeValue", "minValue": min, "maxValue": max, "unitText": "YEAR" };
  return { "@type": "MonetaryAmount", "currency": "USD", "value": value };
}

// `overrides.description` lets callers (job-page.js) pass an already
// HTML-stripped description (via cleanDescription()) instead of the raw
// possibly-HTML-tagged job.description — kept as a param rather than
// duplicating that cleanup logic here.
export function jobPostingSchema(job, base, overrides = {}) {
  const canonical = `${base}/job/${job.id}`;
  const isRemote = isFullyRemoteJob(job);
  const jobLocationSchema = isRemote ? null : buildJobLocationSchema(job.location);
  const employmentTypeSchema = job.employment_type ? EMPLOYMENT_TYPE_SCHEMA_MAP[job.employment_type] : undefined;
  const baseSalarySchema = job.salary ? buildBaseSalarySchema(job.salary) : null;

  return {
    "@context": "https://schema.org", "@type": "JobPosting",
    "title": job.title,
    "description": overrides.description || job.description || `${job.title} at ${job.company}. ${job.location || 'Remote'}.`,
    "identifier": { "@type": "PropertyValue", "name": job.company, "value": String(job.job_handle || job.id) },
    "hiringOrganization": { "@type": "Organization", "name": job.company },
    ...(job.created_at ? { "datePosted": new Date(job.created_at).toISOString().split('T')[0] } : {}),
    ...(job.expires_at ? { "validThrough": new Date(job.expires_at).toISOString().split('T')[0] } : {}),
    "url": canonical,
    // Required for Google's "Work from home jobs" experience.
    // applicantLocationRequirements is intentionally omitted (no
    // reliable data for it); per Google's docs, without it a remote job
    // is simply shown broadly rather than being excluded.
    ...(isRemote ? { "jobLocationType": "TELECOMMUTE" } : {}),
    // jobLocation is required UNLESS the job is remote — for non-remote
    // jobs we only publish it when the country is confidently known
    // (see buildJobLocationSchema above); otherwise this listing simply
    // won't be Google-Jobs-eligible until the location data improves,
    // which is preferable to publishing a guessed country.
    ...(jobLocationSchema ? { "jobLocation": jobLocationSchema } : {}),
    ...(employmentTypeSchema ? { "employmentType": employmentTypeSchema } : {}),
    ...(baseSalarySchema ? { "baseSalary": baseSalarySchema } : {}),
  };
}

export function articleSchema(post, base) {
  return {
    "@context": "https://schema.org", "@type": "Article",
    "headline": post.title, "description": post.excerpt,
    "datePublished": post.date, "author": { "@type": "Organization", "name": "JobForion" },
    "url": `${base}/blog/${post.id}`
  };
}

export function breadcrumbSchema(trail) {
  // trail: [{name, url}, ...] in order from home -> current
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    "itemListElement": trail.map((t, i) => ({
      "@type": "ListItem", "position": i + 1, "name": t.name, "item": t.url
    }))
  };
}

export function itemListSchema(items) {
  // items: [{url}, ...]
  return {
    "@context": "https://schema.org", "@type": "ItemList",
    "itemListElement": items.map((it, i) => ({ "@type": "ListItem", "position": i + 1, "url": it.url }))
  };
}

export function collectionPageSchema(name, description, url) {
  return {
    "@context": "https://schema.org", "@type": "CollectionPage",
    "name": name, "description": description, "url": url
  };
}

export function faqSchema(qaPairs) {
  // qaPairs: [{question, answer}, ...]
  if (!qaPairs || !qaPairs.length) return null;
  return {
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": qaPairs.map(qa => ({
      "@type": "Question", "name": qa.question,
      "acceptedAnswer": { "@type": "Answer", "text": qa.answer }
    }))
  };
}
