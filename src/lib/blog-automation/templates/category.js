// src/lib/blog-automation/templates/category.js
// Topic: "Remote {Category} Jobs" — one article per job category that
// currently has enough open listings. Every figure in the article is
// read live from D1 at generation time; nothing is invented.

import { escapeHtml, slugify, categorySalaryStats } from '../../entities.js';
import { JOB_TYPE_SORT_SQL } from '../../../config/constants.js';
import { getCategoryCandidates } from '../data-analyzer.js';

export const id = 'category';
export const label = 'Category Spotlight';
export const settingsKey = 'blog_auto_topics_category';

export async function getCandidates(env, minJobs) {
  const cats = await getCategoryCandidates(env, minJobs);
  return cats.map(c => ({ topicKey: `category:${c.key}`, entityLabel: c.label, jobCount: c.count, meta: c }));
}

export async function render(env, candidate, settings, base) {
  const c = candidate.meta;
  const jobsPerArticle = parseInt(settings.blog_auto_jobs_per_article || '8', 10);
  const companiesPerArticle = parseInt(settings.blog_auto_companies_per_article || '6', 10);

  const { results: jobs } = await env.DB.prepare(
    `SELECT * FROM jobs WHERE LOWER(title) LIKE ? ORDER BY ${JOB_TYPE_SORT_SQL} ASC, id DESC LIMIT ?`
  ).bind(`%${c.key}%`, Math.max(jobsPerArticle, 20)).all();

  const companyCounts = new Map();
  for (const j of jobs || []) { if (j.company) companyCounts.set(j.company, (companyCounts.get(j.company) || 0) + 1); }
  const topCompanies = [...companyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, companiesPerArticle);
  const remoteCount = (jobs || []).filter(j => j.remote_type === 'fully_remote').length;
  const salaryStats = await categorySalaryStats(env, c.key);

  const title = `Remote ${c.label} Jobs: ${candidate.jobCount}+ Open Positions Hiring Now`;
  const excerpt = `${candidate.jobCount} remote ${c.label.toLowerCase()} jobs are open right now across ${topCompanies.length}+ companies. Live salary ranges, top hiring companies, and the newest listings.`;

  const body = [
    `<p>There are currently <strong>${candidate.jobCount} open remote ${escapeHtml(c.label.toLowerCase())} positions</strong> listed on our board, spanning ${topCompanies.length}+ companies. Here's a live snapshot of the market, pulled directly from active listings.</p>`,
    `<h2>Market Snapshot</h2><ul>`
      + `<li><strong>${candidate.jobCount}</strong> open ${escapeHtml(c.label.toLowerCase())} roles right now</li>`
      + `<li><strong>${remoteCount}</strong> are fully remote</li>`
      + (salaryStats ? `<li>Average disclosed salary range: <strong>$${Math.round(salaryStats.avgMin / 1000)}k–$${Math.round(salaryStats.avgMax / 1000)}k</strong> (based on ${salaryStats.count} listings with pay disclosed)</li>` : '')
      + `</ul>`,
    topCompanies.length ? `<h2>Companies Hiring ${escapeHtml(c.label)} Talent</h2><ul>${topCompanies.map(([name, count]) => `<li><a href="/companies/${slugify(name)}">${escapeHtml(name)}</a> — ${count} open role${count === 1 ? '' : 's'}</li>`).join('')}</ul>` : '',
    `<h2>Latest ${escapeHtml(c.label)} Openings</h2><ul>${(jobs || []).slice(0, jobsPerArticle).map(j => `<li><a href="/job/${j.id}">${escapeHtml(j.title)}</a> at <a href="/companies/${slugify(j.company)}">${escapeHtml(j.company)}</a>${j.salary ? ` — ${escapeHtml(j.salary)}` : ''}</li>`).join('')}</ul>`,
    `<h2>FAQ</h2><p><strong>How often is this updated?</strong> Our sync engine refreshes remote ${escapeHtml(c.label.toLowerCase())} listings automatically throughout the day, so these numbers reflect positions open right now, not a stale snapshot.</p><p><strong>How do I apply?</strong> Every listing links straight to the employer's own application page — no extra account required.</p>`,
    `<p><a href="/categories/${c.key}">Browse all remote ${escapeHtml(c.label.toLowerCase())} jobs →</a></p>`,
  ].filter(Boolean).join('\n');

  return {
    title,
    slugBase: `remote-${c.key}-jobs`,
    excerpt,
    body,
    category: c.label,
    tags: [c.label, 'Remote Jobs', 'Hiring Now'],
    readTime: '4 min read',
    seoTitleHint: `Remote ${c.label} Jobs (${candidate.jobCount} Open) — Updated Daily`,
    seoDescriptionHint: `Browse ${candidate.jobCount} remote ${c.label.toLowerCase()} jobs from ${topCompanies.length}+ companies. Live listings, salary ranges, and direct apply links.`,
  };
}
