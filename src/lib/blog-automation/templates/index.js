// src/lib/blog-automation/templates/index.js
// Registry — the ONLY place that lists every blog automation template. To
// add a new topic type in the future: create a new file here implementing
// the same contract, then add one line below. Nothing in generator.js
// ever needs to change (mirrors the exact pattern src/providers/index.js
// already uses for job-source providers).
//
// Template contract every module must follow:
//   export const id = 'my_template';               // stable, used as topicKey prefix + source_type
//   export const label = 'Human Readable Name';     // shown in the admin UI
//   export const settingsKey = 'blog_auto_topics_x'; // site_settings key that enables/disables it
//   export async function getCandidates(env, minJobs) {
//     return [{ topicKey, entityLabel, jobCount, meta }, ...];
//   }
//   export async function render(env, candidate, settings, base) {
//     return { title, slugBase, excerpt, body, category, tags, readTime, seoTitleHint, seoDescriptionHint };
//   }
//   getCandidates() only reads data — it NEVER writes to the database.
//   render() must only use REAL data already present in `candidate.meta`
//   or fetched live from D1 — no invented figures, no AI.

import * as category from './category.js';
import * as skill from './skill.js';
import * as country from './country.js';
import * as company from './company.js';
import * as salary from './salary.js';
import * as trends from './trends.js';
import * as weekly from './weekly.js';

export const TEMPLATES = [category, skill, country, company, salary, trends, weekly];
