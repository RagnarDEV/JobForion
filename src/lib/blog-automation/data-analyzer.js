// src/lib/blog-automation/data-analyzer.js
// ════════════════════════════════════════════════════════════════
// DATA ANALYZER — the only place blog-automation code queries D1 for
// "is there enough real data to write about X?" candidate lists. Every
// function here returns ONLY entities that already clear a minimum job
// count, so a topic template never even sees an option it couldn't write
// a useful article about (see the Quality Gate flow in the plan: this is
// the "does data exist" half of it — src/lib/blog-automation/quality-gate.js
// is the second, content-level half).
//
// Deliberately thin: reuses lib/entities.js and lib/categories.js (the
// exact same functions the public /categories, /companies, /skills,
// /countries pages already use) rather than re-implementing aggregation
// logic. Adding a genuinely new analysis (e.g. "fastest growing skill")
// is one function here, not a new subsystem.
// ════════════════════════════════════════════════════════════════

import { getCategories } from '../categories.js';
import { listCompanies, listSkills, listCountries } from '../entities.js';

export async function getCategoryCandidates(env, minJobs) {
  const categories = await getCategories(env);
  const out = [];
  for (const c of categories) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT COUNT(*) c FROM jobs WHERE LOWER(title) LIKE ?`
      ).bind(`%${c.key}%`).all();
      const count = results?.[0]?.c || 0;
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
    const { results } = await env.DB.prepare('SELECT COUNT(*) c FROM jobs').all();
    return results?.[0]?.c || 0;
  } catch (e) { return 0; }
}

export async function getNewJobsSince(env, days = 7) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) c FROM jobs WHERE created_at >= datetime('now','-' || ? || ' day')`
    ).bind(days).all();
    return results?.[0]?.c || 0;
  } catch (e) { return 0; }
}

export async function getNewestJobs(env, limit = 14) {
  try {
    const { results } = await env.DB.prepare(`SELECT * FROM jobs ORDER BY id DESC LIMIT ?`).bind(limit).all();
    return results || [];
  } catch (e) { return []; }
}

// Highest-paying currently-open listings, using the pre-computed
// salary_min_usd/salary_max_usd columns (see lib/salary.js — parsed once
// at sync time, not re-parsed here).
export async function getTopPayingJobs(env, limit = 10) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM jobs WHERE salary_min_usd IS NOT NULL AND salary_min_usd > 0
       ORDER BY salary_max_usd DESC, salary_min_usd DESC LIMIT ?`
    ).bind(limit).all();
    return results || [];
  } catch (e) { return []; }
}
