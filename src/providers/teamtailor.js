// src/providers/teamtailor.js
// Provider: Teamtailor official REST API (api.teamtailor.com/v1/jobs).
// Unlike Greenhouse/Lever/Ashby/Recruitee, Teamtailor's API is NOT public —
// it requires a real API token generated from the company's Teamtailor
// admin (Settings → Integrations → API keys). The "api_key" field for this
// provider holds that token.
export const id = 'teamtailor';
export const needsKey = true;
export const keyFormatHint = 'Teamtailor API token';
export const ignoresQuery = true;

const API_VERSION = '20240404';

export async function fetchJobs({ apiKey, timeoutMs = 15000, pageSize = 60 } = {}) {
  if (!apiKey) throw new Error('Teamtailor API token is required');
  const url = `https://api.teamtailor.com/v1/jobs?filter[status]=published&page[size]=${pageSize}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Token token=${apiKey}`,
        'X-Api-Version': API_VERSION,
        'Accept': 'application/vnd.api+json',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.data || []).map(map).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job) {
  const attrs = job.attributes || {};
  const locationStr = attrs['remote-status'] === 'fully'
    ? 'Remote'
    : (attrs['location-name'] || attrs.city || '');
  return {
    title: attrs.title || 'Unknown',
    company: attrs['company-name'] || '',
    location: locationStr,
    url: attrs['careersite-job-url'] || attrs['careersite-job-apply-url'] || '',
    description: (attrs.body || '').replace(/<[^>]+>/g, ' ').slice(0, 5000),
    salary: '',
    remote_type: attrs['remote-status'] === 'fully' ? 'fully_remote' : (attrs['remote-status'] === 'hybrid' ? 'hybrid' : ''),
    skills: [],
    seniority: '',
    employment_type: (attrs['employment-type'] || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: job.id || '',
    source: 'teamtailor',
  };
}
