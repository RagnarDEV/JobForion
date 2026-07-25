// src/layout/base-layout.js
// The shared HTML shell used by every server-rendered page (job, blog, static,
// categories/companies/skills, admin login screen). Wires together nav, footer,
// the Post-a-Job modal, and the shared design tokens.

import { navHtml, mobileHeaderHtml } from '../components/nav.js';
import { footerHtml } from '../components/footer.js';
import { postJobModalHtml } from '../components/post-job-modal.js';
import { SHARED_CSS } from '../styles/shared-css.js';
import { ICON_HEAD } from '../assets/favicon.js';
import { BASE_URL } from '../config/constants.js';
import { escapeHtml } from '../lib/entities.js';

// SECURITY: title/description ultimately trace back to externally-sourced
// content on many pages (job titles/companies scraped from LinkedIn,
// JobDataLake, or visitor-submitted postings). Escaping once here, at the
// single shared template every page passes through, protects every caller
// — including any future page that forgets to sanitize before calling
// baseLayout() — instead of relying on each page to remember individually.
export function baseLayout(title, description, canonical, ogImage, content, extraHead = '', robots = 'index, follow') {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="google-site-verification" content="7Q0EJk3kQKNLNzIhyzH4k5CsuHsQEa-U0Pwp_w_b0n0"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<meta name="description" content="${safeDescription}">
<meta name="robots" content="${robots}">
${ICON_HEAD}
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDescription}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="JobForion">
${ogImage ? `<meta property="og:image" content="${ogImage}">` : `<meta property="og:image" content="${BASE_URL}/icon-512.png">`}
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="application/rss+xml" title="JobForion Jobs Feed" href="${BASE_URL}/feed.rss">
${extraHead}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${SHARED_CSS}
.page{max-width:860px;margin:0 auto;padding:36px 20px 72px}
.page-sm{max-width:680px;margin:0 auto;padding:36px 20px 72px}
.breadcrumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink3);margin-bottom:28px;flex-wrap:wrap}
.breadcrumb a{color:var(--brand)}.breadcrumb a:hover{color:var(--ink)}
.job-hero{background:var(--surface);border:1px solid var(--border);border-radius:18px;overflow:hidden;margin-bottom:20px;position:relative;box-shadow:var(--shadow)}
.job-hero::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--brand),var(--brand2),var(--cyan))}
.job-hero-hdr{padding:28px 24px}
.job-co-row{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.job-logo{width:64px;height:64px;border-radius:14px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:var(--brand);overflow:hidden;flex-shrink:0}
.job-logo img{width:100%;height:100%;object-fit:contain;padding:8px}
.job-co-name{font-size:16px;font-weight:700;color:var(--brand);margin-bottom:3px;display:flex;align-items:center;gap:5px}
.job-co-loc{font-size:12px;color:var(--ink3)}
.job-title-h1{font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;letter-spacing:-.5px;line-height:1.25;margin-bottom:14px;color:var(--ink)}
.job-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px}
.job-salary-lg{font-size:22px;font-weight:800;color:var(--salary)}
.job-body{padding:24px;border-top:1px solid var(--border)}
.sec-label{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--ink3);margin-bottom:12px}
.skills-wrap{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:24px}
.skill-tag{background:var(--brand-soft);border:1px solid rgba(53,86,255,.15);color:var(--brand);font-size:12px;padding:4px 12px;border-radius:8px;font-weight:600}
.desc-wrap{font-size:14px;color:var(--ink2);line-height:1.85;margin-bottom:24px;white-space:pre-line}
.apply-big{display:inline-flex;align-items:center;gap:10px;background:var(--ink);color:#fff;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;transition:all .25s}
.apply-big:hover{background:var(--brand);transform:translateY(-2px);box-shadow:0 8px 28px rgba(53,86,255,.35)}
.tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:4px 10px;border-radius:20px;font-weight:700;white-space:nowrap}
.tag-remote{background:rgba(15,174,121,.1);color:var(--green);border:1px solid rgba(15,174,121,.2)}
.tag-hybrid{background:rgba(245,166,35,.1);color:var(--amber);border:1px solid rgba(245,166,35,.2)}
.tag-onsite{background:var(--surface2);color:var(--ink2);border:1px solid var(--border2)}
.tag-type{background:var(--surface2);color:var(--ink2);border:1px solid var(--border2)}
.tag-new{background:rgba(15,174,121,.12);color:var(--green);border:1px solid rgba(15,174,121,.25);font-size:10px;padding:3px 9px;font-weight:800;letter-spacing:.8px;border-radius:20px}
.tag-hot{background:rgba(255,92,122,.12);color:var(--coral);border:1px solid rgba(255,92,122,.25);font-size:10px;padding:3px 9px;font-weight:800;border-radius:20px}
.verified-ico{color:var(--brand);font-size:13px}
.related-title{font-size:17px;font-weight:800;margin-bottom:14px;color:var(--ink);font-family:'Space Grotesk',sans-serif}
.related-grid{display:flex;flex-direction:column;gap:8px}
.related-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:14px;transition:all .2s;text-decoration:none}
.related-card:hover{border-color:var(--brand);transform:translateX(3px);box-shadow:var(--shadow)}
.related-logo{width:38px;height:38px;border-radius:8px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--brand);overflow:hidden;flex-shrink:0}
.related-logo img{width:100%;height:100%;object-fit:contain;padding:5px}
.related-info{flex:1;min-width:0}
.related-jt{font-size:13px;font-weight:700;color:var(--ink);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.related-co{font-size:12px;color:var(--brand)}
.related-sal{font-size:12px;font-weight:700;color:var(--salary);white-space:nowrap}
.article-cat{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--brand);margin-bottom:12px}
.article-title{font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;letter-spacing:-.5px;line-height:1.25;margin-bottom:14px;color:var(--ink)}
.article-meta{font-size:12px;color:var(--ink3);display:flex;gap:16px;margin-bottom:28px;flex-wrap:wrap}
.article-body{font-size:15px;color:var(--ink2);line-height:1.85}
.article-body h2{font-size:19px;font-weight:700;margin:28px 0 12px;color:var(--ink);padding-left:14px;border-left:3px solid var(--brand)}
.article-body p{margin-bottom:14px}
.article-body ul{padding-left:20px;margin-bottom:14px}
.article-body ul li{margin-bottom:8px}
.article-body strong{color:var(--ink)}
.static-title{font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;margin-bottom:8px;color:var(--ink)}
.static-date{font-size:12px;color:var(--ink3);margin-bottom:28px}
.static-body h2{font-size:17px;font-weight:700;margin:24px 0 10px;color:var(--ink)}
.static-body p{font-size:14px;color:var(--ink2);line-height:1.8;margin-bottom:10px}
.static-body ul{padding-left:18px;margin-bottom:10px}
.static-body ul li{font-size:14px;color:var(--ink2);line-height:1.8;margin-bottom:6px}
.static-body a{color:var(--brand)}
.back-link{display:inline-flex;align-items:center;gap:7px;color:var(--ink3);font-size:13px;font-weight:600;transition:color .2s;margin-bottom:24px;text-decoration:none}
.back-link:hover{color:var(--brand)}
@media(max-width:640px){
  .job-title-h1{font-size:20px}
  .article-title{font-size:22px}
  .job-hero-hdr,.job-body{padding:18px 16px}
  .apply-big{width:100%;justify-content:center}
}
</style>
</head>
<body>
${navHtml()}
${mobileHeaderHtml()}
${content}
${footerHtml(BASE_URL)}
${postJobModalHtml()}
</body>
</html>`;
}
