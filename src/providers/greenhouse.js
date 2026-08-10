// src/providers/greenhouse.js
// Provider: Greenhouse job boards — fully public, no auth of any kind.
// The "company" field holds the board token(s) used in
// boards.greenhouse.io/<token> — comma-separated tokens are still
// supported in a single row for backward compatibility, but the admin UI
// now normally creates one row per company via bulk-add instead.
export const id = 'greenhouse';
export const displayName = 'Greenhouse';
export const keyFormatHint = 'board token from boards.greenhouse.io/<token> — e.g. airbnb';
export const ignoresQuery = true;

export async function fetchJobs({ company, timeoutMs = 15000 } = {}) {
  const tokens = String(company || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!tokens.length) throw new Error('No board token provided');

  const allJobs = [];
  let lastError = null;

  for (const boardToken of tokens) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) { lastError = new Error(`HTTP ${res.status} (${boardToken})`); continue; }
      const data = await res.json();
      allJobs.push(...(data.jobs || []).map(j => map(j, boardToken)));
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }

  // Only fail the whole entry if EVERY token failed — a single bad/expired
  // board token among several must not sink the good ones.
  if (!allJobs.length && lastError) throw lastError;
  return allJobs.filter(j => j.url);
}

function map(job, boardToken) {
  const locName = (job.location && job.location.name) || '';
  return {
    title: job.title || 'Unknown',
    company: boardToken,
    location: locName,
    url: job.absolute_url || '',
    description: (job.content || '').replace(/<[^>]+>/g, ' ').slice(0, 5000),
    salary: '',
    remote_type: /remote/i.test(locName) ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: '',
    job_handle: String(job.id || ''),
    source: 'greenhouse',
  };
}
