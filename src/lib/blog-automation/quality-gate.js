// src/lib/blog-automation/quality-gate.js
// ════════════════════════════════════════════════════════════════
// QUALITY GATE — the last checkpoint before a generated article is saved.
// If a topic technically had "enough jobs" (see data-analyzer.js) but the
// rendered result is still too short, malformed, or missing structure,
// this rejects it and generator.js moves on to the next candidate topic
// instead of publishing something weak. Nothing here uses AI — it's
// plain structural/length validation.
// ════════════════════════════════════════════════════════════════

import { stripHtml, wordCount } from './util.js';

export function passesQualityGate(article, settings) {
  const reasons = [];
  const text = stripHtml(article?.body || '');
  const words = wordCount(text);
  const minWords = parseInt(settings.blog_auto_min_content_length || '600', 10);
  const maxWords = parseInt(settings.blog_auto_max_content_length || '2200', 10);

  if (!article?.title || article.title.trim().length < 10) reasons.push('title missing or too short');
  if (!article?.excerpt || article.excerpt.trim().length < 20) reasons.push('excerpt missing or too short');
  if (words < minWords) reasons.push(`content too short (${words} words, minimum ${minWords})`);
  if (words > maxWords) reasons.push(`content too long (${words} words, maximum ${maxWords})`);
  if (!article?.body || !article.body.includes('<h2>')) reasons.push('missing structured sections (no headings)');
  if (!article?.body || !/<(ul|ol)>/.test(article.body)) reasons.push('missing a data list (no real figures included)');

  return { pass: reasons.length === 0, reasons, wordCount: words };
}
