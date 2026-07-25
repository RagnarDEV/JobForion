// src/providers/jsearch.js
// Provider: JSearch API via RapidAPI (by letscrape) — aggregates Google for
// Jobs listings. Requires a RapidAPI key subscribed to JSearch specifically
// (different subscription than the LinkedIn Job Search API).
export const id = 'jsearch';
export const needsKey = true;
export const ignoresQuery = false;

export async function fetchJobs({ apiKey, query, timeoutMs = 15000 }) {
  const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&page=1&num_pages=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'x-rapidapi-host': 'jsearch.p.rapidapi.com', 'x-rapidapi-key': apiKey },
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
  const locParts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
  let salary = '';
  if (job.job_min_salary && job.job_max_salary) {
    salary = `$${Math.round(job.job_min_salary / 1000)}k - $${Math.round(job.job_max_salary / 1000)}k`;
  }
  return {
    title: job.job_title || 'Unknown',
    company: job.employer_name || 'Company',
    location: locParts.length ? locParts.join(', ') : (job.job_is_remote ? 'Remote' : ''),
    url: job.job_apply_link || '',
    description: job.job_description || '',
    salary,
    remote_type: job.job_is_remote ? 'fully_remote' : '',
    skills: Array.isArray(job.job_required_skills) ? job.job_required_skills : [],
    seniority: '',
    employment_type: (job.job_employment_type || '').toLowerCase(),
    job_handle: job.job_id || '',
    source: 'jsearch',
  };
}
