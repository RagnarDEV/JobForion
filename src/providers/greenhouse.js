// src/providers/greenhouse.js
// Provider: Greenhouse job boards — public per-company API, no auth key.
// The "api_key" field for this provider holds one or more board tokens
// (the slug in boards.greenhouse.io/<token>), separated by commas —
// e.g. "airbnb, figma, netflix" — so a single "Add Source" entry can pull
// from several companies at once instead of needing one entry per board.
import { pickRotatingWindow, syncSlot } from '../lib/platform/rotation.js';

export const id = 'greenhouse';
export const needsKey = true;
export const keyFormatHint = 'board token(s), comma-separated — e.g. airbnb, figma. Large lists (10+) are processed a few at a time per run automatically — see MAX_BOARDS_PER_RUN below.';
export const ignoresQuery = true;

// SAFETY CAP: this is what actually failed when 20 board tokens were put
// in one source — the API fetches `content=true` (full HTML job bodies)
// for every posting on every board, sequentially, in a single sync.js
// invocation. 20 external fetches plus their combined payload size is
// exactly what blows past both Cloudflare's per-invocation subrequest
// ceiling and reasonable execution time. Only this many boards are fetched
// per run; the rest rotate in on later runs (see pickTokensForThisRun
// below) instead of a single run ever trying to hit all of them at once.
export const MAX_BOARDS_PER_RUN = 5;

// Rotates which slice of tokens gets processed this run. The window advances by
// exactly one per scheduled sync (every 3 hours — lib/platform/rotation.js), so with
// 20 tokens and a cap of 5 every board is synced once every 4 runs (12 hours). The
// previous hour-based counter skipped windows once the cron moved off a 1-hour
// cadence. No D1 state needed: a pure function of time and the token list.
function pickTokensForThisRun(tokens) {
  return pickRotatingWindow(tokens, MAX_BOARDS_PER_RUN, syncSlot());
}

export async function fetchJobs({ apiKey, timeoutMs = 15000 } = {}) {
  const allTokens = String(apiKey || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!allTokens.length) throw new Error('No board token provided');
  const tokens = pickTokensForThisRun(allTokens);

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

  // Only fail the whole entry if EVERY token in THIS run's slice failed. A
  // single bad/expired board token among several must not sink the good
  // ones.
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
