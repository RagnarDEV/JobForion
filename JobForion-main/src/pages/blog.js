// src/pages/blog.js

import { baseLayout } from '../layout/base-layout.js';
import { BLOG_POSTS } from '../data/blog-posts.js';
import { adSlot } from '../components/ad-slot.js';

export function renderBlogIndex(base) {
  const content = `
<div class="page">
  <div class="breadcrumb"><a href="/">JobForion</a><span>›</span><span>Blog</span></div>
  <h1 style="font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;margin-bottom:8px;color:var(--ink)">📝 Career Blog</h1>
  <p style="color:var(--ink2);font-size:14px;margin-bottom:24px">Insights and career advice for remote job seekers.</p>
  ${adSlot('blog-index-top')}
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:20px">
    ${BLOG_POSTS.map(p => `
      <a href="/blog/${p.id}" style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;display:block;transition:all .25s;text-decoration:none;box-shadow:var(--shadow)" onmouseover="this.style.borderColor='var(--brand)';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--border)';this.style.transform='none'">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--brand);margin-bottom:10px">${p.cat}</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:8px;line-height:1.4;color:var(--ink)">${p.title}</div>
        <div style="font-size:13px;color:var(--ink3);line-height:1.65;margin-bottom:14px">${p.excerpt}</div>
        <div style="font-size:11px;color:var(--ink3);display:flex;gap:12px"><span>📅 ${p.date}</span><span>⏱ ${p.readTime}</span></div>
      </a>`).join('')}
  </div>
</div>`;
  return baseLayout('Career Blog — JobForion', 'Career insights for remote job seekers.', `${base}/blog`, '', content,
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Blog", "name": "JobForion Career Blog", "url": `${base}/blog` })}</script>`);
}

export function renderArticlePage(post, base) {
  const canonical = `${base}/blog/${post.id}`;
  const schema = JSON.stringify({ "@context": "https://schema.org", "@type": "Article", "headline": post.title, "description": post.excerpt, "datePublished": post.date, "author": { "@type": "Organization", "name": "JobForion" }, "url": canonical });
  const content = `
<div class="page-sm">
  <a href="/blog" class="back-link">← Back to Blog</a>
  <div class="article-cat">${post.cat}</div>
  <h1 class="article-title">${post.title}</h1>
  <div class="article-meta"><span>📅 ${post.date}</span><span>⏱ ${post.readTime}</span><span>✍️ JobForion Team</span></div>
  <div class="article-body">${post.body}</div>
  ${adSlot('blog-article-footer', 'margin-top:28px')}
  <div style="margin-top:28px;display:flex;gap:10px;flex-wrap:wrap">
    <a href="/blog" class="back-link" style="margin-bottom:0">← Back to Blog</a>
    <a href="/" style="display:inline-flex;align-items:center;gap:7px;background:var(--ink);color:#fff;padding:9px 18px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none">Browse Remote Jobs →</a>
  </div>
</div>`;
  return baseLayout(`${post.title} — JobForion Blog`, post.excerpt, canonical, '', content, `<script type="application/ld+json">${schema}</script>`);
}
