// src/providers/linkedin.js
// Provider: LinkedIn Job Search API via RapidAPI.
// Endpoint/headers confirmed directly from the live RapidAPI account's own
// "Code Snippets" tab (not guessed):
//   GET https://linkedin-job-search-api.p.rapidapi.com/active-jb
//     ?time_frame=24h&limit=50&offset=0&description_format=text&title=...
//   headers: Content-Type, x-rapidapi-host, x-rapidapi-key
// Response is a plain JSON array of job objects (not wrapped in {jobs:[]}).
export const id = 'linkedin_rapidapi';
export const needsKey = true;
export const ignoresQuery = false;

const EMPLOYMENT_TYPE_MAP = {
  FULL_TIME: 'full_time', PART_TIME: 'part_time', CONTRACTOR: 'contract',
  TEMPORARY: 'contract', INTERN: 'internship', VOLUNTEER: 'contract', OTHER: '',
};

export async function fetchJobs({ apiKey, query, timeoutMs = 15000 }) {
  const url = `https://linkedin-job-search-api.p.rapidapi.com/active-jb?time_frame=24h&limit=50&offset=0&description_format=text&title=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': 'linkedin-job-search-api.p.rapidapi.com',
        'x-rapidapi-key': apiKey,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobs = Array.isArray(data) ? data : (data.jobs || []);
    return jobs.map(map).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job) {
  const location = Array.isArray(job.locations_derived) && job.locations_derived.length
    ? job.locations_derived.join(', ')
    : (job.remote_derived ? 'Remote' : '');
  let salary = '';
  const sv = job.salary_raw && job.salary_raw.value;
  if (sv && sv.minValue && sv.maxValue && (!sv.unitText || sv.unitText === 'YEAR')) {
    salary = `$${Math.round(sv.minValue / 1000)}k - $${Math.round(sv.maxValue / 1000)}k`;
  }
  const remote_type = job.remote_derived === true || job.location_type === 'TELECOMMUTE' ? 'fully_remote' : '';
  const rawType = Array.isArray(job.employment_type) ? job.employment_type[0] : '';
  return {
    title: job.title || 'Unknown',
    company: job.organization || 'Company',
    location,
    url: job.url || '',
    description: job.description_text || '',
    salary,
    remote_type,
    skills: [],
    seniority: job.seniority || '',
    employment_type: rawType ? (EMPLOYMENT_TYPE_MAP[rawType] ?? rawType.toLowerCase()) : '',
    job_handle: '',
    source: 'linkedin',
  };
}
