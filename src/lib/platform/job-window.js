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
export async function cappedCount(env, fromSql, whereSql = '', binds = [], cap = COUNT_CAP) {
  const where = whereSql ? ` WHERE ${whereSql}` : '';
  const { results } = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM (SELECT 1 FROM ${fromSql}${where} LIMIT ${Math.max(1, Number(cap) | 0)})`
  ).bind(...binds).all();
  return Number(results?.[0]?.c || 0);
}
