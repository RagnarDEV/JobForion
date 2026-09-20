// src/pages/home/client-script.js
// The homepage's client-side behaviour (search, filters, pagination, saved
// jobs, reveal animations). Runs after the small inline bootstrap script in
// pages/home.js has defined window.__CATEGORY_META__, window.__ICONS__ etc.
// Only four server values are interpolated: the company-logo map, the first
// page of jobs, their total, and whether the visitor is signed in.

export function homeClientScript({ companyLogoMap, initialJobs, initialTotal, user }) {
  return `<script>
const CAT_META=window.__CATEGORY_META__;
const CAT_ORDER=window.__CATEGORY_ORDER__;
const ICONS=window.__ICONS__;
const COMPANY_LOGOS=${JSON.stringify(companyLogoMap).replace(/</g,'\\u003c')};
const JOB_TYPE_META=window.__JOB_TYPE_META__;
const JOB_TYPE_ICONS=window.__JOB_TYPE_ICONS__||{};
const JOB_CARD_STYLES=window.__JOB_CARD_STYLES__;
const FEATURES=window.__FEATURES__;
  const HOT_PAY_LABEL=window.__HOT_PAY_LABEL__||'HOT PAY';
 const SALARY_TIER_UI=window.__SALARY_TIER_UI__||{enabled:false,labels:{}};
 function salaryTierBadgeClient(tier){
   if(!SALARY_TIER_UI.enabled||!['HIGH','GOOD','STANDARD'].includes(tier))return'';
   const key=tier.toLowerCase();
   const label=SALARY_TIER_UI.labels[tier]||tier;
   return '<span class="salary-tier-badge salary-tier-'+key+'" aria-label="'+esc(label)+'">'+esc(label)+'</span>';
 }
 function normalizeJobType(t){return(t&&JOB_TYPE_META[t])?t:'Free';}
// Mirrors lib/jobs/job-card-styles.js's buildCardStyleAttr/buildBadgeStyleAttr
// exactly (same shadow presets, same gradient/solid logic) so cards
// re-rendered client-side after a filter/search look identical to the
// server-rendered ones — both read from the same JOB_CARD_STYLES data.
const JT_SHADOWS={none:'none',soft:'0 4px 18px rgba(18,22,43,.10)',strong:'0 8px 26px rgba(18,22,43,.18)'};
function jtStyleFor(t){return JOB_CARD_STYLES[normalizeJobType(t)];}
function jtCardStyleAttr(t,freeTint){
  const s=jtStyleFor(t);
  const bg=s.bg_type==='gradient'?\`linear-gradient(\${s.gradient_angle}deg, \${s.bg_color1}, \${s.bg_color2})\`:s.bg_color1;
  const border=s.border_style==='none'?'none':\`\${s.border_width}px \${s.border_style} \${s.border_color}\`;
  const shadow=JT_SHADOWS[s.shadow]||JT_SHADOWS.none;
  const finalBg=(normalizeJobType(t)==='Free'&&freeTint)?freeTint:bg;
  return \`background:\${finalBg};border:\${border};box-shadow:\${shadow};--card-title-color:\${s.title_color||'#17132D'};--card-company-color:\${s.company_color||'#6B7280'};--card-meta-color:\${s.meta_color||'#7C8192'};--card-salary-color:\${s.salary_color||'#2B9D68'};--card-accent-color:\${s.accent_color||'#E2E8F0'}\`;
}
function jobTypeBadge(t){
  const type=normalizeJobType(t);
  if(type==='Free')return'';
  const meta=JOB_TYPE_META[type];
  const s=jtStyleFor(type);
  const iconKey=s.icon_key||meta.iconKey||'none';
  return \`<span class="jt-badge" style="background:\${s.badge_bg_color};color:\${s.badge_text_color};border-color:\${s.badge_border_color||s.badge_bg_color};border-radius:\${s.badge_radius||20}px"><span class="jt-badge-icon-wrap">\${JOB_TYPE_ICONS[iconKey]||''}</span><span>\${esc(meta.label)}</span></span>\`;
}
function jobTypeCardClass(t){
  const type=normalizeJobType(t),s=jtStyleFor(type);
  const template=['classic','highlight','spotlight','promoted'].includes(s.template)?s.template:'classic';
  const accent=['none','top','left','both'].includes(s.accent_position)?s.accent_position:'none';
  const hover=['none','lift','glow'].includes(s.hover_effect)?s.hover_effect:'none';
  return \`\${type==='Free'?'':' jt-card-'+type.toLowerCase()} jct-template-\${template} jct-accent-\${accent} jct-hover-\${hover}\`;
}
let pg=1,cat='',srch='',advT,srchT;
let jobs=${JSON.stringify(initialJobs)},total=${initialTotal};
const IS_AUTHENTICATED=${user ? 'true' : 'false'};
let savedIds=IS_AUTHENTICATED?[]:JSON.parse(localStorage.getItem('jn_saved')||'[]');
let adv={};
let hasLoadedOnce=true;

function initials(n){return(n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';}
function escHtml(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}
function slugifyClient(v){
  return (String(v||'').toLowerCase().trim().replace(/[^a-z0-9\\s-]/g,'').replace(/\\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80))||'na';
}
function logoDomain(value){
  try{
    const raw=String(value||'').trim();
    const parsed=new URL(/^https?:\\/\\//i.test(raw)?raw:'https://'+raw);
    const host=parsed.hostname.toLowerCase();
    if(!host||host==='localhost'||host.endsWith('.local')||/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(host))return'';
    return host;
  }catch(e){return'';}
}
function logoHtml(co,sz='54px',jobLogo='',website=''){
  const name=String(co||'?');
  // Priority mirrors job-card.js's logoImgHtml(): admin/employer override
  // -> automatic /logo/<slug>.png proxy (Worker-side fetch, edge-cached,
  // never a direct third-party request from this browser) -> monogram.
  const override=jobLogo||COMPANY_LOGOS[name.toLowerCase()]||'';
  const slug=slugifyClient(name);
  const domain=logoDomain(website);
  const logo=override||(slug&&slug!=='na'?'/logo/'+slug+'.png'+(domain?'?domain='+encodeURIComponent(domain):''):'');
  const ini=initials(name);
  const fs=Math.round(parseInt(sz)*.32)+'px';
  if(!logo)return \`<div class="co-logo monogram-logo" role="img" aria-label="\${escHtml(name)}" style="width:\${sz};height:\${sz};display:flex;align-items:center;justify-content:center;font-size:\${fs};font-weight:800;color:#6339E6">\${escHtml(ini)}</div>\`;
  return \`<div class="co-logo" style="width:\${sz};height:\${sz}">
    <img src="\${escHtml(logo)}" alt="\${escHtml(name)}" loading="lazy" style="width:100%;height:100%;object-fit:contain;padding:6px" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex'">
    <span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:\${fs};font-weight:800;color:#6339E6">\${escHtml(ini)}</span>
  </div>\`;
}
function remoteTag(t){
  if(!t)return'';
  const m={fully_remote:['tag-remote',ICONS.globe+' Remote'],hybrid:['tag-hybrid',ICONS.building+' Hybrid'],on_site:['tag-onsite',ICONS.mapPin+' On-site'],onsite:['tag-onsite',ICONS.mapPin+' On-site']};
  const[cls,lbl]=m[t]||['tag-onsite',t.replace(/_/g,' ')];
  return\`<span class="tag \${cls}">\${lbl}</span>\`;
}
function catForTitle(title){
  const t=(title||'').toLowerCase();
  for(const k of CAT_ORDER){if(t.includes(k))return k;}
  return CAT_ORDER[0]||'developer';
}
function salaryTierCardTintClient(j){
  return ({HIGH:'var(--salary-high-bg,#eafaf1)',GOOD:'var(--salary-good-bg,#f0ecff)',STANDARD:'var(--salary-standard-bg,#f5f5f7)'})[j&&j.salary_tier]||'';
}
function pastelFor(j){
  if(FEATURES.featuredJobs && j.featured)return'var(--pastel-blue)';
  return salaryTierCardTintClient(j)||(j.isHotPay?'var(--pastel-yellow)':'var(--surface)');
}
function isNew(ts){if(!ts)return false;return Date.now()-new Date(ts).getTime()<86400000;}
function getTimeAgo(date){
  const diff=Date.now()-date.getTime();
  const h=Math.floor(diff/3600000);
  const d=Math.floor(diff/86400000);
  if(h<1)return'just now';
  if(h<24)return h+'h ago';
  return d+'d ago';
}

let toastTimer;
function showToast(msg,type='success'){
  const el=document.getElementById('toast');
  const icon=document.getElementById('toastIcon');
  const bar=document.getElementById('toastBar');
  document.getElementById('toastMsg').textContent=msg;
  icon.innerHTML=type==='success'?ICONS.check:ICONS.info;
  icon.style.color=type==='success'?'#059669':'#2563EB';
  el.className='toast show';
  if(bar){bar.style.animation='none';bar.offsetHeight;bar.style.animation='toast-bar 3s linear forwards';}
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),3100);
}

const VIEWS=['vJobs','vSaved'];
function showView(id){
  VIEWS.forEach(v=>{const el=document.getElementById(v);if(el)el.style.display=v===id?'block':'none';});
  window.scrollTo({top:0,behavior:'smooth'});
}
function goView(v){
  if(v==='jobs'){showView('vJobs');return;}
  if(v==='saved'){showView('vSaved');renderSaved();return;}
}
window.goView=goView;
if(IS_AUTHENTICATED){fetch('/api/user/saved-jobs').then(function(res){return res.ok?res.json():null;}).then(function(data){if(data&&Array.isArray(data.job_ids)){savedIds=data.job_ids;syncSaveButtons();}}).catch(function(){});}
function renderSkeletons(){
  return Array(4).fill(0).map(()=>\`
    <div class="job-card" style="pointer-events:none">
      <div class="card-inner">
        <div class="card-row1">
          <div class="skel" style="width:46px;height:46px;border-radius:10px;flex-shrink:0"></div>
          <div class="card-body">
            <div class="skel" style="height:12px;width:55%;margin-bottom:8px;border-radius:5px"></div>
            <div class="skel" style="height:16px;width:80%;margin-bottom:8px;border-radius:5px"></div>
            <div class="skel" style="height:11px;width:40%;border-radius:5px"></div>
          </div>
        </div>
      </div>
    </div>\`).join('');
}

function esc(s){
  if(s===null||s===undefined)return'';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function renderJobsList(){
  document.getElementById('jobsList').innerHTML=jobs.map((j,idx)=>{
    const nw=isNew(j.created_at);
    const hot=j.isHotPay===true;
    const timeAgo=j.created_at?getTimeAgo(new Date(j.created_at)):'';
    const k=catForTitle(j.title);
    const meta=CAT_META[k];
    const bg=pastelFor(j);
    const jts=jtStyleFor(j.job_type);
    return\`<article class="job-card\${jobTypeCardClass(j.job_type)}" style="--cat-color:\${meta.color};\${jtCardStyleAttr(j.job_type,bg)};animation:fadeInUp .3s ease \${Math.min(idx,6)*.04}s both">
      <div class="card-inner" style="padding:\${jts.card_padding}px 16px;background:inherit">
        <a href="/job/\${j.id}" class="card-row1" aria-label="View \${esc(j.title)} at \${esc(j.company)}">
          \${logoHtml(j.company,jts.logo_size+'px',j.company_logo_url,j.company_website)}
          <div class="card-body">
            <div class="card-badges">
              \${jobTypeBadge(j.job_type)}
              <span class="cat-dot"><span class="dot"></span>\${esc(meta.label)}</span>
              \${FEATURES.featuredJobs && j.featured?'<span class="tag-pinned">'+ICONS.pin+' Pinned</span>':''}
              \${nw?'<span class="tag-new">'+ICONS.sparkle+' NEW</span>':''}
              \${hot?'<span class="tag-hot">'+ICONS.flame+' '+HOT_PAY_LABEL+'</span>':''}
              \${salaryTierBadgeClient(j.salary_tier)}
            </div>
            <div class="job-title-card">\${esc(j.title)}</div>
            <div class="job-co-card">\${esc(j.company)} \${j.is_verified?'<span class="verified-ico" title="Verified Company">'+ICONS.badgeCheck+'</span>':''}</div>
            <div class="job-meta-row">
              \${remoteTag(j.remote_type)}
              \${j.employment_type?'<span class="tag tag-type">'+esc(j.employment_type.replace(/_/g,' '))+'</span>':''}
              \${j.seniority?'<span class="tag tag-type">'+esc(j.seniority)+'</span>':''}
            </div>
            \${normalizeJobType(j.job_type)==='Sponsored'&&j.job_type_note?'<div class="jt-note">'+esc(j.job_type_note)+'</div>':''}
          </div>
        </a>
        \${'<div class="card-right"><div class="card-secondary-meta">'+(j.location?'<span class="job-location job-location-v2" title="Job location">'+ICONS.mapPin+' '+esc(j.location)+'</span>':'')+(timeAgo?'<span class="card-time-corner">'+ICONS.clock+' '+timeAgo+'</span>':'')+'</div>'+(j.salary?'<div class="salary-badge">'+esc(j.salary)+'</div>':'')+'<button class="act-btn card-save-btn" id="sb-'+j.id+'" onclick="event.preventDefault();event.stopPropagation();toggleSave('+j.id+')" aria-label="Save job" title="Save job">'+ICONS.bookmark+'</button></div>'}
      </div>
    </article>\`;
  }).join('');
}

function buildQueryParams(){
  const p=new URLSearchParams();
  p.set('page',pg);
  if(cat)p.set('category',cat);
  if(srch)p.set('search',srch);
  if(adv.remote)p.set('remote_type',adv.remote);
  if(adv.employ)p.set('employment_type',adv.employ);
  if(adv.seniority)p.set('seniority',adv.seniority);
  if(adv.salaryMin)p.set('salary_min',adv.salaryMin);
  if(adv.salaryMax)p.set('salary_max',adv.salaryMax);
  if(adv.salaryTier)p.set('salary_tier',adv.salaryTier);
  if(adv.days)p.set('days',adv.days);
  if(adv.sourceType)p.set('source_type',adv.sourceType);
  if(adv.sort&&adv.sort!=='relevance')p.set('sort',adv.sort);
  if(adv.country)p.set('country',adv.country);
  if(adv.skill)p.set('skill',adv.skill);
  if(adv.company)p.set('company',adv.company);
  return p;
}

// Advanced Pagination (Stage 9) — URL State + Browser Navigation. Every
// filter/search/sort/page change was previously kept ONLY in JS memory:
// the address bar never changed, so refreshing, sharing the link, or
// using Back/Forward all silently lost the current search entirely and
// landed back on the plain unfiltered homepage. updateUrlBar() mirrors
// the exact state loadJobs() just fetched into the address bar (page=1
// omitted for a clean default URL); pushHistory=true is used ONLY for
// an actual page-to-page navigation (Next/Prev/page number), since that
// is the one action a user genuinely expects the Back button to step
// through — a filter/search/sort change instead REPLACES the current
// history entry, so idly adjusting five filters in a row doesn't require
// mashing Back five times to escape.
function updateUrlBar(pushHistory){
  const p=buildQueryParams();
  if(p.get('page')==='1')p.delete('page');
  const qs=p.toString();
  const newUrl=window.location.pathname+(qs?'?'+qs:'');
  if(newUrl===window.location.pathname+window.location.search)return;
  if(pushHistory)history.pushState({jnSearch:true},'',newUrl);
  else history.replaceState({jnSearch:true},'',newUrl);
}

// Reads state BACK out of the URL — used on first load (so a shared/
// refreshed link actually restores the filtered view instead of the
// plain homepage) and on popstate (Back/Forward). Also syncs the actual
// form controls' displayed values, not just the in-memory cat/adv
// object, since a restored filter that doesn't visually show up as
// selected in its dropdown would look like the search silently failed.
function applyStateFromUrl(){
  const p=new URLSearchParams(window.location.search);
  cat=p.get('category')||'';
  srch=p.get('search')||'';
  pg=Math.max(1,parseInt(p.get('page')||'1',10)||1);
  adv={
    remote:p.get('remote_type')||'', employ:p.get('employment_type')||'',
    seniority:p.get('seniority')||'', salaryMin:p.get('salary_min')||'',
    salaryMax:p.get('salary_max')||'', salaryTier:p.get('salary_tier')||'', days:p.get('days')||'',
    sourceType:p.get('source_type')||'', sort:p.get('sort')||'relevance',
    country:p.get('country')||'', skill:p.get('skill')||'', company:p.get('company')||'',
  };
  const setVal=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  setVal('fCategory',cat); setVal('searchInput',srch); setVal('fCountry',adv.country); setVal('fRemote',adv.remote);
  setVal('fEmploy',adv.employ); setVal('fSeniority',adv.seniority); setVal('fSalaryMin',adv.salaryMin);
  setVal('fSalaryMax',adv.salaryMax); setVal('fSalaryTier',adv.salaryTier); setVal('fDays',adv.days); setVal('fSourceType',adv.sourceType);
  setVal('fSort',adv.sort);
  document.querySelectorAll('.chip[data-cat]').forEach(el=>el.classList.toggle('active',el.dataset.cat===cat));
  updateFiltersBadge();
  return p.toString().length>0; // true if the URL actually carried any search state
}

async function loadJobs(pushHistory){
  document.getElementById('jobsList').innerHTML=renderSkeletons();
  const paginationEl=document.getElementById('pagination');
  if(paginationEl)paginationEl.innerHTML='';
  const p=buildQueryParams();
  try{
    const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),12000);
    const res=await fetch('/api/jobs?'+p,{signal:ctl.signal});
    clearTimeout(tm);
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    jobs=data.jobs||[];total=data.total||0;
    updateUrlBar(!!pushHistory);
    document.getElementById('resultsCount').innerHTML=\`<strong>\${total.toLocaleString()}</strong> jobs found\${cat?' in <strong>'+(CAT_META[cat]?CAT_META[cat].label:cat)+'</strong>':''}\${adv.country?' in <strong>'+esc(adv.country)+'</strong>':''}\${adv.skill?' with <strong>'+esc(adv.skill)+'</strong>':''}\${adv.company?' at <strong>'+esc(adv.company)+'</strong>':''}\${srch?' for "<strong>'+srch+'</strong>"':''}\`;
    if(!jobs.length){
      document.getElementById('jobsList').innerHTML=\`<div class="empty"><div class="e-icon">\${ICONS.searchLg}</div><h3>No jobs found</h3><p>Try a different keyword, remove a filter, or widen the location.</p><button onclick="clearFilters()" class="filters-clear-btn" style="display:inline-flex;margin-top:12px">Clear all filters</button></div>\`;
      return;
    }
    renderJobsList();
    syncSaveButtons();
    renderPagination();
  }catch(e){
    document.getElementById('jobsList').innerHTML=\`<div class="empty"><div class="e-icon">\${ICONS.alertTriangle}</div><h3>Failed to load</h3><p>Refresh and try again</p></div>\`;
  }
}

function syncSaveButtons(){document.querySelectorAll('.card-save-btn[id^="sb-"]').forEach(btn=>{const id=Number(btn.id.slice(3));btn.classList.toggle('saved',savedIds.includes(id));});}
function redirectToLogin(){const next=window.location.pathname+window.location.search;window.location.href='/login?next='+encodeURIComponent(next);}
function toggleSave(id){
  if(!IS_AUTHENTICATED){showToast('Sign in to save jobs','info');setTimeout(redirectToLogin,450);return;}
  const idx=savedIds.indexOf(id);
  const nowSaved = idx < 0;
  if(idx>=0){savedIds.splice(idx,1);showToast('Removed from saved','info');}
  else{savedIds.push(id);showToast('Job saved!');}
  localStorage.setItem('jn_saved',JSON.stringify(savedIds));
  const btn=document.getElementById('sb-'+id);
  if(btn)btn.classList.toggle('saved',savedIds.includes(id));
  fetch('/api/user/saved-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:id,action:nowSaved?'save':'unsave'})}).then(function(res){if(!res.ok)throw new Error('save failed');}).catch(function(){showToast('Unable to update saved jobs','info');});
}
window.toggleSave=toggleSave;
function shareJob(id){
  const url=window.location.origin+'/job/'+id;
  if(window.jobforionAnalytics) window.jobforionAnalytics.track('job_share',{job_id:Number(id)});
  navigator.clipboard.writeText(url).then(()=>showToast('Link copied!')).catch(()=>showToast('Copied!'));
}
window.shareJob=shareJob;

function renderSaved(){
  if(!savedIds.length){
    document.getElementById('savedList').innerHTML=\`<div class="empty"><div class="e-icon">\${ICONS.bookmark}</div><h3>No saved jobs yet</h3><p>Tap the bookmark icon to save jobs</p></div>\`;
    return;
  }
  const saved=jobs.filter(j=>savedIds.includes(j.id));
  if(!saved.length){
    document.getElementById('savedList').innerHTML=\`<div class="empty"><div class="e-icon">\${ICONS.bookmark}</div><h3>Browse jobs and save the ones you like</h3></div>\`;
    return;
  }
  document.getElementById('savedList').innerHTML=saved.map(j=>\`
    <article class="job-card">
      <div class="card-inner">
        <a href="/job/\${j.id}" class="card-row1" aria-label="View \${esc(j.title)} at \${esc(j.company)}">
          \${logoHtml(j.company,'54px','',j.company_website)}
          <div class="card-body">
            <div class="job-title-card">\${esc(j.title)}</div>
            <div class="job-co-card">\${esc(j.company)}</div>
            <div class="job-meta-row">\${remoteTag(j.remote_type)}\${salaryTierBadgeClient(j.salary_tier)}</div>
          </div>
        </a>
        <div class="card-right">
          \${j.salary?'<div class="salary-badge">'+esc(j.salary)+'</div>':'<div></div>'}
          <button class="act-btn saved" aria-label="Remove saved job" onclick="event.preventDefault();toggleSave(\${j.id});renderSaved()">\${ICONS.bookmark}</button>
        </div>
      </div>
    </article>\`).join('');
}

function clearAllSaved(){savedIds=[];localStorage.removeItem('jn_saved');renderSaved();showToast('All cleared','info');}

function setSearchAndGo(v){const input=document.getElementById('searchInput');if(input)input.value=v;srch=v;pg=1;loadJobs();}
function quickJobTab(type,btn){document.querySelectorAll('.job-tabs button').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');if(type==='all'){adv.remote='';adv.employ='';}else if(type==='remote'){adv.remote='fully_remote';adv.employ='';}else{adv.remote='';adv.employ=type;}const remote=document.getElementById('fRemote');const employ=document.getElementById('fEmploy');if(remote)remote.value=adv.remote;if(employ)employ.value=adv.employ;pg=1;updateFiltersBadge();loadJobs();}
function debounceSearch(v){clearTimeout(srchT);srchT=setTimeout(()=>{srch=v;pg=1;loadJobs();},400);}
function debounceCountryChange(v){clearTimeout(srchT);srchT=setTimeout(()=>{adv.country=v.trim();pg=1;updateFiltersBadge();loadJobs();},450);}

// ── Filters panel (attached to the hero search box) ──────────────
function initHomepageReveal(){
  const root=document.documentElement;
  const sections=[...document.querySelectorAll('.homepage-reveal-section')];
  if(!sections.length)return;
  root.classList.add('js-reveal-ready');
  const reduceMotion=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  sections.forEach(section=>{
    section.querySelectorAll('.company-tile,.cg-item,.insight-tile').forEach((item,index)=>{
      item.classList.add('homepage-reveal-item');
      item.style.setProperty('--reveal-delay',(Math.min(index,7)*45)+'ms');
    });
  });
  if(reduceMotion || !('IntersectionObserver' in window)){
    sections.forEach(section=>section.classList.add('is-visible'));
    return;
  }
  const observer=new IntersectionObserver((entries,obs)=>{
    entries.forEach(entry=>{
      if(!entry.isIntersecting)return;
      entry.target.classList.add('is-visible');
      obs.unobserve(entry.target);
    });
  },{rootMargin:'0px 0px -10% 0px',threshold:.12});
  sections.forEach(section=>observer.observe(section));
}
function toggleFiltersPanel(){
  document.getElementById('filtersPanel').classList.toggle('open');
  document.getElementById('filtersToggleBtn').classList.toggle('active');
}
function updateFiltersBadge(){
  // adv.sort defaults to 'relevance' once the Sort dropdown exists in the
  // DOM — that's a no-op choice, not an active filter, so it's excluded
  // from the count (otherwise the badge would always show "1" the moment
  // someone opens the filters panel, even with nothing actually filtered).
  const activeAdvCount=Object.entries(adv).filter(([k,v])=>v&&!(k==='sort'&&v==='relevance')).length;
  const count=(cat?1:0)+activeAdvCount;
  const badge=document.getElementById('filtersCountBadge');
  const clearBtn=document.getElementById('filtersClearBtn');
  if(count>0){badge.style.display='inline-block';badge.textContent=count;clearBtn.style.display='inline';}
  else{badge.style.display='none';clearBtn.style.display='none';}
}
function onFilterChange(){
  cat=document.getElementById('fCategory').value;
  adv.remote=document.getElementById('fRemote').value;
  adv.employ=document.getElementById('fEmploy').value;
  adv.country=document.getElementById('fCountry')?.value.trim() || '';
  adv.seniority=document.getElementById('fSeniority').value;
  adv.days=document.getElementById('fDays').value;
  adv.salaryTier=document.getElementById('fSalaryTier').value;
  adv.sourceType=document.getElementById('fSourceType').value;
  adv.sort=document.getElementById('fSort').value;
  pg=1;
  updateFiltersBadge();
  loadJobs();
}
let filterDebT;
function debounceFilterChange(){
  clearTimeout(filterDebT);
  filterDebT=setTimeout(()=>{
    adv.salaryMin=document.getElementById('fSalaryMin').value;
    adv.salaryMax=document.getElementById('fSalaryMax').value;
    pg=1;
    updateFiltersBadge();
    loadJobs();
  },500);
}
function clearFilters(){
  cat='';adv={};
  ['fCategory','fCountry','fRemote','fEmploy','fSeniority','fDays','fSalaryMin','fSalaryMax','fSalaryTier','fSourceType'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('fSort').value='relevance';
  pg=1;
  updateFiltersBadge();
  loadJobs();
}
function goPage(p){pg=p;loadJobs(true);window.scrollTo({top:0,behavior:'smooth'});}

function renderPagination(){
  const el=document.getElementById('pagination');
  if(!el)return;
  const tp=Math.ceil(total/20);
  el.innerHTML=tp>1?\`
    <button class="page-btn" onclick="goPage(\${pg-1})" \${pg===1?'disabled':''} aria-label="Previous page"> Prev</button>
    <span class="page-info" aria-current="page">Page \${pg} / \${tp}</span>
    <button class="page-btn" onclick="goPage(\${pg+1})" \${pg===tp?'disabled':''} aria-label="Next page">Next </button>\`:'';
}

// bind actions on the server-rendered initial cards too, and fill in
// what only client JS can compute (relative time-ago is already SSR'd,
// but pagination needs the live "total" count known only after render)
document.addEventListener('DOMContentLoaded',()=>{
    initHomepageReveal();
    // Server could not build the list (schema still migrating, D1 hiccup): never leave
    // the spinner up — fetch it from the API, which shows a clear message on failure.
    const jl=document.getElementById('jobsList');
    if(jl&&jl.dataset.degraded==='1'&&!jl.querySelector('.job-card'))loadJobs();
    savedIds.forEach(id=>{const b=document.getElementById('sb-'+id);if(b)b.classList.add('saved');});
    document.querySelectorAll('.card-save-btn').forEach(btn=>{const id=Number(btn.id.replace('sb-',''));if(savedIds.includes(id))btn.classList.add('saved');});
  // If the URL was opened WITH search state (shared link, refresh, or a
  // Back/Forward landing here), the server-side render above only ever
  // produced the plain unfiltered top-20 — re-fetch client-side with the
  // restored filters applied. A plain "/" with no params skips this
  // extra request entirely, keeping the original fast first paint.
  if(applyStateFromUrl())loadJobs(false);
  else renderPagination();
});
// Browser Back/Forward (plan Stage 9) — re-read whatever state the
// browser just navigated to and reload results to match, WITHOUT
// pushing yet another history entry (that would fight the browser's own
// navigation stack).
window.addEventListener('popstate',()=>{
  applyStateFromUrl();
  loadJobs(false);
});
</script>`;
}
