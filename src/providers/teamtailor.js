// src/providers/teamtailor.js
// Provider: Teamtailor public career-site JSON feed — no auth of any kind.
// The "company" field holds the subdomain used in <company>.teamtailor.com.
export const id = 'teamtailor';
export const displayName = 'Teamtailor';
export const keyFormatHint = 'career-site subdomain from <company>.teamtailor.com';
export const ignoresQuery = true;

export async function fetchJobs({ company, timeoutMs = 15000 } = {}) {
  if (!company) throw new Error('No career-site subdomain provided');
  const url = `https://${encodeURIComponent(company)}.teamtailor.com/jobs.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobs = Array.isArray(data) ? data : (data.jobs || []);
    return jobs.map(j => map(j, company)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job, company) {
  return {
    title: job.title || job.name || 'Unknown',
    company,
    location: job.location || job.city || (job.remote ? 'Remote' : ''),
    url: job.url || job.careersite_job_url || `https://${company}.teamtailor.com/jobs/${job.id}`,
    description: (job.body || job.description || '').replace(/<[^>]+>/g, ' ').slice(0, 5000),
    salary: '',
    remote_type: job.remote ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: (job.employment_type || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: String(job.id || ''),
    source: 'teamtailor',
  };
}
