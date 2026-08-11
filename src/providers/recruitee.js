// src/providers/recruitee.js
// Provider: Recruitee Careers API — fully public, no auth key required.
// The "api_key" field for this provider holds the company subdomain used
// in <subdomain>.recruitee.com, e.g. "acme".
export const id = 'recruitee';
export const needsKey = true;
export const keyFormatHint = 'company subdomain, e.g. acme';
export const ignoresQuery = true;

export async function fetchJobs({ apiKey: subdomain, timeoutMs = 15000 } = {}) {
  const url = `https://${encodeURIComponent(subdomain)}.recruitee.com/api/offers/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.offers || []).map(j => map(j, subdomain)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job, subdomain) {
  const isRemote = !!(job.remote || (job.locations && job.locations.some(l => l.remote)));
  const locationStr = isRemote
    ? 'Remote'
    : (job.city || (job.locations && job.locations[0] && job.locations[0].city) || job.country || '');
  return {
    title: job.title || 'Unknown',
    company: job.company_name || subdomain,
    location: locationStr,
    url: job.careers_url || (job.slug ? `https://${subdomain}.recruitee.com/o/${job.slug}` : ''),
    description: (job.description || '').replace(/<[^>]+>/g, ' ').slice(0, 5000),
    salary: '',
    remote_type: isRemote ? 'fully_remote' : '',
    skills: Array.isArray(job.tags) ? job.tags : [],
    seniority: (job.experience && job.experience.name) || '',
    employment_type: (job.employment_type_code || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: String(job.id || ''),
    source: 'recruitee',
  };
}
