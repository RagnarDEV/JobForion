// src/providers/jobdatalake.js
// Provider: JobDataLake (api.jobdatalake.com) — JobForion's original source.
// Contract: fetchJobs(ctx) -> Promise<UnifiedJob[]>. Never writes to the DB.
export const id = 'jobdatalake';
export const needsKey = true;
export const ignoresQuery = false;

export async function fetchJobs({ apiKey, query, timeoutMs = 15000 }) {
  const url = `https://api.jobdatalake.com/v1/jobs?q=${encodeURIComponent(query)}&per_page=100`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'X-API-Key': apiKey }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobs = data.jobs || data.hits || data.results || (Array.isArray(data) ? data : []);
    return jobs.map(map).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job) {
  return {
    title: job.title || 'Unknown',
    company: job.company_name || 'Company',
    location: Array.isArray(job.locations) && job.locations.length ? job.locations[0] : (job.remote_type === 'fully_remote' ? 'Remote' : ''),
    url: job.url || '',
    description: job.description || '',
    salary: job.salary_min_usd && job.salary_max_usd ? `$${job.salary_min_usd}k - $${job.salary_max_usd}k` : '',
    remote_type: job.remote_type || '',
    skills: Array.isArray(job.required_skills) ? job.required_skills : [],
    seniority: Array.isArray(job.seniority) ? job.seniority.join(', ') : '',
    employment_type: job.employment_type || '',
    job_handle: job.job_handle || '',
    source: 'jobdatalake',
  };
}
