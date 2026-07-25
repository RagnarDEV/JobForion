// src/pages/job-page.js

import { logoImgHtml, remoteTagHtml, catForTitleServer } from '../components/job-card.js';
import { CATEGORY_META } from '../config/constants.js';
import { baseLayout } from '../layout/base-layout.js';
import { slugify, escapeHtml, cleanDescription } from '../lib/entities.js';
import { adSlot } from '../components/ad-slot.js';
import { iconBadgeCheck, iconMapPin, iconSparkle, iconFlame, iconDollarSign, iconArrowRight, iconBookmark, iconLink } from '../assets/icons.js';

// SECURITY: JSON.stringify() does NOT escape "<", so a malicious job title
// like `</script><script>...` embedded in scraped/submitted data could
// break out of the JSON-LD <script> block and inject a real executable
// script tag. Escaping "<" as a unicode sequence keeps the JSON value
// identical while making that break-out impossible.
function safeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

export function renderJobPage(job, related, base) {
  let skills = [];
  try { skills = JSON.parse(job.skills || '[]'); } catch (e) {}
  const isNew = job.created_at && Date.now() - new Date(job.created_at).getTime() < 86400000;
  const isHot = job.salary && parseInt(job.salary.replace(/\D/g, '').slice(0, 3)) >= 150;
  const canonical = `${base}/job/${job.id}`;
  const cleanDesc = cleanDescription(job.description);
  const desc = cleanDesc.length > 20
    ? cleanDesc.slice(0, 160).replace(/\n/g, ' ') + '...'
    : `${job.title} at ${job.company}. ${job.location || 'Remote'}${job.salary ? ' — ' + job.salary : ''}. Apply on JobForion.`;
  const schema = safeJsonLd({
    "@context": "https://schema.org", "@type": "JobPosting",
    "title": job.title, "description": cleanDesc || desc,
    "hiringOrganization": { "@type": "Organization", "name": job.company },
    "jobLocation": { "@type": "Place", "address": job.location || "Remote" },
    "employmentType": job.employment_type ? job.employment_type.toUpperCase().replace('_', ' ') : "FULL_TIME",
    "datePosted": job.created_at ? new Date(job.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    "validThrough": new Date(Date.now() + 1000 * 60 * 60 * 24 * 45).toISOString().split('T')[0],
    "url": canonical, "directApply": true,
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
  <div class="job-hero">
    <div class="job-hero-hdr">
      <div class="job-co-row">
        ${logoImgHtml(job.company, '64px', 'job-logo')}
        <div style="flex:1"><div class="job-co-name"><a href="/companies/${slugify(job.company)}" style="color:inherit">${escapeHtml(job.company)}</a> <span class="verified-ico" title="Verified listing">${iconBadgeCheck({ size: 14 })}</span></div><div class="job-co-loc">${iconMapPin({ size: 12 })} ${escapeHtml(job.location || 'Remote')}</div></div>
        <div class="job-actions">
          <button class="job-act-btn" id="jobSaveBtn" onclick="toggleJobSave(${job.id})" title="Save job">${iconBookmark({ size: 16 })}<span class="job-act-label">Save</span></button>
          <button class="job-act-btn" id="jobCopyBtn" onclick="copyJobLink()" title="Copy link">${iconLink({ size: 16 })}<span class="job-act-label">Copy Link</span></button>
        </div>
      </div>
      <h1 class="job-title-h1">${escapeHtml(job.title)}</h1>
      <div class="job-chips">
        ${remoteTagHtml(job.remote_type)}
        <a href="/categories/${catForTitleServer(job.title)}" class="tag tag-type" style="text-decoration:none">${CATEGORY_META[catForTitleServer(job.title)].label}</a>
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
