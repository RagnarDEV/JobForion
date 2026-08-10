// src/providers/lever.js
// Provider: Lever job postings — fully public, no auth of any kind.
// The "company" field holds the company slug used in jobs.lever.co/<slug>.
export const id = 'lever';
export const displayName = 'Lever';
export const keyFormatHint = 'company slug from jobs.lever.co/<slug> — e.g. netflix';
export const ignoresQuery = true;

export async function fetchJobs({ company, timeoutMs = 15000 } = {}) {
  if (!company) throw new Error('No company slug provided');
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map(j => map(j, company)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job, company) {
  const loc = (job.categories && job.categories.location) || '';
  return {
    title: job.text || 'Unknown',
    company,
    location: loc,
    url: job.hostedUrl || job.applyUrl || '',
    description: (job.descriptionPlain || job.description || '').slice(0, 5000),
    salary: '',
    remote_type: /remote/i.test(loc) ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: ((job.categories && job.categories.commitment) || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: job.id || '',
    source: 'lever',
  };
}
