// src/providers/recruitee.js
// Provider: Recruitee public offers API — no auth of any kind.
// The "company" field holds the subdomain used in <company>.recruitee.com.
export const id = 'recruitee';
export const displayName = 'Recruitee';
export const keyFormatHint = 'company subdomain from <company>.recruitee.com';
export const ignoresQuery = true;

export async function fetchJobs({ company, timeoutMs = 15000 } = {}) {
  if (!company) throw new Error('No company subdomain provided');
  const url = `https://${encodeURIComponent(company)}.recruitee.com/api/offers/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.offers || []).map(j => map(j, company)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job, company) {
  const locations = Array.isArray(job.locations) && job.locations.length
    ? job.locations.map(l => l.city).filter(Boolean).join(', ')
    : (job.city || '');
  return {
    title: job.title || 'Unknown',
    company,
    location: job.remote ? 'Remote' : locations,
    url: job.careers_url || `https://${company}.recruitee.com/o/${job.slug}`,
    description: (job.description || '').replace(/<[^>]+>/g, ' ').slice(0, 5000),
    salary: '',
    remote_type: job.remote ? 'fully_remote' : '',
    skills: Array.isArray(job.tags) ? job.tags : [],
    seniority: '',
    employment_type: (job.employment_type_code || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: String(job.id || ''),
    source: 'recruitee',
  };
}
