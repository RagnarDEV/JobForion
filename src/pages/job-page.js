// src/pages/job-page.js

import { logoImgHtml, remoteTagHtml, catForTitleServer, jobTypeBadgeHtml, jobTypeCardClass, normalizeJobType } from '../components/job-card.js';
import { CATEGORY_META } from '../config/constants.js';
import { baseLayout } from '../layout/base-layout.js';
import { slugify, escapeHtml, cleanDescription, parseSalaryRange, categorySalaryStats, companySnapshot } from '../lib/entities.js';
import { adSlot } from '../components/ad-slot.js';
import { isKnownCountry, US_STATE_CODES } from '../lib/country-flags.js';
import { iconBadgeCheck, iconMapPin, iconSparkle, iconFlame, iconDollarSign, iconArrowRight, iconBookmark, iconLink, iconTrendingUp, iconBuilding } from '../assets/icons.js';

// SECURITY: JSON.stringify() does NOT escape "<", so a malicious job title
// like `</script><script>...` embedded in scraped/submitted data could
// break out of the JSON-LD <script> block and inject a real executable
// script tag. Escaping "<" as a unicode sequence keeps the JSON value
// identical while making that break-out impossible.
function safeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

// Google's JobPosting schema requires an exact enum value (underscore,
// not space — a previous bug did .replace('_',' '), silently breaking
// this for every job) and doesn't recognize "CONTRACT" — the closest
// valid value is "CONTRACTOR". See:
// https://developers.google.com/search/docs/appearance/structured-data/job-posting
const EMPLOYMENT_TYPE_SCHEMA_MAP = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  contract: 'CONTRACTOR',
  internship: 'INTERN',
  temporary: 'TEMPORARY',
  volunteer: 'VOLUNTEER',
};

// Builds a schema.org PostalAddress for jobLocation — but ONLY when the
// country can be confidently determined from the free-text `location`
// column (a recognized country name, or a US state code). Google
// explicitly requires addressCountry when jobLocation is present;
// publishing a wrong guess is worse than omitting the field, since the
// location data here has no normalized country column to begin with
// (see splitLocation() in lib/entities.js). Remote jobs don't need this
// at all — they use jobLocationType instead (see renderJobPage below).
function buildJobLocationSchema(location) {
  if (!location) return null;
  const parts = location.split(',').map(s => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;

  if (isKnownCountry(last)) {
    const address = { "@type": "PostalAddress", "addressCountry": last };
    if (parts.length > 1) address.addressLocality = parts[0];
    return { "@type": "Place", "address": address };
  }
  if (US_STATE_CODES.has(last.toUpperCase())) {
    const address = { "@type": "PostalAddress", "addressCountry": "US", "addressRegion": last.toUpperCase() };
    if (parts.length > 1) address.addressLocality = parts[0];
    return { "@type": "Place", "address": address };
  }
  return null; // not confident enough to publish — omit rather than guess
}

// ════════════════════════════════════════════════════════════════
// ORIGINAL-CONTENT BOXES — see the matching helpers in lib/entities.js
// (categorySalaryStats, companySnapshot) for why these exist: the raw
// scraped title/company/description is routinely identical across many
// competing job aggregators, which is a real duplicate/thin-content SEO
// risk. These two boxes are computed live from THIS site's own current
// listings, so their text is factually unique to JobForion — it cannot
// be reproduced verbatim by a competitor scraping the same source feed.
// ════════════════════════════════════════════════════════════════

function salaryInsightHtml(job, stats, categoryLabel) {
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
    ? `This role's listed salary is <strong>${comparisonText}</strong> the average for ${escapeHtml(categoryLabel)} positions on JobForion ($${stats.avgMin}k–$${stats.avgMax}k, based on ${stats.count} current listing${stats.count === 1 ? '' : 's'} with salary data).`
    : `The average salary range for ${escapeHtml(categoryLabel)} positions on JobForion is <strong>$${stats.avgMin}k–$${stats.avgMax}k</strong>, based on ${stats.count} current listing${stats.count === 1 ? '' : 's'} with salary data.`;
  return `<div class="insight-card">
    <div class="insight-card-title">${iconTrendingUp({ size: 15 })} Salary Insight</div>
    <div class="insight-card-body">${body}</div>
  </div>`;
}

function companySnapshotHtml(job, snapshot) {
  if (!snapshot || snapshot.openPositions < 1) return '';
  const since = snapshot.firstSeen
    ? new Date(snapshot.firstSeen).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;
  return `<div class="insight-card">
    <div class="insight-card-title">${iconBuilding({ size: 15 })} About ${escapeHtml(job.company)} on JobForion</div>
    <div class="insight-card-body">${escapeHtml(job.company)} currently has <strong>${snapshot.openPositions} open remote position${snapshot.openPositions === 1 ? '' : 's'}</strong> listed on JobForion${since ? `, hiring here since ${since}` : ''}. <a href="/companies/${slugify(job.company)}">View all openings →</a></div>
  </div>`;
}

export async function renderJobPage(job, related, base, env) {
  let skills = [];
  try { skills = JSON.parse(job.skills || '[]'); } catch (e) {}
  const isNew = job.created_at && Date.now() - new Date(job.created_at).getTime() < 86400000;
  const isHot = job.salary && parseInt(job.salary.replace(/\D/g, '').slice(0, 3)) >= 150;
  const canonical = `${base}/job/${job.id}`;
  const cleanDesc = cleanDescription(job.description);
  const desc = cleanDesc.length > 20
    ? cleanDesc.slice(0, 160).replace(/\n/g, ' ') + '...'
    : `${job.title} at ${job.company}. ${job.location || 'Remote'}${job.salary ? ' — ' + job.salary : ''}. Apply on JobForion.`;

  const categoryKey = catForTitleServer(job.title);
  const categoryLabel = CATEGORY_META[categoryKey].label;
  const [salaryStats, companyInfo] = await Promise.all([
    categorySalaryStats(env, categoryKey),
    companySnapshot(env, job.company),
  ]);
  const insightsHtml = salaryInsightHtml(job, salaryStats, categoryLabel) + companySnapshotHtml(job, companyInfo);

  const isRemote = job.remote_type === 'fully_remote';
  const jobLocationSchema = isRemote ? null : buildJobLocationSchema(job.location);
  const employmentTypeSchema = job.employment_type ? EMPLOYMENT_TYPE_SCHEMA_MAP[job.employment_type] : undefined;

  const schema = safeJsonLd({
    "@context": "https://schema.org", "@type": "JobPosting",
    "title": job.title, "description": cleanDesc || desc,
    "identifier": { "@type": "PropertyValue", "name": job.company, "value": String(job.job_handle || job.id) },
    "hiringOrganization": { "@type": "Organization", "name": job.company },
    "datePosted": job.created_at ? new Date(job.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    "validThrough": new Date(Date.now() + 1000 * 60 * 60 * 24 * 45).toISOString().split('T')[0],
    "url": canonical,
    // Required for Google's "Work from home jobs" experience — this is a
    // remote job board, so most listings qualify. applicantLocationRequirements
    // is intentionally omitted (we don't have reliable data for it); per
    // Google's docs, without it a remote job is simply shown broadly
    // rather than being excluded.
    ...(isRemote ? { "jobLocationType": "TELECOMMUTE" } : {}),
    // jobLocation is technically required UNLESS the job is remote with
    // applicantLocationRequirements present — for non-remote jobs we only
    // publish it when the country is confidently known (see
    // buildJobLocationSchema above); otherwise this specific listing
    // simply won't be Google-Jobs-eligible until the location data
    // improves, which is preferable to publishing a guessed country.
    ...(jobLocationSchema ? { "jobLocation": jobLocationSchema } : {}),
    ...(employmentTypeSchema ? { "employmentType": employmentTypeSchema } : {}),
    ...(job.salary ? { "baseSalary": { "@type": "MonetaryAmount", "currency": "USD", "value": { "@type": "QuantitativeValue", "value": job.salary } } } : {})
  });
  const breadcrumbSchema = safeJsonLd({
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "JobForion", "item": base },
      { "@type": "ListItem", "position": 2, "name": "Jobs", "item": base + "/" },
      { "@type": "ListItem", "position": 3, "name": job.title, "item": canonical }
    ]
  });
  const content = `
<div class="page">
  <div class="breadcrumb"><a href="/">JobForion</a><span>›</span><a href="/">Jobs</a><span>›</span><span>${escapeHtml(job.title)}</span></div>
  <div class="job-hero${jobTypeCardClass(job.job_type)}">
    <div class="job-hero-hdr">
      <div class="job-co-row">
        ${logoImgHtml(job.company, '64px', 'job-logo')}
        <div style="flex:1"><div class="job-co-name"><a href="/companies/${slugify(job.company)}" style="color:inherit">${escapeHtml(job.company)}</a> <span class="verified-ico" title="Verified listing">${iconBadgeCheck({ size: 14 })}</span>${normalizeJobType(job.job_type) === 'Sponsored' ? '<span class="jt-sponsored-tag">Sponsored Company</span>' : ''}</div><div class="job-co-loc">${iconMapPin({ size: 12 })} ${escapeHtml(job.location || 'Remote')}</div>${normalizeJobType(job.job_type) === 'Sponsored' && job.job_type_note ? `<div class="jt-note" style="margin-top:4px">${escapeHtml(job.job_type_note)}</div>` : ''}</div>
        <div class="job-actions">
          <button class="job-act-btn" id="jobSaveBtn" onclick="toggleJobSave(${job.id})" title="Save job">${iconBookmark({ size: 16 })}<span class="job-act-label">Save</span></button>
          <button class="job-act-btn" id="jobCopyBtn" onclick="copyJobLink()" title="Copy link">${iconLink({ size: 16 })}<span class="job-act-label">Copy Link</span></button>
        </div>
      </div>
      <h1 class="job-title-h1">${escapeHtml(job.title)}</h1>
      <div class="job-chips">
        ${jobTypeBadgeHtml(job.job_type)}
        ${remoteTagHtml(job.remote_type)}
        <a href="/categories/${categoryKey}" class="tag tag-type" style="text-decoration:none">${categoryLabel}</a>
        ${job.employment_type ? `<span class="tag tag-type">${escapeHtml(job.employment_type.replace(/_/g, ' '))}</span>` : ''}
        ${job.seniority ? `<span class="tag tag-type">${escapeHtml(job.seniority)}</span>` : ''}
        ${isNew ? `<span class="tag tag-new">${iconSparkle({ size: 11 })} NEW</span>` : ''}
        ${isHot ? `<span class="tag tag-hot">${iconFlame({ size: 11 })} HOT</span>` : ''}
      </div>
      ${job.salary ? `<div class="job-salary-lg">${iconDollarSign({ size: 20 })} ${escapeHtml(job.salary)}</div>` : ''}
    </div>
    <div class="job-body">
      ${skills.length ? `<div class="sec-label">Required Skills</div><div class="skills-wrap">${skills.map(s => `<a href="/skills/${slugify(s)}" class="skill-tag" style="text-decoration:none">${escapeHtml(s)}</a>`).join('')}</div>` : ''}
      <div class="sec-label">About the Role</div>
      <div class="desc-wrap">${cleanDesc.length > 20 ? escapeHtml(cleanDesc) : 'Full description available on the company website.'}</div>
      ${adSlot('job-detail-inline')}
      <a href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer" class="apply-big">Apply Now ${iconArrowRight({ size: 16 })}</a>
    </div>
  </div>
  ${insightsHtml ? `<div class="insights-wrap">${insightsHtml}</div>` : ''}
  ${related.length ? `
    <div class="related-title" style="margin-top:24px">Similar Jobs</div>
    <div class="related-grid">
      ${related.map(r => `
        <a href="/job/${r.id}" class="related-card">
          ${logoImgHtml(r.company, '38px', 'related-logo')}
          <div class="related-info"><div class="related-jt">${escapeHtml(r.title)}</div><div class="related-co"><a href="/companies/${slugify(r.company)}" style="color:inherit">${escapeHtml(r.company)}</a></div></div>
          ${r.salary ? `<div class="related-sal">${escapeHtml(r.salary)}</div>` : ''}
          <span style="color:var(--ink3)">›</span>
        </a>`).join('')}
    </div>` : ''}
  ${adSlot('job-detail-footer', 'margin-top:24px')}
</div>
<style>
.job-actions{display:flex;gap:8px;flex-shrink:0}
.job-act-btn{display:flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border2);color:var(--ink2);padding:8px 12px;border-radius:9px;font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .2s}
.job-act-btn:hover{border-color:var(--brand);color:var(--brand);background:var(--brand-soft)}
.job-act-btn.active{background:var(--brand-soft);border-color:var(--brand);color:var(--brand)}
@media(max-width:480px){.job-act-label{display:none}.job-act-btn{padding:8px}}
.insights-wrap{display:flex;flex-direction:column;gap:10px;margin-top:16px}
.insight-card{background:var(--pastel-blue);border:1px solid rgba(53,86,255,.15);border-radius:12px;padding:14px 16px}
.insight-card-title{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;color:var(--brand);margin-bottom:6px}
.insight-card-body{font-size:13px;color:var(--ink2);line-height:1.6}
.insight-card-body strong{color:var(--ink)}
.insight-card-body a{color:var(--brand);font-weight:700}
.jt-sponsored-tag{display:inline-block;font-size:10px;font-weight:800;color:#0B7A50;background:rgba(15,174,121,.12);border:1px solid rgba(15,174,121,.3);padding:2px 8px;border-radius:20px;margin-left:6px;vertical-align:middle}
.job-hero.jt-card-premium .job-logo,.job-hero.jt-card-sponsored .job-logo{width:76px !important;height:76px !important}
.job-hero.jt-card-premium .job-title-h1,.job-hero.jt-card-sponsored .job-title-h1{font-weight:800}
.job-hero.jt-card-premium .apply-big,.job-hero.jt-card-sponsored .apply-big{padding:16px 40px;font-size:17px;box-shadow:0 8px 24px rgba(53,86,255,.28)}
</style>
<script>
(function(){
  var jobId = ${job.id};
  function getSaved(){ try { return JSON.parse(localStorage.getItem('jn_saved')||'[]'); } catch(e){ return []; } }
  function setSaved(arr){ localStorage.setItem('jn_saved', JSON.stringify(arr)); }
  function refreshBtn(){
    var btn = document.getElementById('jobSaveBtn');
    var isSaved = getSaved().includes(jobId);
    btn.classList.toggle('active', isSaved);
    btn.querySelector('.job-act-label').textContent = isSaved ? 'Saved' : 'Save';
  }
  window.toggleJobSave = function(id){
    var arr = getSaved();
    var idx = arr.indexOf(id);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
    setSaved(arr);
    refreshBtn();
  };
  window.copyJobLink = function(){
    var btn = document.getElementById('jobCopyBtn');
    var label = btn.querySelector('.job-act-label');
    var original = label.textContent;
    navigator.clipboard.writeText(window.location.href).then(function(){
      label.textContent = 'Copied!';
      btn.classList.add('active');
      setTimeout(function(){ label.textContent = original; btn.classList.remove('active'); }, 1800);
    });
  };
  refreshBtn();
})();
</script>`;
  return baseLayout(`${job.title} at ${job.company} — JobForion`, desc, canonical, '', content, `<script type="application/ld+json">${schema}</script><script type="application/ld+json">${breadcrumbSchema}</script>`);
}
