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

import * as jobdatalake from './jobdatalake.js';
import * as linkedin from './linkedin.js';
import * as arbeitnow from './arbeitnow.js';
import * as remotive from './remotive.js';
import * as jsearch from './jsearch.js';
import * as adzuna from './adzuna.js';
import * as greenhouse from './greenhouse.js';
import * as lever from './lever.js';
import * as ashby from './ashby.js';

export const PROVIDERS = {
  jobdatalake,
  linkedin_rapidapi: linkedin,
  arbeitnow,
  remotive,
  jsearch,
  adzuna,
  greenhouse,
  lever,
  ashby,
};
