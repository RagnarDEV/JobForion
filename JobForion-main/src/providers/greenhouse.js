// src/providers/greenhouse.js
// Provider: Greenhouse job boards — public per-company API, no auth key.
// The "api_key" field for this provider holds one or more board tokens
// (the slug in boards.greenhouse.io/<token>), separated by commas —
// e.g. "airbnb, figma, netflix" — so a single "Add Source" entry can pull
// from several companies at once instead of needing one entry per board.
export const id = 'greenhouse';
export const needsKey = true;
export const keyFormatHint = 'board token(s), comma-separated — e.g. airbnb, figma';
export const ignoresQuery = true;

export async function fetchJobs({ apiKey, timeoutMs = 15000 } = {}) {
  const tokens = String(apiKey || '').split(',').map(t => t.trim()).filter(Boolean);
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

  // Only fail the whole entry if EVERY token failed. A single bad/expired
  // board token among several must not sink the good ones — that's exactly
  // what was happening before (one 404 board token, correctly reported,
  // but each token lived in its own separate source row with no shared
  // fallback).
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
