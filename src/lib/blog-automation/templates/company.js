// src/lib/blog-automation/templates/company.js
// Topic: "{Company} Is Hiring" — one article per company that currently
// has enough open listings. Also doubles as the "Companies With the Most
// Remote Jobs" angle, since candidates are naturally ranked by count.

import { escapeHtml, slugify, jobsByCompany, companySnapshot } from '../../entities.js';
import { getCompanyCandidates } from '../data-analyzer.js';

export const id = 'company';
export const label = 'Company Spotlight';
export const settingsKey = 'blog_auto_topics_company';

export async function getCandidates(env, minJobs) {
  const companies = await getCompanyCandidates(env, minJobs);
  return companies.slice(0, 30).map(c => ({ topicKey: `company:${c.slug}`, entityLabel: c.name, jobCount: c.count, meta: c }));
}

export async function render(env, candidate, settings, base) {
  const c = candidate.meta;
  const jobsPerArticle = parseInt(settings.blog_auto_jobs_per_article || '8', 10);
  const [jobs, snapshot] = await Promise.all([
    jobsByCompany(env, c.name, { limit: Math.max(jobsPerArticle, 20) }),
    companySnapshot(env, c.name),
  ]);
  const locations = [...new Set((jobs || []).map(j => j.location).filter(Boolean))].slice(0, 6);

  const title = `${c.name} Is Hiring: ${candidate.jobCount} Remote Jobs Open Now`;
  const excerpt = `${c.name} currently has ${candidate.jobCount} open remote positions. See every open role, locations, and how to apply.`;

  const body = [
    `<p><strong>${escapeHtml(c.name)}</strong> currently has <strong>${candidate.jobCount} open remote position${candidate.jobCount === 1 ? '' : 's'}</strong> listed on our board${snapshot?.firstSeen ? `, and has been posting here since ${new Date(snapshot.firstSeen).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` : ''}.</p>`,
    locations.length ? `<h2>Where ${escapeHtml(c.name)} Is Hiring</h2><ul>${locations.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '',
    `<h2>Open Roles at ${escapeHtml(c.name)}</h2><ul>${(jobs || []).slice(0, jobsPerArticle).map(j => `<li><a href="/job/${j.id}">${escapeHtml(j.title)}</a>${j.location ? ` — ${escapeHtml(j.location)}` : ''}${j.salary ? ` — ${escapeHtml(j.salary)}` : ''}</li>`).join('')}</ul>`,
    `<h2>FAQ</h2><p><strong>How do I apply to ${escapeHtml(c.name)}?</strong> Every listing links directly to ${escapeHtml(c.name)}'s own application page — apply straight through the employer, no middleman.</p>`,
    `<p><a href="/companies/${c.slug}">See every open role at ${escapeHtml(c.name)} →</a></p>`,
  ].filter(Boolean).join('\n');

  return {
    title,
    slugBase: `${c.slug}-is-hiring-remote`,
    excerpt,
    body,
    category: 'Companies',
    tags: [c.name, 'Remote Jobs', 'Hiring Now'],
    readTime: '3 min read',
    seoTitleHint: `${c.name} Remote Jobs (${candidate.jobCount} Open) — Apply Now`,
    seoDescriptionHint: `${c.name} has ${candidate.jobCount} open remote jobs right now. Browse every role and apply directly.`,
  };
}
