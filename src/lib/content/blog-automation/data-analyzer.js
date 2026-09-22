// src/lib/content/blog-automation/data-analyzer.js
// ════════════════════════════════════════════════════════════════
// DATA ANALYZER — the only place blog-automation code queries D1 for
// "is there enough real data to write about X?" candidate lists. Every
// function here returns ONLY entities that already clear a minimum job
// count, so a topic template never even sees an option it couldn't write
// a useful article about (see the Quality Gate flow in the plan: this is
// the "does data exist" half of it — src/lib/content/blog-automation/quality-gate.js
// is the second, content-level half).
//
// Deliberately thin: reuses lib/directory/entities.js and lib/content/categories.js (the
// exact same functions the public /categories, /companies, /skills,
// /countries pages already use) rather than re-implementing aggregation
// logic. Adding a genuinely new analysis (e.g. "fastest growing skill")
// is one function here, not a new subsystem.
// ════════════════════════════════════════════════════════════════

import { getCategories } from '../categories.js';
import { listCompanies, listSkills, listCountries } from '../../directory/entities.js';
import { PUBLIC_JOB_STATUS_SQL } from '../../../config/constants.js';
import { getSiteStats, readSiteCache } from '../../platform/site-cache.js';
import { windowedJobs } from '../../platform/job-window.js';

export async function getCategoryCandidates(env, minJobs) {
  const categories = await getCategories(env);
  // ROW-READ BUDGET: precomputed per-category counts (1 row) instead of a
  // LIKE scan of the whole jobs table for every category.
  const cachedCounts = await readSiteCache(env, 'cat:counts');
  const out = [];
  for (const c of categories) {
    try {
      let count;
      if (cachedCounts && cachedCounts[String(c.key).toLowerCase()] !== undefined) {
        count = Number(cachedCounts[String(c.key).toLowerCase()] || 0);
      } else {
        const { results } = await env.DB.prepare(
          `SELECT COUNT(*) c FROM ${windowedJobs()} WHERE LOWER(title) LIKE ?`
        ).bind(`%${c.key}%`).all();
        count = results?.[0]?.c || 0;
      }
      if (count >= minJobs) out.push({ key: c.key, label: c.label, emoji: c.emoji, color: c.color, count });
    } catch (e) { /* skip this category, others still get a chance */ }
  }
  return out.sort((a, b) => b.count - a.count);
}

export async function getSkillCandidates(env, minJobs) {
  const skills = await listSkills(env, { limit: 80 });
  return skills.filter(s => s.count >= minJobs);
}

export async function getCountryCandidates(env, minJobs) {
  const countries = await listCountries(env, { limit: 80 });
  // "Remote" itself isn't a country — excluded so the template never
  // tries to write "Remote Jobs in Remote".
  return countries.filter(c => c.count >= minJobs && c.name.toLowerCase() !== 'remote');
}

export async function getCompanyCandidates(env, minJobs) {
  const companies = await listCompanies(env, { limit: 80 });
  return companies.filter(c => c.count >= minJobs);
}

export async function getTotalActiveJobs(env) {
  try {
    // ROW-READ BUDGET: precomputed total (0 D1 rows) instead of a live COUNT(*)
    // over every active job, run separately by every blog-automation template
    // that needs a headline number.
    const stats = await getSiteStats(env);
    if (stats) return Number(stats.totalActive || 0);
    const { results } = await env.DB.prepare(`SELECT COUNT(*) c FROM jobs WHERE ${PUBLIC_JOB_STATUS_SQL}`).all();
    return results?.[0]?.c || 0;
  } catch (e) { return 0; }
}

export async function getNewJobsSince(env, days = 7) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) c FROM jobs WHERE created_at >= datetime('now','-' || ? || ' day') AND ${PUBLIC_JOB_STATUS_SQL}`
    ).bind(days).all();
    return results?.[0]?.c || 0;
  } catch (e) { return 0; }
}

export async function getNewestJobs(env, limit = 14) {
  try {
    const { results } = await env.DB.prepare(`SELECT * FROM jobs WHERE ${PUBLIC_JOB_STATUS_SQL} ORDER BY id DESC LIMIT ?`).bind(limit).all();
    return results || [];
  } catch (e) { return []; }
}

// Highest-paying currently-open listings, using the pre-computed
// salary_min_usd/salary_max_usd columns (see lib/jobs/salary.js — parsed once
// at sync time, not re-parsed here).
export async function getTopPayingJobs(env, limit = 10) {
  try {
    // ROW-READ BUDGET: there is no index that can satisfy "ORDER BY salary DESC"
    // (salary_min_usd/salary_max_usd aren't sortable via an index here), so SQLite
    // materializes and sorts every matching row before LIMIT applies — bounded to
    // the most recent DIRECTORY_WINDOW active jobs instead of the whole table.
    const { results } = await env.DB.prepare(
      `SELECT * FROM ${windowedJobs()} WHERE salary_min_usd IS NOT NULL AND salary_min_usd > 0
       ORDER BY salary_max_usd DESC, salary_min_usd DESC LIMIT ?`
    ).bind(limit).all();
    return results || [];
  } catch (e) { return []; }
}
