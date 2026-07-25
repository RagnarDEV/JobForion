// src/components/post-job-modal.js
// The "Post a Job" modal + its client-side submit handler (site-wide, works on every page).

import { CATEGORY_ORDER, CATEGORY_META } from '../config/constants.js';

export function postJobModalHtml() {
  return `
<div class="pj-overlay" id="pjOverlay" onclick="if(event.target===this)closePostJobModal()">
  <div class="pj-modal">
    <button class="pj-close" onclick="closePostJobModal()">✕</button>
    <div id="pjFormWrap">
      <div class="pj-title">📮 Post a Remote Job</div>
      <div class="pj-sub">Reach thousands of remote job seekers. We review every listing before it goes live.</div>
      <form id="pjForm" onsubmit="return submitPostJob(event)">
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">Job Title</label><input class="pj-input" name="title" required placeholder="Senior Backend Engineer"></div>
          <div class="pj-group"><label class="pj-label">Company</label><input class="pj-input" name="company" required placeholder="Acme Inc."></div>
        </div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">Contact Email</label><input class="pj-input" type="email" name="email" required placeholder="hiring@acme.com"></div>
          <div class="pj-group"><label class="pj-label">Apply URL</label><input class="pj-input" type="url" name="url" required placeholder="https://acme.com/careers/123"></div>
        </div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">Location</label><input class="pj-input" name="location" placeholder="Remote / Anywhere"></div>
          <div class="pj-group"><label class="pj-label">Salary Range</label><input class="pj-input" name="salary" placeholder="$90k - $130k"></div>
        </div>
        <div class="pj-row">
          <div class="pj-group"><label class="pj-label">Category</label>
            <select class="pj-select" name="category">
              ${CATEGORY_ORDER.map(k => `<option value="${k}">${CATEGORY_META[k].label}</option>`).join('')}
            </select>
          </div>
          <div class="pj-group"><label class="pj-label">Remote Type</label>
            <select class="pj-select" name="remote_type">
              <option value="fully_remote">Fully Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="on_site">On-site</option>
            </select>
          </div>
        </div>
        <div class="pj-group"><label class="pj-label">Description</label><textarea class="pj-textarea" name="description" placeholder="Role responsibilities, requirements, benefits..."></textarea></div>
        <button class="pj-submit" type="submit" id="pjSubmitBtn">Submit for Review →</button>
      </form>
    </div>
  </div>
</div>
<script>
function openPostJobModal(){document.getElementById('pjOverlay').classList.add('open');document.body.style.overflow='hidden';}
function closePostJobModal(){document.getElementById('pjOverlay').classList.remove('open');document.body.style.overflow='';}
async function submitPostJob(e){
  e.preventDefault();
  const form=e.target;
  const btn=document.getElementById('pjSubmitBtn');
  btn.disabled=true;btn.textContent='Submitting...';
  const data=Object.fromEntries(new FormData(form).entries());
  try{
    const res=await fetch('/api/post-job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const d=await res.json();
    if(d.success){
      document.getElementById('pjFormWrap').innerHTML='<div class="pj-success"><div class="ico">🎉</div><div class="pj-title">Thanks — received!</div><div class="pj-sub">Our team will review your listing and publish it within 24 hours.</div><button class="pj-submit" onclick="closePostJobModal()">Done</button></div>';
    }else{
      btn.disabled=false;btn.textContent='Submit for Review →';
      alert(d.error||'Something went wrong. Please try again.');
    }
  }catch(err){
    btn.disabled=false;btn.textContent='Submit for Review →';
    alert('Network error. Please try again.');
  }
  return false;
}
</script>`;
}
