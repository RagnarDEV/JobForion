// src/providers/workable.js
// Provider: Workable public widget API — no auth of any kind.
// The "company" field holds the account subdomain used in
// apply.workable.com/<account>.
export const id = 'workable';
export const displayName = 'Workable';
export const keyFormatHint = 'account subdomain from apply.workable.com/<account>';
export const ignoresQuery = true;

export async function fetchJobs({ company, timeoutMs = 15000 } = {}) {
  if (!company) throw new Error('No account subdomain provided');
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(company)}?details=true`;
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
  const loc = job.location || {};
  const locStr = [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
  return {
    title: job.title || 'Unknown',
    company,
    location: loc.remote ? 'Remote' : (locStr || job.city || ''),
    url: `https://apply.workable.com/${company}/j/${job.shortcode}/`,
    description: (job.description || '').replace(/<[^>]+>/g, ' ').slice(0, 5000),
    salary: '',
    remote_type: loc.remote ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: (job.employment_type || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: job.shortcode || '',
    source: 'workable',
  };
}
