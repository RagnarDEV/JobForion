// src/lib/platform/job-window.js
// Bounded-cost building blocks for the D1 FREE-TIER ROW-READ BUDGET
// (5M rows read/day; every SCANNED row counts). See lib/platform/site-cache.js.
//
//   windowedJobs()  — a FROM-clause subquery of the most recent N active jobs
//                     (id-descending, index-driven: reads exactly N rows). Use
//                     it for anything an index cannot serve (LIKE, json_each,
//                     multi-filter) so the cost is bounded no matter how large
//                     the catalogue grows.
//   cappedCount()   — COUNT(*) that stops counting at `cap` rows.

import { PUBLIC_JOB_STATUS_SQL, DIRECTORY_WINDOW, COUNT_CAP } from '../../config/constants.js';

export function windowedJobs(size = DIRECTORY_WINDOW) {
  return `(SELECT * FROM jobs WHERE ${PUBLIC_JOB_STATUS_SQL} ORDER BY id DESC LIMIT ${Math.max(1, Math.min(20000, Number(size) | 0))}) AS jobs`;
}

// `fromSql` is a table / windowedJobs() expression, `whereSql` may be ''.
// `indexHint` (optional): forces a specific index via SQLite's INDEXED BY when
// the query planner would otherwise pick a WORSE index for this exact WHERE
// clause (verified case: a partial index built for `WHERE col IS NULL` losing
// out to a wider composite index that still exists on the same column). Only
// pass this for a `fromSql` of a bare table name with an index created in the
// same schema migration — if the index doesn't exist yet (the narrow post-
// deploy window before a resumable migration reaches it), this call falls
// back to the same query without the hint rather than throwing.
export async function cappedCount(env, fromSql, whereSql = '', binds = [], cap = COUNT_CAP, indexHint = null) {
  const where = whereSql ? ` WHERE ${whereSql}` : '';
  const limit = Math.max(1, Number(cap) | 0);
  const run = async (indexed) => {
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM (SELECT 1 FROM ${fromSql}${indexed}${where} LIMIT ${limit})`
    ).bind(...binds).all();
    return Number(results?.[0]?.c || 0);
  };
  if (!indexHint) return run('');
  try { return await run(` INDEXED BY ${indexHint}`); } catch (e) { return run(''); }
}
