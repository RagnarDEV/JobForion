// Public blog renderers. Content comes exclusively from the existing Blog CMS;
// post.body remains trusted rich-editor HTML, while metadata is escaped.

import { baseLayout } from '../layout/base-layout.js';
import { getPosts } from '../lib/blog-cms.js';
import { adSlot } from '../components/ad-slot.js';
import { escapeHtml } from '../lib/entities.js';
import { getSettings, SETTINGS_DEFAULTS } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';
import { getAdSlotsConfig, DEFAULT_AD_CONFIG } from '../lib/ad-slots.js';
import { getFooterPages, getMenuPages } from '../lib/pages-cms.js';
import { getNavButtons } from '../lib/nav-buttons.js';
import { buildBreadcrumb } from '../lib/breadcrumbs.js';
import { PUBLIC_PAGE_CSS, publicPageHeader } from '../components/public-page.js';
import { iconFileText, iconArrowRight } from '../assets/icons.js';

async function loadPublicContext(env) {
  if (!env) return { categories: null, footerPages: null, menuPages: null, navButtons: null };
  const [categories, footerPages, menuPages, navButtons] = await Promise.all([
    getCategories(env), getFooterPages(env), getMenuPages(env), getNavButtons(env),
  ]);
  return {
    categories: { order: categories.map(c => c.key), map: Object.fromEntries(categories.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }])) },
    footerPages, menuPages, navButtons,
  };
}

function safeImageUrl(value) {
  const url = String(value || '').trim();
  return /^(https?:\/\/|\/(?!\/))[^\s"'<>]+$/i.test(url) ? escapeHtml(url) : '';
}

function postHref(post) {
  return `/blog/${encodeURIComponent(String(post.slug || post.id || ''))}`;
}

function dateText(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function blogCard(post) {
  const image = safeImageUrl(post.cover_image_url);
  return `<a class="public-card blog-card" href="${escapeHtml(postHref(post))}">${image ? `<img class="blog-card-cover" src="${image}" alt="${escapeHtml(post.title)}" loading="lazy">` : '<div class="blog-card-cover" aria-hidden="true"></div>'}<span class="blog-card-body"><span class="public-eyebrow">${escapeHtml(post.category || 'General')}</span><h2>${escapeHtml(post.title)}</h2>${post.excerpt ? `<p>${escapeHtml(post.excerpt)}</p>` : ''}<span class="public-card-meta"><small>${escapeHtml(dateText(post.published_at))}${post.read_time ? ` · ${escapeHtml(post.read_time)}` : ''}</small><b class="public-card-arrow" aria-hidden="true">→</b></span></span></a>`;
}

export async function renderBlogIndex(base, env, user = null) {
  const settings = env ? await getSettings(env) : SETTINGS_DEFAULTS;
  const { categories, footerPages, menuPages, navButtons } = await loadPublicContext(env);
  const posts = env ? await getPosts(env) : [];
  const adConfig = env ? await getAdSlotsConfig(env) : DEFAULT_AD_CONFIG;
  const adsEnabled = settings.ads_enabled !== '0';
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Blog', path: '/blog' }]);
  const cards = posts.map(blogCard).join('');
  const content = `<div class="page public-page blog-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'JOBFORION JOURNAL', title: 'Career guidance for the next move', description: 'Practical insights and remote-work advice from the JobForion editorial feed.' })}${adSlot('blog-index-top', 'blog-ad', adConfig, adsEnabled)}<section class="public-section blog-hero" aria-labelledby="blog-articles"><div class="public-section-heading"><div><h2 id="blog-articles">Latest articles</h2><p>Published posts from the existing Blog CMS.</p></div></div><div class="public-card-grid">${cards || '<div class="empty blog-empty"><div class="e-icon">📭</div><h3>No articles yet</h3><p>Published articles will appear here when they are available.</p></div>'}</div></section><div class="public-callout"><div><h2>Ready to search?</h2><p>Move from advice to action with the live JobForion job directory.</p></div><a class="public-primary-link" href="/jobs">Browse jobs →</a></div></div>`;
  const schema = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Blog', name: `${settings.site_name} Career Blog`, url: `${base}/blog` })}</script>`;
  return baseLayout(`Career Blog — ${settings.site_name}`, 'Career insights and remote-work advice for job seekers.', `${base}/blog`, '', content, schema + bcSchema, 'index, follow', settings, categories, footerPages, menuPages, navButtons, user);
}

export async function renderArticlePage(post, base, env, user = null) {
  const settings = env ? await getSettings(env) : SETTINGS_DEFAULTS;
  const { categories, footerPages, menuPages, navButtons } = await loadPublicContext(env);
  const posts = env ? await getPosts(env) : [];
  const adConfig = env ? await getAdSlotsConfig(env) : DEFAULT_AD_CONFIG;
  const adsEnabled = settings.ads_enabled !== '0';
  const canonical = `${base}/blog/${encodeURIComponent(String(post.slug || post.id || ''))}`;
  const publishedDate = post.published_at ? new Date(post.published_at).toISOString().split('T')[0] : '';
  const currentIndex = posts.findIndex(item => String(item.id) === String(post.id) || (item.slug && item.slug === post.slug));
  const related = posts.filter(item => String(item.id) !== String(post.id) && item.slug !== post.slug)
    .sort((a, b) => (a.category === post.category ? -1 : 0) - (b.category === post.category ? -1 : 0)).slice(0, 3);
  const newerPost = currentIndex > 0 ? posts[currentIndex - 1] : null;
  const olderPost = currentIndex >= 0 ? posts[currentIndex + 1] : null;
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Blog', path: '/blog' }, { name: post.title, path: `/blog/${post.slug || post.id}` }]);
  const schema = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: post.title, description: post.excerpt || '', datePublished: publishedDate, author: { '@type': 'Organization', name: settings.site_name }, url: canonical, ...(safeImageUrl(post.cover_image_url) ? { image: safeImageUrl(post.cover_image_url) } : {}) });
  const image = safeImageUrl(post.cover_image_url);
  const tags = Array.isArray(post.tags) ? post.tags : [];
  const content = `<div class="page public-page article-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: post.category || 'CAREER ARTICLE', title: post.title, description: post.excerpt || '' })}<div class="article-meta"><span>${escapeHtml(dateText(post.published_at))}</span>${post.read_time ? `<span>${escapeHtml(post.read_time)}</span>` : ''}<span>By ${escapeHtml(settings.site_name)} Team</span></div>${image ? `<img class="article-cover" src="${image}" alt="${escapeHtml(post.title)}">` : ''}<article class="article-body">${post.body || '<p>This article does not have published body content yet.</p>'}</article>${tags.length ? `<div class="article-tags" aria-label="Article tags">${tags.map(tag => `<span class="article-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}${adSlot('blog-article-footer', 'blog-ad', adConfig, adsEnabled)}${related.length ? `<section class="public-section" aria-labelledby="related-articles"><div class="public-section-heading"><div><h2 id="related-articles">Related articles</h2><p>Other published posts from the Blog CMS.</p></div></div><div class="public-card-grid">${related.map(blogCard).join('')}</div></section>` : ''}${newerPost || olderPost ? `<nav class="article-nav" aria-label="Article navigation">${newerPost ? `<a href="${escapeHtml(postHref(newerPost))}"><small>Newer article</small><strong>${escapeHtml(newerPost.title)}</strong></a>` : '<span></span>'}${olderPost ? `<a href="${escapeHtml(postHref(olderPost))}"><small>Older article</small><strong>${escapeHtml(olderPost.title)}</strong></a>` : '<span></span>'}</nav>` : ''}<div class="public-callout"><div><h2>Keep exploring JobForion</h2><p>Search current roles or read more from the editorial feed.</p></div><div class="public-page-header-actions"><a class="public-primary-link" href="/jobs">Browse jobs ${iconArrowRight({ size: 14 })}</a><a class="public-primary-link" href="/blog">All articles ${iconFileText({ size: 14 })}</a></div></div></div>`;
  return baseLayout(`${post.title} — ${settings.site_name} Blog`, post.excerpt || 'JobForion career article.', canonical, '', content, `<script type="application/ld+json">${schema}</script>${bcSchema}`, 'index, follow', settings, categories, footerPages, menuPages, navButtons, user);
}
