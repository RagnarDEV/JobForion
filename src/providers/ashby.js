// src/providers/ashby.js
// Provider: Ashby job board — fully public, no auth of any kind.
// The "company" field holds the job board name used in jobs.ashbyhq.com/<name>.
export const id = 'ashby';
export const displayName = 'Ashby';
export const keyFormatHint = 'job board name from jobs.ashbyhq.com/<name>';
export const ignoresQuery = true;

export async function fetchJobs({ company, timeoutMs = 15000 } = {}) {
  if (!company) throw new Error('No job board name provided');
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.jobs || []).map(j => map(j, company)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job, company) {
  return {
    title: job.title || 'Unknown',
    company,
    location: job.location || '',
    url: job.jobUrl || job.applyUrl || '',
    description: (job.descriptionPlain || '').slice(0, 5000),
    salary: '',
    remote_type: job.isRemote ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: (job.employmentType || '').toLowerCase(),
    job_handle: job.id || '',
    source: 'ashby',
  };
}
