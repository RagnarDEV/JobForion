// src/providers/smartrecruiters.js
// Provider: SmartRecruiters Posting API — public per-company API, no auth key.
// The "api_key" field for this provider holds the SmartRecruiters company
// identifier used in api.smartrecruiters.com/v1/companies/<identifier>/...
// (this is the same slug visible in a company's public careers URL, e.g.
// "Visa" in jobs.smartrecruiters.com/Visa).
export const id = 'smartrecruiters';
export const needsKey = true;
export const keyFormatHint = 'company identifier, e.g. Visa';
export const ignoresQuery = true;

export async function fetchJobs({ apiKey: company, timeoutMs = 15000 } = {}) {
  // Deliberately no query params beyond the bare endpoint — an earlier
  // version added `fields=jobAd` and then `limit=100`, and this source
  // kept returning HTTP 400 regardless of which params were present,
  // which points at the company identifier itself rather than the query
  // string. Stripped down to the simplest possible request so there's
  // only one thing left that can be wrong: the identifier value.
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const bodySnippet = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${bodySnippet ? `: ${bodySnippet.slice(0, 150)}` : ''} — check the exact company identifier against https://jobs.smartrecruiters.com/${company}`);
    }
    const data = await res.json();
    return (data.content || []).map(j => map(j, company)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job, company) {
  const loc = job.location || {};
  const locationStr = loc.remote
    ? 'Remote'
    : [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
  return {
    title: job.name || 'Unknown',
    company: (job.company && job.company.name) || company,
    location: locationStr,
    url: (job.ref && job.ref.jobAdUrl) || job.applyUrl || '',
    // The base postings list doesn't include the full HTML job ad body
    // (an earlier version tried a `fields=jobAd` query param to embed it,
    // but that produced HTTP 400 for at least one real board — safer to
    // drop it than risk breaking the whole source over a richer
    // description; see Workable/Workday for the same trade-off).
    description: '',
    salary: '',
    remote_type: loc.remote ? 'fully_remote' : '',
    skills: [],
    seniority: (job.experienceLevel && job.experienceLevel.label) || '',
    employment_type: (job.typeOfEmployment && job.typeOfEmployment.label || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: job.id || '',
    source: 'smartrecruiters',
  };
}
