// src/lib/blog-automation/generator.js
// ════════════════════════════════════════════════════════════════
// GENERATION ORCHESTRATOR — the full pipeline described in the project
// plan, implemented as one linear function:
//
//   Check automation enabled → Check scheduled day → Check weekly limit
//   → Analyze available job data → Select best topic → Check duplicate
//   → Select template → Generate article → Generate SEO data
//   → Validate content (quality gate) → Save to D1 → Publish → Sitemap
//
// Called by the Worker's scheduled() handler (see src/index.js) on the
// dedicated blog-generation cron, and by the admin "Generate Now" button
// (src/routes/admin/blog-automation.router.js) with force=true for
// on-demand testing. Both paths run the exact same pipeline — there is
// no separate "manual" code path to drift out of sync.
//
// FAILURE HANDLING: if a candidate topic fails ANY check (duplicate,
// quality gate, save error), it is logged and the NEXT candidate topic is
// tried — up to MAX_ATTEMPTS. No incomplete/partial article is ever
// saved; a run that exhausts every candidate simply publishes nothing
// and logs why, exactly as the plan requires.
// ════════════════════════════════════════════════════════════════

import { getSettings } from '../settings.js';
import { TEMPLATES } from './templates/index.js';
import { isDuplicateTopic, isTitleTooSimilar } from './duplicate-check.js';
import { passesQualityGate } from './quality-gate.js';
import { buildSeoMeta } from './seo-engine.js';
import { createAutoPost, countAutoPostsPublishedSince } from '../blog-cms.js';
import { logBlogEvent } from './logger.js';
import { purgeSitemapCache } from './util.js';
import { BASE_URL } from '../../config/constants.js';

const MAX_ATTEMPTS = 6;

function isTodayScheduledDay(settings) {
  const days = String(settings.blog_auto_schedule_days || '0,2,4,6')
    .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n) && n >= 0 && n <= 6);
  if (!days.length) return true; // misconfigured → don't silently stop publishing
  return days.includes(new Date().getUTCDay());
}

export async function runBlogGeneration(env, { force = false, ctx = null } = {}) {
  const settings = await getSettings(env);

  if (settings.blog_auto_enabled === '0' && !force) {
    await logBlogEvent(env, 'generation_skipped', { reason: 'Automation is disabled' });
    return { skipped: true, reason: 'disabled' };
  }
  if (!force && !isTodayScheduledDay(settings)) {
    await logBlogEvent(env, 'generation_skipped', { reason: 'Today is not a scheduled publishing day' });
    return { skipped: true, reason: 'not_scheduled_day' };
  }

  const perWeek = parseInt(settings.blog_auto_articles_per_week || '4', 10);
  const publishedThisWeek = await countAutoPostsPublishedSince(env, 7);
  if (!force && publishedThisWeek >= perWeek) {
    await logBlogEvent(env, 'generation_skipped', { reason: 'Weekly article limit already reached', publishedThisWeek, perWeek });
    return { skipped: true, reason: 'weekly_limit_reached' };
  }

  const minJobs = Math.max(1, parseInt(settings.blog_auto_min_jobs || '3', 10));
  const cooldownDays = parseInt(settings.blog_auto_duplicate_cooldown_days || '21', 10);
  const enabledTemplates = TEMPLATES.filter(t => settings[t.settingsKey] !== '0');

  if (!enabledTemplates.length) {
    await logBlogEvent(env, 'generation_failed', { reason: 'No topic types are enabled in settings' });
    return { skipped: true, reason: 'no_templates_enabled' };
  }

  await logBlogEvent(env, 'generation_started', { publishedThisWeek, perWeek, force: !!force });

  // ── Analyze available job data → gather every candidate topic from
  // every enabled template (data-driven — see each template's
  // getCandidates()). ──────────────────────────────────────────────
  let allCandidates = [];
  for (const tpl of enabledTemplates) {
    try {
      const candidates = await tpl.getCandidates(env, minJobs);
      for (const c of candidates) allCandidates.push({ tpl, candidate: c });
    } catch (e) {
      await logBlogEvent(env, 'generation_failed', { template: tpl.id, reason: `Candidate lookup failed: ${String(e.message || e).slice(0, 200)}` });
    }
  }

  if (!allCandidates.length) {
    await logBlogEvent(env, 'insufficient_data', { reason: 'No topic currently has enough job data to write about' });
    return { skipped: true, reason: 'insufficient_data' };
  }

  // ── Select best topic — prioritize topics with the most supporting
  // data (a more useful, more substantial article), with light shuffling
  // so the SAME top topic doesn't win every single run. ──────────────
  allCandidates.sort(() => Math.random() - 0.5);
  allCandidates.sort((a, b) => (b.candidate.jobCount || 0) - (a.candidate.jobCount || 0));

  let attempts = 0;
  for (const { tpl, candidate } of allCandidates) {
    if (attempts >= MAX_ATTEMPTS) break;
    attempts++;

    try {
      // ── Check duplicate ──────────────────────────────────────────
      const dup = await isDuplicateTopic(env, candidate.topicKey, cooldownDays);
      if (dup) {
        await logBlogEvent(env, 'duplicate_detected', { template: tpl.id, topicKey: candidate.topicKey });
        continue;
      }

      await logBlogEvent(env, 'topic_selected', { template: tpl.id, topicKey: candidate.topicKey, entityLabel: candidate.entityLabel, jobCount: candidate.jobCount });

      // ── Generate article (template renders real D1 data) ──────────
      const rendered = await tpl.render(env, candidate, settings, BASE_URL);

      const tooSimilar = await isTitleTooSimilar(env, rendered.title);
      if (tooSimilar) {
        await logBlogEvent(env, 'duplicate_detected', { template: tpl.id, topicKey: candidate.topicKey, reason: 'Title too similar to an existing post' });
        continue;
      }

      // ── Validate content (quality gate) ────────────────────────────
      const gate = passesQualityGate(rendered, settings);
      if (!gate.pass) {
        await logBlogEvent(env, 'insufficient_data', { template: tpl.id, topicKey: candidate.topicKey, reasons: gate.reasons });
        continue;
      }

      // ── Generate SEO data ───────────────────────────────────────────
      const seo = buildSeoMeta({
        title: rendered.title, base: BASE_URL, slugBase: rendered.slugBase,
        seoTitleHint: rendered.seoTitleHint, seoDescriptionHint: rendered.seoDescriptionHint, excerpt: rendered.excerpt,
      });

      const shouldPublish = settings.blog_auto_publish !== '0';
      const autoExpire = settings.blog_auto_delete !== '0';
      const lifetimeDays = Math.max(1, parseInt(settings.blog_auto_lifetime_days || '45', 10));

      // ── Save to D1 → Publish ────────────────────────────────────────
      const postId = await createAutoPost(env, {
        title: rendered.title,
        slug: seo.slug,
        excerpt: rendered.excerpt,
        body: rendered.body,
        category: rendered.category,
        tags: rendered.tags,
        read_time: rendered.readTime,
        status: shouldPublish ? 'published' : 'draft',
        seo_title: seo.seoTitle,
        seo_description: seo.seoDescription,
        canonical_url: seo.canonicalUrl,
        auto_generated: true,
        auto_expire: autoExpire,
        lifetime_days: lifetimeDays,
        source_type: tpl.id,
        source_data: JSON.stringify({ topicKey: candidate.topicKey, entityLabel: candidate.entityLabel, jobCount: candidate.jobCount }),
        topic_key: candidate.topicKey,
      });

      // ── Sitemap ──────────────────────────────────────────────────────
      const purge = () => purgeSitemapCache(BASE_URL);
      if (ctx?.waitUntil) ctx.waitUntil(purge()); else await purge();

      await logBlogEvent(env, 'article_published', {
        template: tpl.id, topicKey: candidate.topicKey, articleId: postId, slug: seo.slug,
        title: rendered.title, jobCount: candidate.jobCount, status: shouldPublish ? 'published' : 'draft',
      });

      return { success: true, articleId: postId, title: rendered.title, template: tpl.id };
    } catch (e) {
      await logBlogEvent(env, 'generation_failed', { template: tpl.id, topicKey: candidate.topicKey, reason: String(e.message || e).slice(0, 300) });
    }
  }

  await logBlogEvent(env, 'generation_failed', { reason: 'Every candidate topic was skipped or failed this run' });
  return { skipped: true, reason: 'exhausted_candidates' };
}
