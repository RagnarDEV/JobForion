// src/lib/blog-automation/templates/salary.js
// Topic: "Highest Paying Remote Jobs This Week" — ONE aggregate article
// per calendar week (topicKey includes the ISO week, see util.js), built
// from the top disclosed-salary listings across every category. Naturally
// never duplicates within the same week since the topicKey itself changes
// every Monday.

import { escapeHtml, slugify } from '../../entities.js';
import { getTopPayingJobs } from '../data-analyzer.js';
import { isoWeekKey, formatDateHuman } from '../util.js';

export const id = 'salary';
export const label = 'Highest Paying Jobs (Weekly)';
export const settingsKey = 'blog_auto_topics_salary';

export async function getCandidates(env, minJobs) {
  const jobs = await getTopPayingJobs(env, Math.max(minJobs, 10));
  if (jobs.length < Math.max(minJobs, 3)) return [];
  const week = isoWeekKey();
  return [{ topicKey: `salary:${week}`, entityLabel: 'Highest Paying Jobs', jobCount: jobs.length, meta: { jobs, week } }];
}

export async function render(env, candidate, settings, base) {
  const { jobs, week } = candidate.meta;
  const jobsPerArticle = parseInt(settings.blog_auto_jobs_per_article || '8', 10);
  const top = jobs.slice(0, jobsPerArticle);
  const dateLabel = formatDateHuman();

  const title = `Highest Paying Remote Jobs This Week (${dateLabel})`;
  const excerpt = `A live look at the ${top.length} highest-paying remote job listings currently open, ranked by disclosed salary.`;

  const body = [
    `<p>Here are the highest-paying remote positions currently open on our board, ranked by disclosed salary — pulled live from active listings as of ${escapeHtml(dateLabel)}.</p>`,
    `<h2>Top Paying Roles Right Now</h2><ol>${top.map(j => `<li><a href="/job/${j.id}">${escapeHtml(j.title)}</a> at <a href="/companies/${slugify(j.company)}">${escapeHtml(j.company)}</a> — <strong>${escapeHtml(j.salary || '')}</strong></li>`).join('')}</ol>`,
    `<h2>FAQ</h2><p><strong>How is this ranked?</strong> By the highest disclosed salary figure on each listing, parsed directly from the employer's own posting — not an estimate.</p><p><strong>Why don't all high-paying jobs show a salary?</strong> Many employers don't disclose pay publicly; this list only includes roles where a figure was actually provided.</p>`,
    `<p><a href="/">Browse all open remote jobs →</a></p>`,
  ].join('\n');

  return {
    title,
    slugBase: `highest-paying-remote-jobs-${week.toLowerCase()}`,
    excerpt,
    body,
    category: 'Salary Insights',
    tags: ['Salary', 'Remote Jobs', 'Weekly Report'],
    readTime: '4 min read',
    seoTitleHint: `Highest Paying Remote Jobs This Week — ${dateLabel}`,
    seoDescriptionHint: `The top ${top.length} highest-paying remote jobs open right now, ranked by disclosed salary. Updated weekly.`,
  };
}
