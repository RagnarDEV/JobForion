// src/routes/pages.router.js
// Core content pages: single job, blog index/article, static legal pages,
// and the homepage SPA shell.

import { renderJobPage } from '../pages/job-page.js';
import { renderBlogIndex, renderArticlePage } from '../pages/blog.js';
import { renderResourcesHub, renderInformationalPage } from '../pages/public-content.js';
import { renderStaticPage } from '../pages/static-pages.js';
import { renderMainHTML } from '../pages/home.js';
import { getPostById, getPostBySlug, wasAutoPostSlug } from '../lib/blog-cms.js';
import { getPageBySlug, RESERVED_SLUGS } from '../lib/pages-cms.js';
import { baseLayout } from '../layout/base-layout.js';
import { BASE_URL, PUBLIC_JOB_STATUS_SQL } from '../config/constants.js';
import { getSettings } from '../lib/settings.js';
import { getCategoryData } from '../lib/categories.js';
import { getSessionUser } from '../lib/accounts/session.js';
import { renderPricingPage } from '../pages/pricing.js';

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
    const [{ results: tombstones }, { results: maxRows }] = await Promise.all([
      env.DB.prepare('SELECT 1 FROM job_tombstones WHERE job_id = ? LIMIT 1').bind(requestedId).all(),
      env.DB.prepare('SELECT MAX(id) AS maxId FROM jobs').all(),
    ]);
    // The tombstone is authoritative for deletions after Phase 15. The MAX
    // fallback keeps older databases and jobs removed before the migration
    // on the established 410 behavior.
    isGone = Boolean(tombstones?.length) || (maxRows?.[0]?.maxId || 0) >= parseInt(requestedId, 10);
  } catch (e) {}

  const status = isGone ? 410 : 404;
  const headline = isGone ? 'This job is no longer available' : 'Job not found';
  const body = isGone
    ? 'This listing has expired or been removed by the employer. It may have been filled, or the posting period ended.'
    : "We couldn't find a job at this address. It may have been mistyped, or the link may be out of date.";

  const settings = await getSettings(env);
  const categories = await getCategoryData(env);
  const content = `
<div class="page-sm" style="text-align:center;padding-top:60px">
  <div style="font-size:56px;margin-bottom:8px;opacity:.35">${isGone ? '⏳' : '🔍'}</div>
  <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:800;color:var(--ink);margin-bottom:10px">${headline}</h1>
  <p style="color:var(--ink2);font-size:14px;line-height:1.7;max-width:420px;margin:0 auto 28px">${body}</p>
  <a href="/" style="display:inline-flex;align-items:center;gap:8px;background:var(--brand);color:#fff;padding:12px 26px;border-radius:11px;font-size:14px;font-weight:700;text-decoration:none">Browse Open Roles</a>
</div>`;

  return new Response(
    baseLayout(`${headline} — ${settings.site_name}`, body, `${base}/job/${requestedId}`, '', content, '', 'noindex, nofollow', settings, categories),
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// Blog Automation (src/lib/blog-automation/expiration.js) hard-deletes
// auto-generated articles once they pass their lifetime — same
// mechanical situation as an expired job (renderJobGonePage above): the
// row is gone, but the URL was real and got indexed/shared. Rather than
// a generic 404, check the append-only generation log (wasAutoPostSlug)
// to tell "this slug WAS a real published article, now expired" (410
// Gone — permanent, stop recrawling) apart from "this slug never existed"
// (404 Not Found).
async function renderBlogGonePage(env, base, slug) {
  const wasReal = await wasAutoPostSlug(env, slug);
  const status = wasReal ? 410 : 404;
  const headline = wasReal ? 'This article has expired' : 'Article not found';
  const body = wasReal
    ? 'This was an automatically generated article built from live job-market data. Since that data ages, older auto-generated articles are periodically retired to keep listings accurate.'
    : "We couldn't find an article at this address. It may have been mistyped, or the link may be out of date.";

  const settings = await getSettings(env);
  const categories = await getCategoryData(env);
  const content = `
<div class="page-sm" style="text-align:center;padding-top:60px">
  <div style="font-size:56px;margin-bottom:8px;opacity:.35">${wasReal ? '⏳' : '🔍'}</div>
  <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:800;color:var(--ink);margin-bottom:10px">${headline}</h1>
  <p style="color:var(--ink2);font-size:14px;line-height:1.7;max-width:420px;margin:0 auto 28px">${body}</p>
  <a href="/blog" style="display:inline-flex;align-items:center;gap:8px;background:var(--brand);color:#fff;padding:12px 26px;border-radius:11px;font-size:14px;font-weight:700;text-decoration:none">Browse the Blog</a>
</div>`;

  return new Response(
    baseLayout(`${headline} — ${settings.site_name}`, body, `${base}/blog/${slug}`, '', content, '', 'noindex, nofollow', settings, categories),
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function handlePagesRoute(url, request, env, base) {
  const session = await getSessionUser(env, request);
  const user = session?.user || null;

  const jobMatch = url.pathname.match(/^\/job\/(\d+)$/);
  if (jobMatch) {
    const { results } = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobMatch[1]).all();
    // A row existing but status != 'active' (paused/closed by its owner,
    // or expired/archived by db/cleanup.js's lifecycle — see Job
    // Management, Stage 5) is publicly indistinguishable from a fully
    // deleted job: either way, this is not something the public should
    // be able to view or apply to right now. renderJobGonePage's
    // "no longer available" / 410 treatment is exactly the correct
    // message for both cases, so it's reused as-is rather than adding a
    // second near-identical page for "exists but not active".
    if (!results.length || results[0].status !== 'active') return renderJobGonePage(env, base, jobMatch[1]);
    const job = results[0];
    // NOTE: the old jobdatalake-specific description backfill (a second
    // fetch to api.jobdatalake.com by job_handle) was removed along with
    // that provider. Every current provider (Greenhouse, Lever, Ashby,
    // SmartRecruiters, Recruitee, Teamtailor) already returns the real
    // description in its single list request; Workable/Workday/iCIMS
    // degrade to a short/empty description by design rather than costing
    // a second request per job (see each provider's own comments).
    const relatedParts = ["id != ?", PUBLIC_JOB_STATUS_SQL];
    const relatedBinds = [jobMatch[1]];
    const relevanceParts = [];
    if (job.company) { relevanceParts.push('company = ?'); relatedBinds.push(job.company); }
    if (job.remote_type) { relevanceParts.push('remote_type = ?'); relatedBinds.push(job.remote_type); }
    if (job.employment_type) { relevanceParts.push('employment_type = ?'); relatedBinds.push(job.employment_type); }
    const titleWord = String(job.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4)[0];
    if (titleWord) { relevanceParts.push('LOWER(title) LIKE ?'); relatedBinds.push(`%${titleWord}%`); }
    const relatedWhere = relevanceParts.length ? `${relatedParts.join(' AND ')} AND (${relevanceParts.join(' OR ')})` : relatedParts.join(' AND ');
    const orderBy = relevanceParts.length ? `CASE ${job.company ? 'WHEN company = ? THEN 0 ' : ''}${job.remote_type ? 'WHEN remote_type = ? THEN 1 ' : ''}${job.employment_type ? 'WHEN employment_type = ? THEN 2 ' : ''}${titleWord ? 'WHEN LOWER(title) LIKE ? THEN 3 ' : ''}ELSE 4 END ASC, id DESC` : 'id DESC';
    const orderBinds = [];
    if (job.company) orderBinds.push(job.company);
    if (job.remote_type) orderBinds.push(job.remote_type);
    if (job.employment_type) orderBinds.push(job.employment_type);
    if (titleWord) orderBinds.push(`%${titleWord}%`);
    const { results: related } = await env.DB.prepare(`SELECT * FROM jobs WHERE ${relatedWhere} ORDER BY ${orderBy} LIMIT 4`).bind(...relatedBinds, ...orderBinds).all();
    return new Response(await renderJobPage(job, related, base, env, user), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (url.pathname === '/blog') return new Response(await renderBlogIndex(base, env, user), { headers: { "Content-Type": "text/html; charset=utf-8" } });

  if (url.pathname === '/resources') return new Response(await renderResourcesHub(base, env, user), { headers: { "Content-Type": "text/html; charset=utf-8" } });

  if (url.pathname === '/pricing') return new Response(await renderPricingPage(base, env, user), { headers: { "Content-Type": "text/html; charset=utf-8" } });

  const blogMatch = url.pathname.match(/^\/blog\/([a-z0-9-]+)$/);
  if (blogMatch) {
    // Old shared/indexed URLs are purely numeric ids (/blog/1 .. /blog/6);
    // new posts get slug URLs. Try numeric id first, then fall back to
    // slug, so neither old nor new links ever break.
    const idOrSlug = blogMatch[1];
    const post = /^\d+$/.test(idOrSlug)
      ? await getPostById(env, parseInt(idOrSlug, 10))
      : await getPostBySlug(env, idOrSlug);
    if (!post) return renderBlogGonePage(env, base, idOrSlug);
    return new Response(await renderArticlePage(post, base, env, user), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (url.pathname === '/') {
    const html = await renderMainHTML(env, base, user);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // Built-in public information views use the CMS page when an admin has
  // populated the slug, otherwise they render the capability-led fallback.
  const informationalMatch = url.pathname.match(/^\/(about|how-it-works|contact)$/);
  if (informationalMatch) {
    const html = await renderInformationalPage(informationalMatch[1], base, env, user);
    if (html) return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // ── CMS pages catch-all (Privacy/Terms/Disclaimer + any admin-created
  // page) — deliberately LAST in this router: RESERVED_SLUGS (see
  // lib/pages-cms.js) can never be used as a page slug, so this only
  // ever matches real CMS pages and safely falls through to null (→ the
  // next router, e.g. seo-pages.router.js's /categories) for anything
  // else. A single path segment only, so /job/123, /blog/x, /admin/x
  // etc. never even reach here.
  const pageMatch = url.pathname.match(/^\/([a-z][a-z0-9-]{1,49})$/);
  if (pageMatch && !RESERVED_SLUGS.has(pageMatch[1])) {
    const html = await renderStaticPage(pageMatch[1], base, env, user);
    if (html) return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return null;
}
