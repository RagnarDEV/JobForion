// src/lib/blog-automation/templates/skill.js
// Topic: "Remote {Skill} Jobs" — one article per required skill that
// currently appears on enough open listings (parsed from jobs.skills,
// see lib/entities.js's listSkills/jobsBySkill).

import { escapeHtml, slugify, jobsBySkill } from '../../entities.js';
import { getSkillCandidates } from '../data-analyzer.js';

export const id = 'skill';
export const label = 'Skill Spotlight';
export const settingsKey = 'blog_auto_topics_skill';

export async function getCandidates(env, minJobs) {
  const skills = await getSkillCandidates(env, minJobs);
  // Bounded to the top 30 by count — writing about the 200th rarest skill
  // isn't a useful article even if it technically clears minJobs.
  return skills.slice(0, 30).map(s => ({ topicKey: `skill:${s.slug}`, entityLabel: s.name, jobCount: s.count, meta: s }));
}

export async function render(env, candidate, settings, base) {
  const s = candidate.meta;
  const jobsPerArticle = parseInt(settings.blog_auto_jobs_per_article || '8', 10);
  const jobs = await jobsBySkill(env, s.rawNames || s.name, { limit: Math.max(jobsPerArticle, 20) });
  const companies = [...new Set((jobs || []).map(j => j.company).filter(Boolean))];

  const title = `Remote ${s.name} Jobs: ${candidate.jobCount} Open Roles Right Now`;
  const excerpt = `${candidate.jobCount} remote jobs currently require ${s.name}. See who's hiring, open roles, and live salary data.`;

  const body = [
    `<p><strong>${escapeHtml(s.name)}</strong> is listed as a required skill on <strong>${candidate.jobCount} open remote positions</strong> across ${companies.length} companies on our board right now.</p>`,
    companies.length ? `<h2>Who's Hiring for ${escapeHtml(s.name)}</h2><ul>${companies.slice(0, 10).map(c => `<li><a href="/companies/${slugify(c)}">${escapeHtml(c)}</a></li>`).join('')}</ul>` : '',
    `<h2>Open Positions Requiring ${escapeHtml(s.name)}</h2><ul>${(jobs || []).slice(0, jobsPerArticle).map(j => `<li><a href="/job/${j.id}">${escapeHtml(j.title)}</a> at ${escapeHtml(j.company)}${j.salary ? ` — ${escapeHtml(j.salary)}` : ''}</li>`).join('')}</ul>`,
    `<h2>FAQ</h2><p><strong>Is ${escapeHtml(s.name)} in demand for remote work?</strong> Based on current listings, ${candidate.jobCount} active remote roles name it as a requirement today — a live, verifiable number, not an estimate.</p>`,
    `<p><a href="/skills/${s.slug}">See all remote ${escapeHtml(s.name)} jobs →</a></p>`,
  ].filter(Boolean).join('\n');

  return {
    title,
    slugBase: `remote-${s.slug}-jobs`,
    excerpt,
    body,
    category: 'Skills',
    tags: [s.name, 'Remote Jobs', 'Skills in Demand'],
    readTime: '4 min read',
    seoTitleHint: `Remote ${s.name} Jobs (${candidate.jobCount} Open) — Apply Today`,
    seoDescriptionHint: `${candidate.jobCount} remote jobs need ${s.name} right now. Companies hiring and open roles, updated automatically.`,
  };
}
