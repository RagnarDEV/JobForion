// src/pages/blog.js

import { baseLayout } from '../layout/base-layout.js';
import { getPosts } from '../lib/blog-cms.js';
import { adSlot } from '../components/ad-slot.js';
import { escapeHtml } from '../lib/entities.js';
import { getSettings, SETTINGS_DEFAULTS } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';
import { getAdSlotsConfig, DEFAULT_AD_CONFIG } from '../lib/ad-slots.js';
import { getFooterPages } from '../lib/pages-cms.js';

// `env` optional — see loadCategoryData's own comment for the pattern.
async function loadFooterPages(env) {
  return env ? await getFooterPages(env) : null;
}

// Builds the `{order, map}` shape baseLayout() expects for the dynamic
// "Post a Job" category dropdown. `env` optional — see renderBlogIndex.
async function loadCategoryData(env) {
  if (!env) return null;
  const categories = await getCategories(env);
  return { order: categories.map(c => c.key), map: Object.fromEntries(categories.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }])) };
}

// `env` is optional (backward compatible with any caller that only has
// `base`) — when provided, settings/categories/posts are all fetched
// from D1. Posts now come from lib/blog-cms.js (see that file) instead
// of the old hardcoded BLOG_POSTS array — title/excerpt/category are
// admin-form-submitted text so they're escaped here (defense in depth;
// only `post.body` is intentionally raw HTML — see the security note
// in components/rich-editor.js for why that's still safe).
export async function renderBlogIndex(base, env) {
  const settings = env ? await getSettings(env) : SETTINGS_DEFAULTS;
  const categories = await loadCategoryData(env);
  const posts = env ? await getPosts(env) : [];
  const adConfig = env ? await getAdSlotsConfig(env) : DEFAULT_AD_CONFIG;
  const adsEnabled = settings.ads_enabled !== '0';
  const footerPages = await loadFooterPages(env);
  const siteName = escapeHtml(settings.site_name);
  const content = `
<div class="page">
  <div class="breadcrumb"><a href="/">${siteName}</a><span>›</span><span>Blog</span></div>
  <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:28px;font-weight:700;margin-bottom:8px;color:var(--ink)">📝 Career Blog</h1>
  <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">Insights and career advice for remote job seekers.</p>
  ${adSlot('blog-index-top', '', adConfig, adsEnabled)}
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:20px">
    ${posts.map(p => `
      <a href="/blog/${escapeHtml(p.slug || p.id)}" style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;display:block;transition:all .25s;text-decoration:none;box-shadow:var(--shadow)" onmouseover="this.style.borderColor='var(--brand)';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--border)';this.style.transform='none'">
        ${p.cover_image_url ? `<img src="${escapeHtml(p.cover_image_url)}" alt="" style="width:100%;height:130px;object-fit:cover;border-radius:9px;margin-bottom:12px" loading="lazy">` : ''}
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--brand);margin-bottom:10px">${escapeHtml(p.category || 'General')}</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:8px;line-height:1.4;color:var(--ink)">${escapeHtml(p.title)}</div>
        <div style="font-size:13px;color:var(--ink3);line-height:1.65;margin-bottom:14px">${escapeHtml(p.excerpt || '')}</div>
        <div style="font-size:11px;color:var(--ink3);display:flex;gap:12px"><span>📅 ${p.published_at ? new Date(p.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}</span><span>⏱ ${escapeHtml(p.read_time || '')}</span></div>
      </a>`).join('') || '<div class="empty"><div class="e-icon">📭</div><h3>No articles yet</h3></div>'}
  </div>
</div>`;
  return baseLayout(`Career Blog — ${settings.site_name}`, 'Career insights for remote job seekers.', `${base}/blog`, '', content,
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Blog", "name": `${settings.site_name} Career Blog`, "url": `${base}/blog` })}</script>`,
    'index, follow', settings, categories, footerPages);
}

export async function renderArticlePage(post, base, env) {
  const settings = env ? await getSettings(env) : SETTINGS_DEFAULTS;
  const categories = await loadCategoryData(env);
  const adConfig = env ? await getAdSlotsConfig(env) : DEFAULT_AD_CONFIG;
  const adsEnabled = settings.ads_enabled !== '0';
  const canonical = `${base}/blog/${post.slug || post.id}`;
  const publishedDate = post.published_at ? new Date(post.published_at).toISOString().split('T')[0] : '';
  const schema = JSON.stringify({ "@context": "https://schema.org", "@type": "Article", "headline": post.title, "description": post.excerpt, "datePublished": publishedDate, "author": { "@type": "Organization", "name": settings.site_name }, "url": canonical });
  const content = `
<div class="page-sm">
  <a href="/blog" class="back-link">← Back to Blog</a>
  <div class="article-cat">${escapeHtml(post.category || 'General')}</div>
  <h1 class="article-title">${escapeHtml(post.title)}</h1>
  <div class="article-meta"><span>📅 ${post.published_at ? new Date(post.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}</span><span>⏱ ${escapeHtml(post.read_time || '')}</span><span>✍️ ${escapeHtml(settings.site_name)} Team</span></div>
  ${post.cover_image_url ? `<img src="${escapeHtml(post.cover_image_url)}" alt="" style="width:100%;max-height:360px;object-fit:cover;border-radius:14px;margin-bottom:22px">` : ''}
  <div class="article-body">${post.body}</div>
  ${(post.tags || []).length ? `<div style="margin-top:20px;display:flex;flex-wrap:wrap;gap:6px">${post.tags.map(t => `<span class="skill-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
  ${adSlot('blog-article-footer', 'margin-top:28px', adConfig, adsEnabled)}
  <div style="margin-top:28px;display:flex;gap:10px;flex-wrap:wrap">
    <a href="/blog" class="back-link" style="margin-bottom:0">← Back to Blog</a>
    <a href="/" style="display:inline-flex;align-items:center;gap:7px;background:var(--ink);color:#fff;padding:9px 18px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none">Browse Remote Jobs →</a>
  </div>
</div>`;
  return baseLayout(`${post.title} — ${settings.site_name} Blog`, post.excerpt, canonical, '', content, `<script type="application/ld+json">${schema}</script>`, 'index, follow', settings, categories);
}
