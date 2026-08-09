// src/providers/index.js
// Registry — the ONLY place that lists every provider module. To add a new
// job source in the future: create src/providers/newsource.js implementing
// the same contract (see below), then add one line here. Nothing in
// src/db/sync.js ever needs to change.
//
// Provider contract every module must follow:
//   export const id = 'my_provider';           // matches api_sources.provider
//   export const needsKey = true | false;      // false for keyless public APIs
//   export const ignoresQuery = true | false;   // true = called once per sync,
//                                                //  not once per search keyword
//   export async function fetchJobs({ apiKey, query, timeoutMs }) {
//     return [ { title, company, location, url, description, salary,
//                remote_type, skills /* array */, seniority,
//                employment_type, job_handle, source }, ... ];
//   }
//   fetchJobs() only fetches + maps — it NEVER writes to the database.
//   Throw on failure; the orchestrator in src/db/sync.js handles
//   retries/timeouts/logging.
//
// All 9 current providers are per-company/tenant ATS boards
// (ignoresQuery=true — called once per sync, never per search keyword).
// Each "api_key" field in /admin holds a company identifier, subdomain,
// URL, or token — never a generic aggregator key — see each module's
// keyFormatHint for the exact value to paste.

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
