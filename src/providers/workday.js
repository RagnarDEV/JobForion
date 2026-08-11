// src/providers/workday.js
// Provider: Workday-hosted career sites (CXS endpoint). Workday has no
// single universal public API path — every tenant's endpoint is derived
// from its own public careers URL, which varies per company:
//   https://<tenant>.<wdNN>.myworkdayjobs.com/<site>
// e.g. https://netflix.wd5.myworkdayjobs.com/netflix
//
// Rather than asking the admin to split that into three separate fields,
// the "api_key" field for this provider holds the FULL careers URL as
// copy-pasted from the browser — we parse tenant/host/site out of it here.
//
// BEST-EFFORT NOTE: this is Workday's de-facto public JSON endpoint used
// by many careers-page widgets, not an officially documented/versioned
// API — a small share of tenants customize their site path enough that
// the URL shape below won't match. If a source added here consistently
// errors, double-check the exact careers URL copied from the company site.
export const id = 'workday';
export const needsKey = true;
export const keyFormatHint = 'full careers URL, e.g. https://acme.wd5.myworkdayjobs.com/External';
export const ignoresQuery = true;

function parseWorkdayUrl(careersUrl) {
  const u = new URL(careersUrl);
  const host = u.hostname; // e.g. acme.wd5.myworkdayjobs.com
  const tenant = host.split('.')[0];
  const site = u.pathname.split('/').filter(Boolean)[0];
  if (!tenant || !site) throw new Error('Could not parse tenant/site from Workday URL');
  return { host, tenant, site };
}

export async function fetchJobs({ apiKey: careersUrl, timeoutMs = 15000, limit = 50 } = {}) {
  const { host, tenant, site } = parseWorkdayUrl(careersUrl);
  const endpoint = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Workday's own limit param — asking for a bounded page directly at
      // the source (not just filtering after the fact) means a very large
      // tenant never forces us to download/parse thousands of postings
      // just to keep a handful.
      body: JSON.stringify({ appliedFacets: {}, limit, offset: 0, searchText: '' }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const postings = data.jobPostings || [];
    return postings.map(j => map(j, host, tenant, site)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job, host, tenant, site) {
  const locationStr = job.locationsText || job.locationText || '';
  return {
    title: job.title || 'Unknown',
    company: tenant,
    location: locationStr,
    url: job.externalPath ? `https://${host}/${site}${job.externalPath}` : '',
    // Full description isn't included in the list response; a second
    // request per job would multiply our subrequest budget by the number
    // of postings, which we intentionally avoid (see sync.js). The listing
    // still has a real title/location/URL, just no long-form body text.
    description: '',
    salary: '',
    remote_type: /remote/i.test(locationStr) ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: (job.timeType || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: job.bulletFields && job.bulletFields[0] || '',
    source: 'workday',
  };
}
