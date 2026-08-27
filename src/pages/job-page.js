// src/pages/job-page.js

import { logoImgHtml, jobLocationHtml, remoteTagHtml, catForTitleServer, jobTypeBadgeHtml, jobTypeCardClass, normalizeJobType, jobCardSSR } from '../components/job-card.js';
import { baseLayout } from '../layout/base-layout.js';
import { slugify, escapeHtml, safeExternalUrl, cleanDescription, parseSalaryRange, categorySalaryStats, companySnapshot } from '../lib/entities.js';
import { adSlot } from '../components/ad-slot.js';
import { jobPostingSchema } from '../lib/schema.js';
import { iconBadgeCheck, iconSparkle, iconFlame, iconDollarSign, iconBookmark, iconTrendingUp, iconBuilding, iconBriefcase, iconClock, iconGlobe } from '../assets/icons.js';
import { getSettings } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';
import { getCardStyles } from '../lib/job-card-styles.js';
import { getAdSlotsConfig } from '../lib/ad-slots.js';
import { getFooterPages, getMenuPages } from '../lib/pages-cms.js';
import { getNavButtons } from '../lib/nav-buttons.js';
import { getLogoOverrides, attachCompanyLogos } from '../lib/company-logos.js';
import { hydrateHotPay, HOT_PAY_LABEL } from '../lib/hot-pay.js';
import { salaryTierBadgeHtml } from '../components/job-card.js';
import { getVerifiedCompanyNameSet, getPublicCompanyBySlug } from '../lib/companies.js';

// SECURITY: JSON.stringify() does NOT escape "<", so a malicious job title
// like `</script><script>...` embedded in scraped/submitted data could
// break out of the JSON-LD <script> block and inject a real executable
// script tag. Escaping "<" as a unicode sequence keeps the JSON value
// identical while making that break-out impossible.
function safeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

// Provider descriptions can be plain text, escaped HTML, or small rich-text
// fragments. Keep a dependency-free allow-list sanitizer here so real
// headings, paragraphs, lists, emphasis, and safe external links survive
// without trusting user/provider HTML wholesale.
function richDescriptionHtml(raw) {
  let html = String(raw || '').trim();
  if (!html) return '';
  html = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
  html = html.replace(/<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const safeLinks = [];
  html = html.replace(/<a\b[^>]*href\s*=\s*["']((?:https?:\/\/|mailto:)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const token = `___JOBFORION_SAFE_LINK_${safeLinks.length}___`;
    safeLinks.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanDescription(text))}</a>`);
    return token;
  });
  html = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '');
  html = html.replace(/<\/?(p|br|strong|b|em|i|ul|ol|li|h2|h3|h4)\b[^>]*>/gi, tag => tag.replace(/\s+[^>]*?(?=>)/, ''));
  html = html.replace(/<(?!\/?(?:p|br|strong|b|em|i|ul|ol|li|h2|h3|h4|a)\b)[^>]*>/gi, '');
  safeLinks.forEach((link, index) => { html = html.replace(`___JOBFORION_SAFE_LINK_${index}___`, link); });
  if (!/<(?:p|br|ul|ol|h2|h3|h4)\b/i.test(html)) {
    const text = cleanDescription(html);
    return text.split(/\n{2,}/).filter(Boolean).map(block => {
      const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
      if (lines.length && lines.every(line => /^[-•*]\s+/.test(line))) return `<ul>${lines.map(line => `<li>${escapeHtml(line.replace(/^[-•*]\s+/, ''))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
    }).join('');
  }
  return html;
}

// NOTE: the JobPosting schema itself (employmentType mapping, jobLocation/
// PostalAddress, TELECOMMUTE detection, baseSalary parsing) now lives in
// ONE place — lib/schema.js's jobPostingSchema() — instead of being
// duplicated here. See that file for the full reasoning; the short
// version is that a duplicate copy is exactly how a bug fix here
// previously failed to reach the other copy (and vice versa).

// ════════════════════════════════════════════════════════════════
// ORIGINAL-CONTENT BOXES — see the matching helpers in lib/entities.js
// (categorySalaryStats, companySnapshot) for why these exist: the raw
// scraped title/company/description is routinely identical across many
// competing job aggregators, which is a real duplicate/thin-content SEO
// risk. These two boxes are computed live from THIS site's own current
// listings, so their text is factually unique to JobForion — it cannot
// be reproduced verbatim by a competitor scraping the same source feed.
// ════════════════════════════════════════════════════════════════

function salaryInsightHtml(job, stats, categoryLabel, siteName) {
  if (!stats) return '';
  const jobRange = job.salary ? parseSalaryRange(job.salary) : null;
  let comparisonText = '';
  if (jobRange) {
    const jobMid = (jobRange.min + jobRange.max) / 2;
    const avgMid = (stats.avgMin + stats.avgMax) / 2;
    if (avgMid > 0) {
      const diffPct = Math.round(((jobMid - avgMid) / avgMid) * 100);
      comparisonText = Math.abs(diffPct) < 5
        ? 'in line with'
        : diffPct > 0 ? `about ${diffPct}% above` : `about ${Math.abs(diffPct)}% below`;
    }
  }
  const body = (jobRange && comparisonText)
    ? `This role's listed salary is <strong>${comparisonText}</strong> the average for ${escapeHtml(categoryLabel)} positions on ${escapeHtml(siteName)} ($${stats.avgMin}k–$${stats.avgMax}k, based on ${stats.count} current listing${stats.count === 1 ? '' : 's'} with salary data).`
    : `The average salary range for ${escapeHtml(categoryLabel)} positions on ${escapeHtml(siteName)} is <strong>$${stats.avgMin}k–$${stats.avgMax}k</strong>, based on ${stats.count} current listing${stats.count === 1 ? '' : 's'} with salary data.`;
  return `<div class="insight-card">
    <div class="insight-card-title">${iconTrendingUp({ size: 15 })} Salary Insight</div>
    <div class="insight-card-body">${body}</div>
  </div>`;
}

function companySnapshotHtml(job, snapshot, siteName) {
  if (!snapshot || snapshot.openPositions < 1) return '';
  const since = snapshot.firstSeen
    ? new Date(snapshot.firstSeen).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;
  return `<div class="insight-card">
    <div class="insight-card-title">${iconBuilding({ size: 15 })} About ${escapeHtml(job.company)} on ${escapeHtml(siteName)}</div>
    <div class="insight-card-body">${escapeHtml(job.company)} currently has <strong>${snapshot.openPositions} open position${snapshot.openPositions === 1 ? '' : 's'}</strong> listed on ${escapeHtml(siteName)}${since ? `, hiring here since ${since}` : ''}. <a href="/companies/${slugify(job.company)}">View all openings</a></div>
  </div>`;
}

export async function renderJobPage(job, related, base, env, user = null) {
  const hydrated = await attachCompanyLogos(env, [job, ...(related || [])]);
  job = hydrated[0] || job;
  related = hydrated.slice(1);
  let skills = [];
  try { skills = JSON.parse(job.skills || '[]'); } catch (e) {}
  const isNew = job.created_at && Date.now() - new Date(job.created_at).getTime() < 86400000;
  const canonical = `${base}/job/${job.id}`;
  const cleanDesc = cleanDescription(job.description);

  const [categories, settings, cardStyles, verifiedCompanySet] = await Promise.all([getCategories(env), getSettings(env), getCardStyles(env), getVerifiedCompanyNameSet(env)]);
  const hotJobs = await hydrateHotPay(env, [job, ...(related || [])], settings);
  job = hotJobs[0] || job;
  related = hotJobs.slice(1);
  const adConfig = await getAdSlotsConfig(env);
  const footerPages = await getFooterPages(env);
  const menuPages = await getMenuPages(env);
  const navButtons = await getNavButtons(env);
  // Custom logo overrides (see /admin/companies to lib/company-logos.js) —
  // one small batch query for this job's own company plus every related
  // job's company, so every logo on the page (not just the header) can
  // use an admin-set override where one exists.
  const logoOverrides = await getLogoOverrides(env, [job.company, ...related.map(r => r.company)]);
  const jobLogoOverride = logoOverrides[(job.company || '').toLowerCase()] || null;
  const adsEnabled = settings.ads_enabled !== '0';
  const categoryOrder = categories.map(c => c.key);
  const categoryMap = Object.fromEntries(categories.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }]));
  const categoryKey = catForTitleServer(job.title, categoryOrder);
  const categoryLabel = (categoryMap[categoryKey] || { label: 'General' }).label;
  const [salaryStats, companyInfo, publicCompany] = await Promise.all([
    categorySalaryStats(env, categoryKey),
    companySnapshot(env, job.company),
    getPublicCompanyBySlug(env, slugify(job.company)),
  ]);
  const desc = cleanDesc.length > 20
    ? cleanDesc.slice(0, 160).replace(/\n/g, ' ') + '...'
    : `${job.title} at ${job.company}. ${job.location || 'Remote'}${job.salary ? ' — ' + job.salary : ''}. Apply on ${settings.site_name}.`;
  const insightsHtml = salaryInsightHtml(job, salaryStats, categoryLabel, settings.site_name) + companySnapshotHtml(job, companyInfo, settings.site_name);
  const descriptionHtml = richDescriptionHtml(job.description);
  const requirementsHtml = skills.length ? `<div id="requirements" class="job-section-anchor"><div class="sec-label">Skills &amp; requirements</div><div class="skills-wrap">${skills.map(s => `<a href="/skills/${slugify(s)}" class="skill-tag" style="text-decoration:none">${escapeHtml(s)}</a>`).join('')}</div></div>` : '';
  const benefitsHtml = job.benefits ? `<div id="benefits" class="job-section-anchor job-benefits-summary"><div class="sec-label">Benefits</div><div class="desc-wrap">${richDescriptionHtml(job.benefits)}</div></div>` : '';
  const companyLogoUrl = job.company_logo_url || publicCompany?.logo_url || jobLogoOverride || null;
  const companyWebsite = publicCompany?.website || job.company_website || '';
  const companyHref = publicCompany ? `/companies/${slugify(job.company)}` : '';
  const companyNameHtml = companyHref ? `<a href="${companyHref}" style="color:inherit">${escapeHtml(job.company)}</a>` : escapeHtml(job.company);
  const companyDescriptionHtml = publicCompany?.description ? `<p>${escapeHtml(publicCompany.description)}</p>` : '';
  const applyUrl = safeExternalUrl(job.url);
  const applyHtml = applyUrl ? `<a href="${escapeHtml(applyUrl)}" target="_blank" rel="noopener noreferrer" class="apply-big" onclick="recordApplyClick(${job.id})">Apply Now </a>` : '';
  const postedLabel = job.created_at ? (isNew ? 'Posted recently' : `Posted ${new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`) : '';
  const titleCase = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const employmentLabel = job.employment_type ? titleCase(job.employment_type) : '';
  const remoteLabel = job.remote_type ? titleCase(job.remote_type) : '';
  const experienceLabel = job.seniority || '';
  const jobFacts = [
    job.salary && [iconDollarSign({ size: 17 }), job.salary, 'Salary'],
    remoteLabel && [iconGlobe({ size: 17 }), remoteLabel, 'Remote status'],
    employmentLabel && [iconBriefcase({ size: 17 }), employmentLabel, 'Job type'],
    experienceLabel && [iconTrendingUp({ size: 17 }), experienceLabel, 'Experience'],
    postedLabel && [iconClock({ size: 17 }), postedLabel, 'Posted'],
  ].filter(Boolean);
  const jobFactsHtml = jobFacts.length ? `<div class="job-facts">${jobFacts.map(([icon, value, label]) => `<div class="job-fact"><span>${icon}</span><strong>${escapeHtml(String(value))}</strong><small>${label}</small></div>`).join('')}</div>` : '';
  const asideFactsHtml = jobFacts.length ? `<div class="detail-aside-card"><div class="aside-card-title">At a glance</div><div class="aside-facts">${jobFacts.map(([icon, value, label]) => `<div class="aside-fact"><span>${icon}</span><div><strong>${escapeHtml(String(value))}</strong><small>${label}</small></div></div>`).join('')}</div></div>` : '';
  const asideCompanyHtml = publicCompany ? `<div class="detail-aside-card"><div class="aside-company-head">${logoImgHtml(job.company, '40px', 'aside-company-logo', companyLogoUrl, companyWebsite)}<div><strong>${escapeHtml(publicCompany.name || job.company)}</strong>${publicCompany.verified ? `<span class="verified-ico" title="Verified Company">${iconBadgeCheck({ size: 13 })}</span>` : ''}</div></div>${publicCompany.description ? `<p class="aside-company-desc">${escapeHtml(publicCompany.description)}</p>` : ''}<a href="${companyHref}" class="text-link">View company profile </a></div>` : '';
  const companyPreviewHtml = publicCompany ? `<div id="company" class="job-section-anchor job-company-summary"><div class="company-preview"><div class="company-preview-logo">${logoImgHtml(job.company, '48px', 'co-logo', companyLogoUrl, companyWebsite)}</div><div><div class="sec-label">About ${escapeHtml(job.company)}</div>${companyDescriptionHtml}${publicCompany.country || publicCompany.city ? `<p>${escapeHtml([publicCompany.city, publicCompany.country].filter(Boolean).join(', '))}</p>` : ''}${companyInfo?.openPositions ? `<p>${companyInfo.openPositions} open position${companyInfo.openPositions === 1 ? '' : 's'} on JobForion.</p>` : ''}<a href="${companyHref}" class="text-link">View company profile </a></div></div></div>` : '';
  const companyTabHtml = publicCompany ? '<a href="#company">About company</a>' : '';
  const asideHtml = `<aside class="job-detail-aside" aria-label="Job summary">${applyHtml ? `<div class="detail-aside-card detail-apply-card">${applyHtml}</div>` : ''}${asideFactsHtml}${asideCompanyHtml}</aside>`;

  const schema = safeJsonLd(jobPostingSchema(job, base, { description: cleanDesc || desc }));
  const breadcrumbSchema = safeJsonLd({
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": settings.site_name, "item": base },
      { "@type": "ListItem", "position": 2, "name": "Jobs", "item": base + "/jobs" },
      { "@type": "ListItem", "position": 3, "name": job.title, "item": canonical }
    ]
  });
  const content = `
<div class="page">
  <div class="job-mobile-topbar"><a href="/jobs" aria-label="Back to jobs">Back</a><strong>Job Details</strong><span aria-hidden="true"></span></div>
  <div class="breadcrumb"><a href="/">${escapeHtml(settings.site_name)}</a><span>›</span><a href="/jobs">Jobs</a><span>›</span><span>${escapeHtml(job.title)}</span></div>
  <div class="job-detail-layout"><main class="job-detail-main"><div class="job-hero${jobTypeCardClass(job.job_type)}">
    <div class="job-hero-hdr">
      <div class="job-co-row">
        ${logoImgHtml(job.company, '64px', 'job-logo', companyLogoUrl, companyWebsite)}
        <div style="flex:1"><div class="job-co-name">${companyNameHtml} ${verifiedCompanySet.has((job.company || '').toLowerCase()) ? `<span class="verified-ico" title="Verified Company">${iconBadgeCheck({ size: 14 })}</span>` : ''}${normalizeJobType(job.job_type) === 'Sponsored' ? '<span class="jt-sponsored-tag">Sponsored Company</span>' : ''}</div>${jobLocationHtml(job, { compact: true, className: 'job-co-loc' })}${normalizeJobType(job.job_type) === 'Sponsored' && job.job_type_note ? `<div class="jt-note" style="margin-top:4px">${escapeHtml(job.job_type_note)}</div>` : ''}</div>
      </div>
      <h1 class="job-title-h1">${escapeHtml(job.title)}</h1>
      <div class="job-detail-status"><span class="status-dot"></span><strong>Active</strong>${postedLabel ? `<span>${escapeHtml(postedLabel)}</span>` : ''}${job.applicant_count ? `<span>·</span><span>${escapeHtml(String(job.applicant_count))} applicants</span>` : ''}</div>
      <div class="job-chips">
        ${jobTypeBadgeHtml(job.job_type, cardStyles)}
        ${remoteTagHtml(job.remote_type)}
        <a href="/categories/${categoryKey}" class="tag tag-type" style="text-decoration:none">${categoryLabel}</a>
        ${job.employment_type ? `<span class="tag tag-type">${escapeHtml(job.employment_type.replace(/_/g, ' '))}</span>` : ''}
        ${job.seniority ? `<span class="tag tag-type">${escapeHtml(job.seniority)}</span>` : ''}
        ${isNew ? `<span class="tag tag-new">${iconSparkle({ size: 11 })} NEW</span>` : ''}
        ${job.isHotPay ? `<span class="tag tag-hot">${iconFlame({ size: 11 })} ${HOT_PAY_LABEL}</span>` : ''}
        ${salaryTierBadgeHtml(job, settings)}
      </div>
      ${job.salary ? `<div class="job-salary-lg">${iconDollarSign({ size: 20 })} ${escapeHtml(job.salary)}</div>` : ''}
      <div class="job-primary-actions"><button class="job-save-outline" onclick="toggleJobSave(${job.id});return false">${iconBookmark({ size: 16 })} Save</button></div>
    </div>
    ${jobFactsHtml}
    <nav class="job-detail-tabs" aria-label="Job detail sections"><a class="active" href="#overview">Overview</a>${companyTabHtml}${skills.length ? '<a href="#requirements">Requirements</a>' : ''}${job.benefits ? '<a href="#benefits">Benefits</a>' : ''}</nav>
    <div class="job-body">
      <div id="overview" class="job-section-anchor"><div class="sec-label">Job overview</div><div class="desc-wrap job-description-content">${descriptionHtml || '<p>Full description is available on the employer application page.</p>'}</div></div>
      ${companyPreviewHtml}
      ${requirementsHtml}
      ${benefitsHtml}
      ${adSlot('job-detail-inline', '', adConfig, adsEnabled)}
    </div>
  </div>
  ${insightsHtml ? `<div class="insights-wrap">${insightsHtml}</div>` : ''}
  </main>${asideHtml}</div>
  ${applyUrl ? `<div class="apply-mobile-sticky-wrap"><a class="apply-mobile-sticky" href="${escapeHtml(applyUrl)}" target="_blank" rel="noopener noreferrer" onclick="recordApplyClick(${job.id})">Apply Now </a></div>` : ''}
  ${related.length ? `
    <div class="related-title" style="margin-top:24px">Similar Jobs</div>
    <div class="jobs-list">
      ${related.map((r, i) => jobCardSSR(r, i, categoryMap, categoryOrder, cardStyles, logoOverrides, settings.feature_featured_jobs !== '0', verifiedCompanySet, settings)).join('')}
    </div>` : ''}
  ${adSlot('job-detail-footer', 'margin-top:24px', adConfig, adsEnabled)}
</div>
<style>
.job-detail-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:18px;align-items:start}.job-detail-main{min-width:0}.job-detail-aside{position:sticky;top:76px;display:grid;gap:12px;min-width:0}.detail-aside-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;box-shadow:var(--shadow-card)}.detail-apply-card{display:grid;gap:9px}.detail-apply-card .apply-big{width:100%;justify-content:center}.aside-card-title{font:800 12px var(--font-heading,sans-serif);color:var(--ink);margin-bottom:10px}.aside-facts{display:grid;gap:10px}.aside-fact{display:flex;align-items:flex-start;gap:8px}.aside-fact>span{color:var(--brand);display:inline-flex;flex-shrink:0}.aside-fact strong{display:block;color:var(--ink);font-size:11px;line-height:1.3}.aside-fact small{display:block;color:var(--ink3);font-size:9px;margin-top:2px}.aside-company-head{display:flex;align-items:center;gap:9px}.aside-company-head>div:last-child{display:flex;align-items:center;gap:5px;min-width:0}.aside-company-head strong{color:var(--ink);font-size:12px;overflow:hidden;text-overflow:ellipsis}.aside-company-desc{color:var(--ink2);font-size:11px;line-height:1.55;margin:10px 0}.aside-company-logo{border-radius:10px;background:#fff;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.insights-wrap{display:flex;flex-direction:column;gap:10px;margin-top:16px}
.insight-card{background:var(--pastel-blue);border:1px solid rgba(53,86,255,.15);border-radius:12px;padding:14px 16px}
.insight-card-title{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;color:var(--brand);margin-bottom:6px}
.insight-card-body{font-size:13px;color:var(--ink2);line-height:1.6}
.insight-card-body strong{color:var(--ink)}
.insight-card-body a{color:var(--brand);font-weight:700}
.jt-sponsored-tag{display:inline-block;font-size:10px;font-weight:800;color:#0B7A50;background:rgba(15,174,121,.12);border:1px solid rgba(15,174,121,.3);padding:2px 8px;border-radius:20px;margin-left:6px;vertical-align:middle}
.job-hero.jt-card-premium .job-logo,.job-hero.jt-card-sponsored .job-logo{width:76px !important;height:76px !important}
.job-hero.jt-card-premium .job-title-h1,.job-hero.jt-card-sponsored .job-title-h1{font-weight:800}
.job-hero.jt-card-premium .apply-big,.job-hero.jt-card-sponsored .apply-big{padding:16px 40px;font-size:17px;box-shadow:0 8px 24px rgba(53,86,255,.28)}
.job-primary-actions{display:flex;align-items:center;gap:9px;margin-top:17px}.job-primary-actions .apply-big{flex:1;justify-content:center}.job-save-outline{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:0 20px;border:1px solid var(--brand);border-radius:8px;background:#fff;color:var(--brand);font:800 12px var(--font-body,sans-serif);cursor:pointer;transition:all .18s}.job-save-outline:hover,.job-save-outline.active{background:var(--brand-soft)}.job-detail-status{display:flex;align-items:center;gap:7px;color:#858094;font-size:10px;margin:-5px 0 11px}.job-detail-status strong{color:var(--green);font-size:10px}.status-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(45,173,105,.1)}.job-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));border-top:1px solid #f0eef4;border-bottom:1px solid #f0eef4;background:#fff}.job-fact{display:grid;justify-items:center;gap:3px;padding:15px 9px;border-right:1px solid #f0eef4;text-align:center;min-width:0}.job-fact:last-child{border-right:0}.job-description-content{font-size:14px;line-height:1.78;color:var(--ink2)}.job-description-content p{margin:0 0 14px}.job-description-content h2,.job-description-content h3,.job-description-content h4{font-family:var(--font-heading,sans-serif);color:var(--ink);margin:22px 0 9px;font-weight:800}.job-description-content h2{font-size:18px}.job-description-content h3{font-size:16px}.job-description-content ul,.job-description-content ol{margin:0 0 14px;padding-left:22px}.job-description-content li{margin:5px 0}.job-description-content a{color:var(--brand);font-weight:700;text-decoration:underline}.company-preview{display:flex;align-items:center;gap:13px;padding:14px;border:1px solid #eceaf2;background:#fff;border-radius:11px}.company-preview-logo{flex:0 0 auto}.company-preview .sec-label{margin-bottom:5px}.company-preview p{margin:0 0 8px;color:var(--ink2);font-size:13px}.apply-mobile-sticky-wrap{display:contents}.job-fact>span{color:var(--brand);display:inline-flex;margin-bottom:2px}.job-fact strong{font-size:11px;color:var(--ink);font-weight:800;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.job-fact small{color:#938fa0;font-size:9px}.job-detail-tabs{display:flex;gap:26px;overflow-x:auto;border-bottom:1px solid #efedf4;margin-top:17px;padding:0 7px;scrollbar-width:none}.job-detail-tabs::-webkit-scrollbar{display:none}.job-detail-tabs a{position:relative;flex-shrink:0;padding:0 0 11px;color:#767184;font-size:11px;font-weight:800}.job-detail-tabs a.active{color:var(--brand)}.job-detail-tabs a.active::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--brand);border-radius:3px}.job-section-anchor{scroll-margin-top:88px}.job-section-anchor+.job-section-anchor{border-top:1px solid #f0eef4;margin-top:24px;padding-top:22px}.job-company-summary p,.job-benefits-summary p{font-size:13px;color:var(--ink2);line-height:1.7;margin-bottom:10px}.text-link{display:inline-flex;align-items:center;gap:5px;color:var(--brand);font-size:12px;font-weight:800}.apply-mobile-sticky{display:none}.job-mobile-topbar{display:none}
@media(max-width:640px){.page{padding-top:12px}.job-mobile-topbar{display:flex;align-items:center;justify-content:space-between;height:38px;margin:0 0 12px;padding:0 2px}.job-mobile-topbar a{display:grid;place-items:center;width:30px;height:30px;border:0;background:transparent;color:var(--ink);font-size:11px;font-weight:800;cursor:pointer}.job-mobile-topbar strong{font:800 12px var(--font-heading,sans-serif)}.breadcrumb{display:none}.job-primary-actions{margin-top:14px}.job-primary-actions .apply-big{font-size:12px;padding:0 10px;min-height:42px}.job-save-outline{padding:0 14px;min-width:92px;font-size:11px}.job-facts{grid-template-columns:repeat(2,1fr)}.job-fact:nth-child(2n){border-right:0}.job-fact:nth-last-child(-n+2){border-bottom:0}.job-fact{border-bottom:1px solid #f0eef4}.job-detail-tabs{gap:22px;margin-left:-16px;margin-right:-16px;padding-left:16px;padding-right:16px}.job-detail-tabs a{font-size:10px}.job-body{padding-bottom:84px}.apply-mobile-sticky{position:fixed;display:flex;align-items:center;justify-content:center;gap:7px;left:14px;right:14px;bottom:76px;height:42px;background:var(--brand);border-radius:8px;color:#fff;font-size:12px;font-weight:800;box-shadow:0 10px 24px rgba(99,57,230,.25);z-index:340}.job-hero-hdr{padding:19px 16px}.job-co-row{gap:10px}.job-logo{width:52px;height:52px}.job-title-h1{font-size:21px}.job-hero{margin-left:-2px;margin-right:-2px}.job-detail-layout{display:block}.job-detail-aside{display:none}.job-primary-actions{padding-bottom:2px}.apply-mobile-sticky-wrap{display:contents} }
</style>
<script>
(function(){
  var jobId = ${job.id};
  var isAuthenticated = ${user ? 'true' : 'false'};
  function getSaved(){ try { return JSON.parse(localStorage.getItem('jn_saved')||'[]'); } catch(e){ return []; } }
  function setSaved(arr){ localStorage.setItem('jn_saved', JSON.stringify(arr)); }
  function refreshBtn(){
    var isSaved = getSaved().includes(jobId);
    document.querySelectorAll('.job-save-outline').forEach(function(el){el.classList.toggle('active',isSaved);el.innerHTML=${JSON.stringify(iconBookmark({ size: 16 }))}+' '+(isSaved?'Saved':'Save');});
  }
  window.toggleJobSave = function(id){
    if(!isAuthenticated){ window.location.href='/login?next='+encodeURIComponent(window.location.pathname+window.location.search); return; }
    var arr = getSaved();
    var idx = arr.indexOf(id);
    var nowSaved = idx < 0;
    if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
    setSaved(arr);
    refreshBtn();
    fetch('/api/user/saved-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: id, action: nowSaved ? 'save' : 'unsave' })
    }).then(function(res){if(!res.ok)throw new Error('save failed');}).catch(function(){ refreshBtn(); });
  };
  // Fire-and-forget: records an internal application event (see
  // /api/user/applications) without delaying the outbound navigation to
  // the employer's own apply page (no preventDefault, link still opens
  // in a new tab immediately). Silently no-ops for signed-out visitors.
  if(isAuthenticated){fetch('/api/user/saved-jobs').then(function(res){return res.ok?res.json():null;}).then(function(data){if(data&&Array.isArray(data.job_ids)){localStorage.setItem('jn_saved',JSON.stringify(data.job_ids));refreshBtn();}}).catch(function(){});}
  window.recordApplyClick = function(id){
    fetch('/api/user/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: id, status: 'applied', application_type: 'external' })
    }).catch(function(){});
  };
  refreshBtn();
})();
</script>`;
  return baseLayout(`${job.title} at ${job.company} — ${settings.site_name}`, desc, canonical, '', content, `<script type="application/ld+json">${schema}</script><script type="application/ld+json">${breadcrumbSchema}</script>`, 'index, follow', settings, { order: categoryOrder, map: categoryMap }, footerPages, menuPages, navButtons, user);
}
