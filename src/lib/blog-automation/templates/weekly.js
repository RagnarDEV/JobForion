// src/lib/blog-automation/templates/weekly.js
// Topic: "Latest Remote Job Opportunities — Week of {date}" — ONE
// aggregate digest per calendar week of the newest listings across every
// category, plus a quick market-size stat. Same weekly-topicKey pattern
// as templates/salary.js and templates/trends.js.

import { escapeHtml, slugify } from '../../entities.js';
import { getNewestJobs, getTotalActiveJobs, getNewJobsSince } from '../data-analyzer.js';
import { isoWeekKey, formatDateHuman } from '../util.js';

export const id = 'weekly';
export const label = 'Weekly Digest';
export const settingsKey = 'blog_auto_topics_weekly';

export async function getCandidates(env, minJobs) {
  const newThisWeek = await getNewJobsSince(env, 7);
  if (newThisWeek < Math.max(minJobs, 3)) return [];
  const week = isoWeekKey();
  const [jobs, totalJobs] = await Promise.all([getNewestJobs(env, 14), getTotalActiveJobs(env)]);
  return [{ topicKey: `weekly:${week}`, entityLabel: 'Weekly Digest', jobCount: newThisWeek, meta: { jobs, week, totalJobs, newThisWeek } }];
}

export async function render(env, candidate, settings, base) {
  const jobsPerArticle = parseInt(settings.blog_auto_jobs_per_article || '8', 10);
  const { jobs, week, totalJobs, newThisWeek } = candidate.meta;
  const dateLabel = formatDateHuman();
  const top = jobs.slice(0, jobsPerArticle);

  const title = `Latest Remote Job Opportunities — Week of ${dateLabel}`;
  const excerpt = `${newThisWeek} new remote jobs were added this week, bringing total open listings to ${totalJobs.toLocaleString()}. Here are the newest.`;

  const body = [
    `<p><strong>${newThisWeek} new remote job${newThisWeek === 1 ? ' was' : 's were'} added</strong> this week, bringing our total open listings to <strong>${totalJobs.toLocaleString()}</strong>. Here's a roundup of the newest opportunities.</p>`,
    `<h2>Newest Listings</h2><ul>${top.map(j => `<li><a href="/job/${j.id}">${escapeHtml(j.title)}</a> at <a href="/companies/${slugify(j.company)}">${escapeHtml(j.company)}</a>${j.location ? ` — ${escapeHtml(j.location)}` : ''}${j.salary ? ` — ${escapeHtml(j.salary)}` : ''}</li>`).join('')}</ul>`,
    `<h2>FAQ</h2><p><strong>How often is this list refreshed?</strong> Our sync engine checks every connected job source multiple times a day, so new roles typically appear within hours of being posted.</p>`,
    `<p><a href="/">Browse all ${totalJobs.toLocaleString()} open remote jobs →</a></p>`,
  ].join('\n');

  return {
    title,
    slugBase: `remote-jobs-week-of-${week.toLowerCase()}`,
    excerpt,
    body,
    category: 'Weekly Digest',
    tags: ['Weekly Digest', 'New Jobs', 'Remote Jobs'],
    readTime: '3 min read',
    seoTitleHint: `Latest Remote Jobs — Week of ${dateLabel}`,
    seoDescriptionHint: `${newThisWeek} new remote jobs added this week. ${totalJobs.toLocaleString()} total open listings — see what's new.`,
  };
}
