// src/lib/blog-automation/templates/country.js
// Topic: "Remote Jobs in {Country}" — one article per country/region that
// currently has enough open listings (derived from jobs.location, see
// lib/entities.js's listCountries/jobsByRegion).

import { escapeHtml, slugify, jobsByRegion } from '../../entities.js';
import { countryFlag } from '../../country-flags.js';
import { getCountryCandidates } from '../data-analyzer.js';

export const id = 'country';
export const label = 'Country Spotlight';
export const settingsKey = 'blog_auto_topics_country';

export async function getCandidates(env, minJobs) {
  const countries = await getCountryCandidates(env, minJobs);
  return countries.slice(0, 30).map(c => ({ topicKey: `country:${c.slug}`, entityLabel: c.name, jobCount: c.count, meta: c }));
}

export async function render(env, candidate, settings, base) {
  const c = candidate.meta;
  const jobsPerArticle = parseInt(settings.blog_auto_jobs_per_article || '8', 10);
  const jobs = await jobsByRegion(env, c.rawNames || c.name, { limit: Math.max(jobsPerArticle, 20) });
  const companies = [...new Set((jobs || []).map(j => j.company).filter(Boolean))];
  const flag = countryFlag(c.name);

  const title = `${flag} Remote Jobs in ${c.name}: ${candidate.jobCount} Open Positions`;
  const excerpt = `${candidate.jobCount} remote jobs are currently open for candidates in or hiring from ${c.name}. Browse live listings and companies hiring.`;

  const body = [
    `<p>There are <strong>${candidate.jobCount} open remote positions</strong> right now located in or hiring from <strong>${escapeHtml(c.name)}</strong>, across ${companies.length} companies.</p>`,
    companies.length ? `<h2>Companies Hiring in ${escapeHtml(c.name)}</h2><ul>${companies.slice(0, 10).map(name => `<li><a href="/companies/${slugify(name)}">${escapeHtml(name)}</a></li>`).join('')}</ul>` : '',
    `<h2>Latest Openings in ${escapeHtml(c.name)}</h2><ul>${(jobs || []).slice(0, jobsPerArticle).map(j => `<li><a href="/job/${j.id}">${escapeHtml(j.title)}</a> at ${escapeHtml(j.company)}${j.salary ? ` — ${escapeHtml(j.salary)}` : ''}</li>`).join('')}</ul>`,
    `<h2>FAQ</h2><p><strong>Are these fully remote?</strong> Most listings tied to a specific country are hybrid or require residency there; check each listing's remote-type tag before applying.</p>`,
    `<p><a href="/countries/${c.slug}">See all remote jobs in ${escapeHtml(c.name)} →</a></p>`,
  ].filter(Boolean).join('\n');

  return {
    title,
    slugBase: `remote-jobs-in-${c.slug}`,
    excerpt,
    body,
    category: 'Countries',
    tags: [c.name, 'Remote Jobs', 'Location'],
    readTime: '4 min read',
    seoTitleHint: `Remote Jobs in ${c.name} (${candidate.jobCount} Open) — Updated Daily`,
    seoDescriptionHint: `${candidate.jobCount} remote jobs open now in ${c.name}. Live listings and companies hiring, updated automatically.`,
  };
}
