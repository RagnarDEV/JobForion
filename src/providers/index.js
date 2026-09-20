// src/providers/index.js
// Registry of ATS-native job providers. Every provider is *keyless* — the
// only thing an admin ever types in is a company's public career-site
// identifier (a slug), never an API key or URL. This keeps the whole sync
// system compatible with Cloudflare's free-plan subrequest budget: each
// provider makes exactly ONE outbound fetch per company per sync run, no
// per-keyword search loops like the old key-based providers used to.
//
// Provider contract every module must follow:
//   export const id = 'my_provider';                 // matches api_sources.provider
//   export const displayName = 'My Provider';         // shown in the admin UI
//   export const keyFormatHint = 'what to type in the company field';
//   export const ignoresQuery = true;                 // always true now
//   export async function fetchJobs({ company, timeoutMs }) {
//     return [ { title, company, location, url, description, salary,
//                remote_type, skills /* array */, seniority,
//                employment_type, job_handle, source }, ... ];
//   }
//   fetchJobs() only fetches + maps — it NEVER writes to the database.
//   Throw on failure; src/db/sync.js handles retries/timeouts/logging, and
//   one broken company never blocks the others in the same run.
//
// To add a new provider in the future: create src/providers/newsource.js
// implementing this contract, then add one line below. Nothing in
// src/db/sync.js or the admin dashboard ever needs to change.

import * as greenhouse from './greenhouse.js';
import * as lever from './lever.js';
import * as ashby from './ashby.js';
import * as smartrecruiters from './smartrecruiters.js';
import * as workable from './workable.js';
import * as teamtailor from './teamtailor.js';
import * as recruitee from './recruitee.js';
import * as workday from './workday.js';
import * as icims from './icims.js';

export const PROVIDERS = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  teamtailor,
  recruitee,
  workday,
  icims,
};
