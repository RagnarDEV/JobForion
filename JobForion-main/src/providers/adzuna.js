// src/providers/adzuna.js
// Provider: Adzuna Jobs API. Adzuna requires TWO credentials (app_id and
// app_key), but JobForion's api_sources table stores one key field per row —
// so for this provider, paste both joined by a colon: "app_id:app_key".
export const id = 'adzuna';
export const needsKey = true;
export const keyFormatHint = 'app_id:app_key';
export const ignoresQuery = false;

export async function fetchJobs({ apiKey, query, timeoutMs = 15000, country = 'us' }) {
  const [appId, appKey] = String(apiKey || '').split(':');
  if (!appId || !appKey) throw new Error('Adzuna key must be formatted as app_id:app_key');
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}&what=${encodeURIComponent(query)}&results_per_page=50&content-type=application/json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.results || []).map(map).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job) {
  let salary = '';
  if (job.salary_min && job.salary_max) {
    salary = `$${Math.round(job.salary_min / 1000)}k - $${Math.round(job.salary_max / 1000)}k`;
  }
  return {
    title: job.title || 'Unknown',
    company: (job.company && job.company.display_name) || 'Company',
    location: (job.location && job.location.display_name) || '',
    url: job.redirect_url || '',
    description: job.description || '',
    salary,
    remote_type: '',
    skills: [],
    seniority: '',
    employment_type: job.contract_time === 'part_time' ? 'part_time' : (job.contract_type === 'contract' ? 'contract' : 'full_time'),
    job_handle: String(job.id || ''),
    source: 'adzuna',
  };
}
