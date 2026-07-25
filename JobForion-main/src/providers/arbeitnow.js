// src/providers/arbeitnow.js
// Provider: Arbeitnow Job Board API — free, public, no key required.
// Docs: https://arbeitnow.com/api/job-board-api
// This API has no keyword-search parameter; it returns the latest postings
// paginated. ignoresQuery=true tells the orchestrator to call this provider
// once per sync (not once per search keyword like the others).
export const id = 'arbeitnow';
export const needsKey = false;
export const ignoresQuery = true;

export async function fetchJobs({ timeoutMs = 15000, maxPages = 3 } = {}) {
  const all = [];
  let lastError = null;
  for (let page = 1; page <= maxPages; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`https://arbeitnow.com/api/job-board-api?page=${page}`, { signal: controller.signal });
      if (!res.ok) { lastError = new Error(`HTTP ${res.status}`); break; }
      const data = await res.json();
      const jobs = data.data || [];
      if (!jobs.length) break;
      all.push(...jobs.map(map));
      if (!data.links || !data.links.next) break;
    } catch (e) {
      lastError = e;
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  // Previously this swallowed the failure silently and returned an empty
  // array, which is why the dashboard showed "+0 (0ms)" with no clue why.
  // Now: only stay silent if we got at least SOME jobs before failing on a
  // later page — if the very first attempt failed, surface the real error.
  if (!all.length && lastError) throw lastError;
  return all.filter(j => j.url);
}

function map(job) {
  return {
    title: job.title || 'Unknown',
    company: job.company_name || 'Company',
    location: job.location || (job.remote ? 'Remote' : ''),
    url: job.url || '',
    description: job.description || '',
    salary: '',
    remote_type: job.remote ? 'fully_remote' : '',
    skills: Array.isArray(job.tags) ? job.tags : [],
    seniority: '',
    employment_type: Array.isArray(job.job_types) && job.job_types[0]
      ? job.job_types[0].toLowerCase().replace(/[\s-]+/g, '_') : '',
    job_handle: job.slug || '',
    source: 'arbeitnow',
  };
}
