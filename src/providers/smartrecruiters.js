// src/providers/smartrecruiters.js
// Provider: SmartRecruiters Posting API — public per-company API, no auth key.
// The "api_key" field for this provider holds the SmartRecruiters company
// identifier used in api.smartrecruiters.com/v1/companies/<identifier>/...
// (this is the same slug visible in a company's public careers URL, e.g.
// "Visa" in jobs.smartrecruiters.com/Visa).
//
// `fields=jobAd` asks the list endpoint to embed each posting's full ad
// content inline — same one-request-per-source pattern as Greenhouse's
// `content=true` — so we never need a second (per-job) request just to
// get a real description.
export const id = 'smartrecruiters';
export const needsKey = true;
export const keyFormatHint = 'company identifier, e.g. Visa';
export const ignoresQuery = true;

export async function fetchJobs({ apiKey: company, timeoutMs = 15000, limit = 100 } = {}) {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=${limit}&fields=jobAd`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  // jobAd.sections carries the rich HTML description when fields=jobAd is
  // honored; some tenants omit it, so we degrade gracefully to ''.
  const sections = job.jobAd && job.jobAd.sections;
  const descHtml = sections
    ? [sections.jobDescription, sections.qualifications, sections.additionalInformation]
        .map(s => (s && s.text) || '')
        .filter(Boolean)
        .join('\n\n')
    : '';
  return {
    title: job.name || 'Unknown',
    company: (job.company && job.company.name) || company,
    location: locationStr,
    url: (job.ref && job.ref.jobAdUrl) || job.applyUrl || '',
    description: descHtml.replace(/<[^>]+>/g, ' ').slice(0, 5000),
    salary: '',
    remote_type: loc.remote ? 'fully_remote' : '',
    skills: [],
    seniority: (job.experienceLevel && job.experienceLevel.label) || '',
    employment_type: (job.typeOfEmployment && job.typeOfEmployment.label || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: job.id || '',
    source: 'smartrecruiters',
  };
}
