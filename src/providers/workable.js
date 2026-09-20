// src/providers/workable.js
// Provider: Workable public "Jobs" widget API — no auth key required.
// The "api_key" field for this provider holds the Workable account
// subdomain used in <subdomain>.workable.com, e.g. "acme".
export const id = 'workable';
export const needsKey = true;
export const keyFormatHint = 'account subdomain, e.g. acme';
export const ignoresQuery = true;

export async function fetchJobs({ apiKey: account, timeoutMs = 15000 } = {}) {
  const url = `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(account)}/jobs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The public widget endpoint expects a POST with paging/state
      // filters even for the simplest "give me everything published" case.
      body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [], state: 'published' }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.results || []).map(j => map(j, account)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job, account) {
  const loc = job.location || {};
  const locationStr = job.remote
    ? 'Remote'
    : [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
  return {
    title: job.title || 'Unknown',
    company: job.department || account,
    location: locationStr,
    url: job.url || (job.shortcode ? `https://apply.workable.com/${account}/j/${job.shortcode}/` : ''),
    // The list endpoint doesn't carry the full HTML job description —
    // fetching it would mean one extra request per job, which we
    // deliberately avoid (see sync.js subrequest-budget notes). The card
    // and job page both degrade cleanly when description is short/empty.
    description: job.brief || '',
    salary: '',
    remote_type: job.remote ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: (job.employment_type || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: job.shortcode || job.id || '',
    source: 'workable',
  };
}
