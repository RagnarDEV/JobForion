// src/providers/ashby.js
// Provider: Ashby job board — public per-company API, no auth key.
// The "api_key" field for this provider holds the job board name used in
// jobs.ashbyhq.com/<name>.
export const id = 'ashby';
export const needsKey = true;
export const keyFormatHint = 'job board name';
export const ignoresQuery = true;

export async function fetchJobs({ apiKey: boardName, timeoutMs = 15000 } = {}) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardName)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.jobs || []).map(j => map(j, boardName)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job, boardName) {
  return {
    title: job.title || 'Unknown',
    company: boardName,
    location: job.location || '',
    url: job.jobUrl || job.applyUrl || '',
    description: (job.descriptionPlain || '').slice(0, 5000),
    salary: '',
    remote_type: job.isRemote ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: (job.employmentType || '').toLowerCase(),
    job_handle: job.id || '',
    source: 'ashby',
  };
}
