// src/providers/workday.js
// Provider: Workday CXS public job-search endpoint — no auth of any kind,
// but every tenant is hosted on its own subdomain + site name + regional
// host cluster, so a single free-text slug isn't enough on its own. The
// "company" field must use the 3-part format documented in keyFormatHint
// below (visible directly in the tenant's own careers URL).
export const id = 'workday';
export const displayName = 'Workday';
export const keyFormatHint = 'format hostCluster:tenant:site — e.g. wd5:nike:External (read from the tenant\'s careers URL)';
export const ignoresQuery = true;

export async function fetchJobs({ company, timeoutMs = 15000 } = {}) {
  if (!company) throw new Error('No Workday identifier provided');
  const parts = String(company).split(':').map(s => s.trim()).filter(Boolean);
  if (parts.length !== 3) throw new Error('Workday identifier must be formatted as hostCluster:tenant:site');
  const [host, tenant, site] = parts;
  const url = `https://${tenant}.${host}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.jobPostings || []).map(j => map(j, tenant, host, site)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(job, tenant, host, site) {
  return {
    title: job.title || 'Unknown',
    company: tenant,
    location: job.locationsText || (Array.isArray(job.bulletFields) ? job.bulletFields.join(', ') : ''),
    url: `https://${tenant}.${host}.myworkdayjobs.com/${site}${job.externalPath || ''}`,
    description: '',
    salary: '',
    remote_type: /remote/i.test(job.locationsText || '') ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: '',
    job_handle: (Array.isArray(job.bulletFields) && job.bulletFields[0]) || '',
    source: 'workday',
  };
}
