// src/providers/smartrecruiters.js
// Provider: SmartRecruiters public Postings API — no auth of any kind.
// The "company" field holds the company identifier used in
// jobs.smartrecruiters.com/<company>.
export const id = 'smartrecruiters';
export const displayName = 'SmartRecruiters';
export const keyFormatHint = 'company identifier from jobs.smartrecruiters.com/<company>';
export const ignoresQuery = true;

export async function fetchJobs({ company, timeoutMs = 15000 } = {}) {
  if (!company) throw new Error('No company identifier provided');
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=50`;
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
  const locStr = [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
  return {
    title: job.name || 'Unknown',
    company,
    location: loc.remote ? 'Remote' : locStr,
    url: `https://jobs.smartrecruiters.com/${company}/${job.id}`,
    description: '',
    salary: '',
    remote_type: loc.remote ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: ((job.typeOfEmployment && job.typeOfEmployment.label) || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: job.id || '',
    source: 'smartrecruiters',
  };
}
