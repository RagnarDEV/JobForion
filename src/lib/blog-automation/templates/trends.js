// src/lib/blog-automation/templates/trends.js
// Topic: "Most In-Demand Remote Skills This Week" — ONE aggregate article
// per calendar week ranking skills by how many open listings require
// them. Same weekly-topicKey pattern as templates/salary.js.

import { escapeHtml } from '../../entities.js';
import { getSkillCandidates, getTotalActiveJobs } from '../data-analyzer.js';
import { isoWeekKey, formatDateHuman } from '../util.js';

export const id = 'trends';
export const label = 'In-Demand Skills (Weekly)';
export const settingsKey = 'blog_auto_topics_trends';

export async function getCandidates(env, minJobs) {
  const skills = await getSkillCandidates(env, minJobs);
  if (skills.length < Math.max(minJobs, 3)) return [];
  const week = isoWeekKey();
  const totalJobs = await getTotalActiveJobs(env);
  return [{ topicKey: `trends:${week}`, entityLabel: 'In-Demand Skills', jobCount: skills.length, meta: { skills, week, totalJobs } }];
}

export async function render(env, candidate, settings, base) {
  const { skills, week, totalJobs } = candidate.meta;
  const top = skills.slice(0, 10);
  const dateLabel = formatDateHuman();

  const title = `Most In-Demand Remote Skills This Week (${dateLabel})`;
  const excerpt = `The ${top.length} most-requested skills across ${totalJobs.toLocaleString()} active remote job listings this week.`;

  const body = [
    `<p>Across <strong>${totalJobs.toLocaleString()} currently open remote listings</strong>, here are the skills employers are asking for most, ranked by how many job postings list them as required — as of ${escapeHtml(dateLabel)}.</p>`,
    `<h2>Top ${top.length} Skills in Demand</h2><ol>${top.map(s => `<li><a href="/skills/${s.slug}">${escapeHtml(s.name)}</a> — ${s.count} open role${s.count === 1 ? '' : 's'}</li>`).join('')}</ol>`,
    `<h2>FAQ</h2><p><strong>How is this measured?</strong> By counting how many currently-open listings name each skill as a requirement, using the same live data that powers our <a href="/skills">skills directory</a>.</p>`,
    `<p><a href="/skills">Browse all in-demand remote skills →</a></p>`,
  ].join('\n');

  return {
    title,
    slugBase: `most-in-demand-remote-skills-${week.toLowerCase()}`,
    excerpt,
    body,
    category: 'Trends',
    tags: ['Trends', 'Skills', 'Weekly Report'],
    readTime: '4 min read',
    seoTitleHint: `Most In-Demand Remote Skills — ${dateLabel}`,
    seoDescriptionHint: `The top ${top.length} most-requested skills across ${totalJobs.toLocaleString()} active remote job listings this week.`,
  };
}
