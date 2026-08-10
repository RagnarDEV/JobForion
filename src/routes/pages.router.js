// src/routes/pages.router.js
// Core content pages: single job, blog index/article, static legal pages,
// and the homepage SPA shell.

import { renderJobPage } from '../pages/job-page.js';
import { renderBlogIndex, renderArticlePage } from '../pages/blog.js';
import { renderStaticPage } from '../pages/static-pages.js';
import { renderMainHTML } from '../pages/home.js';
import { BLOG_POSTS } from '../data/blog-posts.js';
import { baseLayout } from '../layout/base-layout.js';

// A deleted/expired job's row is hard-removed from D1 (see
// db/cleanup.js), so at request time there's no way to tell "this id
// used to exist and was cleaned up" from "this id was never valid" by
// looking at the row alone. We approximate it from the id's position
// relative to the current highest id: sequential AUTOINCREMENT means an
// id at or below the current max almost certainly existed at some point
// (410 Gone — permanent, don't recrawl), while an id above the current
// max was never issued (404 Not Found — plain unknown URL). Either way
// the visitor gets the same professional page; only the status code and
// headline differ, and both are marked noindex so neither lingers in
// Google's index.
async function renderJobGonePage(env, base, requestedId) {
  let isGone = false;
  try {
    const { results } = await env.DB.prepare('SELECT MAX(id) AS maxId FROM jobs').all();
    isGone = (results?.[0]?.maxId || 0) >= parseInt(requestedId, 10);
  } catch (e) {}

  const status = isGone ? 410 : 404;
  const headline = isGone ? 'This job is no longer available' : 'Job not found';
  const body = isGone
    ? 'This listing has expired or been removed by the employer. It may have been filled, or the posting period ended.'
    : "We couldn't find a job at this address. It may have been mistyped, or the link may be out of date.";

  const content = `
<div class="page-sm" style="text-align:center;padding-top:60px">
  <div style="font-size:56px;margin-bottom:8px;opacity:.35">${isGone ? '⏳' : '🔍'}</div>
  <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:800;color:var(--ink);margin-bottom:10px">${headline}</h1>
  <p style="color:var(--ink2);font-size:14px;line-height:1.7;max-width:420px;margin:0 auto 28px">${body}</p>
  <a href="/" style="display:inline-flex;align-items:center;gap:8px;background:var(--brand);color:#fff;padding:12px 26px;border-radius:11px;font-size:14px;font-weight:700;text-decoration:none">Browse Open Roles</a>
</div>`;

  return new Response(
    baseLayout(`${headline} — JobForion`, body, `${base}/job/${requestedId}`, '', content, '', 'noindex, nofollow'),
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function handlePagesRoute(url, request, env, base) {
  const jobMatch = url.pathname.match(/^\/job\/(\d+)$/);
  if (jobMatch) {
    const { results } = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobMatch[1]).all();
    if (!results.length) return renderJobGonePage(env, base, jobMatch[1]);
    const job = results[0];
    // NOTE: the old "fetch full description from api.jobdatalake.com"
    // fallback was removed along with the jobdatalake provider — every
    // active provider now returns whatever description it has directly at
    // sync time (see src/providers/*.js), so there is no longer a
    // per-provider single-job endpoint to fall back to. A short/missing
    // description just falls through to job-page.js's own placeholder.
    const { results: related } = await env.DB.prepare("SELECT id,title,company,salary,remote_type FROM jobs WHERE id != ? ORDER BY RANDOM() LIMIT 4").bind(jobMatch[1]).all();
    return new Response(renderJobPage(job, related, base), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (url.pathname === '/blog') return new Response(renderBlogIndex(base), { headers: { "Content-Type": "text/html; charset=utf-8" } });

  const blogMatch = url.pathname.match(/^\/blog\/(\d+)$/);
  if (blogMatch) {
    const post = BLOG_POSTS.find(p => p.id === parseInt(blogMatch[1]));
    if (!post) return new Response('Not found', { status: 404 });
    return new Response(renderArticlePage(post, base), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (url.pathname === '/privacy') return new Response(renderStaticPage('privacy', base), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  if (url.pathname === '/terms') return new Response(renderStaticPage('terms', base), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  if (url.pathname === '/disclaimer') return new Response(renderStaticPage('disclaimer', base), { headers: { "Content-Type": "text/html; charset=utf-8" } });

  if (url.pathname === '/') {
    const html = await renderMainHTML(env, base);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return null;
}
