// src/components/post-job-modal.js
// The "Post a Job" modal + its client-side submit handler (site-wide, works on every page).
//
// Accessibility & anti-spam (UI/UX audit P0):
//  - real dialog semantics: role="dialog", aria-modal, labelled by its title
//  - every field has a programmatically associated <label for="…">
//  - Escape closes, Tab / Shift+Tab stay inside the dialog, focus returns to the opener
//  - errors render inline in a role="alert" region instead of window.alert()
//  - hidden honeypot field (company_website) — checked server-side in routes/api/forms.api.js
//  - category slugs are escaped before being written into the <option value>

import { CATEGORY_ORDER, CATEGORY_META } from '../config/constants.js';
import { escapeHtml } from '../lib/directory/entities.js';

import { iconMail, iconSparkle, iconX } from '../assets/icons.js';
// `categoryOrder`/`categoryMap` are optional — default to the static
// CATEGORY_ORDER/CATEGORY_META import (unchanged behavior) for any
// caller not yet passing dynamic categories (see lib/content/categories.js).
export function postJobModalHtml(categoryOrder = CATEGORY_ORDER, categoryMap = CATEGORY_META) {
  const categoryOptions = categoryOrder
    .filter(k => categoryMap[k])
    .map(k => `<option value="${escapeHtml(k)}">${escapeHtml(categoryMap[k].label)}</option>`)
    .join('');
  return `
<div class="pj-overlay" id="pjOverlay" onclick="if(event.target===this)closePostJobModal()">
  <div class="pj-modal" id="pjModal" role="dialog" aria-modal="true" aria-labelledby="pjTitle" aria-describedby="pjSub" tabindex="-1">
    <button type="button" class="pj-close" onclick="closePostJobModal()" aria-label="Close dialog">${iconX({ size: 16 })}</button>
    <div id="pjFormWrap">
      <h2 class="pj-title" id="pjTitle">${iconMail({ size: 15 })} Post a Remote Job</h2>
      <p class="pj-sub" id="pjSub">Reach thousands of remote job seekers. We review every listing before it goes live.</p>
      <p class="pj-legend"><span class="pj-req" aria-hidden="true">*</span> Required field</p>
      <form id="pjForm" onsubmit="return submitPostJob(event)">
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label" for="pj_f_title">Job Title <span class="pj-req" aria-hidden="true">*</span></label><input class="pj-input" id="pj_f_title" name="title" required maxlength="150" placeholder="Senior Backend Engineer"></div>
          <div class="pj-group"><label class="pj-label" for="pj_f_company">Company <span class="pj-req" aria-hidden="true">*</span></label><input class="pj-input" id="pj_f_company" name="company" required maxlength="100" autocomplete="organization" placeholder="Acme Inc."></div>
        </div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label" for="pj_f_email">Contact Email <span class="pj-req" aria-hidden="true">*</span></label><input class="pj-input" id="pj_f_email" type="email" name="email" required maxlength="254" autocomplete="email" placeholder="hiring@acme.com"></div>
          <div class="pj-group"><label class="pj-label" for="pj_f_url">Apply URL <span class="pj-req" aria-hidden="true">*</span></label><input class="pj-input" id="pj_f_url" type="url" name="url" required maxlength="400" placeholder="https://acme.com/careers/123"></div>
        </div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label" for="pj_f_location">Location</label><input class="pj-input" id="pj_f_location" name="location" maxlength="100" placeholder="Remote / Anywhere"></div>
          <div class="pj-group"><label class="pj-label" for="pj_f_salary">Salary Range</label><input class="pj-input" id="pj_f_salary" name="salary" maxlength="60" placeholder="$90k - $130k"></div>
        </div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label" for="pj_f_category">Category</label>
            <select class="pj-select" id="pj_f_category" name="category">
              ${categoryOptions}
            </select>
          </div>
          <div class="pj-group"><label class="pj-label" for="pj_f_remote">Remote Type</label>
            <select class="pj-select" id="pj_f_remote" name="remote_type">
              <option value="fully_remote">Fully Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="on_site">On-site</option>
            </select>
          </div>
        </div>
        <div class="pj-group"><label class="pj-label" for="pj_f_description">Description</label><textarea class="pj-textarea" id="pj_f_description" name="description" maxlength="4000" placeholder="Role responsibilities, requirements, benefits..."></textarea></div>
        <div class="pj-hp" aria-hidden="true"><label for="pj_f_hp">Leave this field empty</label><input id="pj_f_hp" name="company_website" type="text" tabindex="-1" autocomplete="off"></div>
        <div class="pj-error" id="pjError" role="alert" aria-live="assertive"></div>
        <button class="pj-submit" type="submit" id="pjSubmitBtn">Submit for Review</button>
      </form>
    </div>
  </div>
</div>
<script>
(function(){
  var overlay=document.getElementById('pjOverlay');
  var modal=document.getElementById('pjModal');
  var wrap=document.getElementById('pjFormWrap');
  if(!overlay||!modal||!wrap)return;
  var formHtml=wrap.innerHTML;
  var DONE_ICON=${JSON.stringify(iconSparkle({ size: 44 }))};
  var lastFocus=null;
  var done=false;

  function focusables(){
    return Array.prototype.slice.call(modal.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(function(el){
      return !el.disabled&&el.type!=='hidden'&&el.tabIndex>=0&&el.offsetParent!==null;
    });
  }

  window.openPostJobModal=function(){
    lastFocus=document.activeElement;
    overlay.classList.add('open');
    document.body.style.overflow='hidden';
    // Focus the dialog itself (not the first input) so phones do not pop the keyboard open immediately.
    modal.focus();
  };

  window.closePostJobModal=function(){
    overlay.classList.remove('open');
    document.body.style.overflow='';
    if(done){
      wrap.innerHTML=formHtml;
      modal.setAttribute('aria-labelledby','pjTitle');
      done=false;
    }
    if(lastFocus&&typeof lastFocus.focus==='function'){try{lastFocus.focus();}catch(e){}}
    lastFocus=null;
  };

  document.addEventListener('keydown',function(e){
    if(!overlay.classList.contains('open'))return;
    if(e.key==='Escape'){e.preventDefault();window.closePostJobModal();return;}
    if(e.key!=='Tab')return;
    var f=focusables();
    if(!f.length){e.preventDefault();modal.focus();return;}
    var first=f[0],last=f[f.length-1],active=document.activeElement;
    if(e.shiftKey&&(active===first||active===modal)){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&active===last){e.preventDefault();first.focus();}
  });

  function showDone(){
    done=true;
    wrap.innerHTML='<div class="pj-success" role="status"><div class="ico">'+DONE_ICON+'</div><h2 class="pj-title" id="pjDoneTitle" tabindex="-1">Thanks — received!</h2><p class="pj-sub">Our team will review your listing and publish it within 24 hours.</p><button type="button" class="pj-submit" onclick="closePostJobModal()">Done</button></div>';
    modal.setAttribute('aria-labelledby','pjDoneTitle');
    var t=document.getElementById('pjDoneTitle');
    if(t)t.focus();
  }

  window.submitPostJob=function(e){
    e.preventDefault();
    var form=e.target;
    var btn=document.getElementById('pjSubmitBtn');
    var err=document.getElementById('pjError');
    err.textContent='';
    btn.disabled=true;
    btn.setAttribute('aria-busy','true');
    btn.textContent='Submitting...';
    var data={};
    new FormData(form).forEach(function(v,k){data[k]=typeof v==='string'?v:'';});
    function fail(msg){
      btn.disabled=false;
      btn.removeAttribute('aria-busy');
      btn.textContent='Submit for Review';
      err.textContent=msg||'Something went wrong. Please try again.';
    }
    fetch('/api/post-job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
      .then(function(res){return res.json().catch(function(){return {};});})
      .then(function(d){if(d&&d.success){showDone();}else{fail(d&&d.error);}})
      .catch(function(){fail('Network error. Please try again.');});
    return false;
  };
})();
</script>`;
}
