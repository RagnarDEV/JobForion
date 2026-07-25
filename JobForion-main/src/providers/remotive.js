// src/providers/remotive.js
// Provider: Remotive Remote Jobs API — free, public, no key required.
// Docs: https://remotive.com/api/remote-jobs
export const id = 'remotive';
export const needsKey = false;
export const ignoresQuery = false;

export async function fetchJobs({ query, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query || '')}&limit=50`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.jobs || []).map(map).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job) {
  return {
    title: job.title || 'Unknown',
    company: job.company_name || 'Company',
    location: job.candidate_required_location || 'Remote',
    url: job.url || '',
    description: (job.description || '').replace(/<[^>]+>/g, ' ').slice(0, 5000),
    salary: job.salary || '',
    remote_type: 'fully_remote',
    skills: Array.isArray(job.tags) ? job.tags : [],
    seniority: '',
    employment_type: (job.job_type || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: String(job.id || ''),
    source: 'remotive',
  };
}
