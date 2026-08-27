function safeJson(value) { return JSON.stringify(value).replace(/</g, '\\u003c'); }

export function analyticsTrackerScript(settings = {}) {
  if (settings.analytics_enabled === '0') return '';
  const sampleRate = Math.min(100, Math.max(10, Number(settings.analytics_sample_rate || 100)));
  return `<script>
(function(){
  'use strict';
  if (Math.random()*100 > ${sampleRate}) return;
  var allowed = new Set(${safeJson(['page_view','job_impression','job_view','job_apply_click','job_favorite','job_share','company_view','company_follow','search','search_result_click','filter_used','category_view','country_view','premium_view','checkout_started','payment_started'])});
  var sessionKey='jf_analytics_session';
  var sessionId='';
  try { sessionId=sessionStorage.getItem(sessionKey)||''; if(!sessionId){sessionId=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+'_'+Math.random());sessionStorage.setItem(sessionKey,sessionId);}   } catch(e) { sessionId='ephemeral_'+String(Date.now())+'_'+Math.random().toString(36).slice(2); }
  var params=new URLSearchParams(location.search);
  var utm={source:params.get('utm_source')||'',medium:params.get('utm_medium')||'',campaign:params.get('utm_campaign')||'',content:params.get('utm_content')||'',term:params.get('utm_term')||''};
  var sent=new Set();
  function device(){var w=window.innerWidth||0;return w<640?'mobile':w<1024?'tablet':'desktop';}
  function send(type, data){ if(!allowed.has(type)) return; var payload=Object.assign({event_type:type,event_id:(crypto.randomUUID?crypto.randomUUID():String(Date.now())+'_'+Math.random()),session_id:sessionId,page:location.pathname,landing_page:location.pathname,referrer:document.referrer||'',device_type:device(),source:utm.source||'direct',medium:utm.medium||'none',campaign:utm.campaign||''},data||{}); var key=type+'|'+(payload.job_id||'')+'|'+(payload.page||''); if((type==='page_view'||type==='job_view')&&sent.has(key))return; sent.add(key); var body=JSON.stringify(payload); try { if(navigator.sendBeacon){var blob=new Blob([body],{type:'application/json'}); if(navigator.sendBeacon('/api/analytics/events',blob)) return;} fetch('/api/analytics/events',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).catch(function(){}); } catch(e){} }
  window.jobforionAnalytics={track:send};
  document.addEventListener('DOMContentLoaded',function(){
    send('page_view');
    var path=location.pathname.match(/^\\/job\\/(\\d+)$/); if(path) send('job_view',{job_id:Number(path[1])});
    if(/^\\/companies\\//.test(location.pathname)) send('company_view',{metadata:{slug:location.pathname.slice(11,160)}});
    if(/^\\/categories\\//.test(location.pathname)) send('category_view',{metadata:{slug:location.pathname.slice(12,160)}});
    if(/^\\/countries\\//.test(location.pathname)) send('country_view',{metadata:{slug:location.pathname.slice(11,160)}});
    if(location.pathname==='/pricing') send('premium_view');
    var cards=[].slice.call(document.querySelectorAll('[data-job-id],.job-card')); if('IntersectionObserver' in window){var io=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){var id=entry.target.getAttribute('data-job-id')||((entry.target.querySelector('a[href^="/job/"]')||{}).getAttribute&&entry.target.querySelector('a[href^="/job/"]').getAttribute('href').split('/').pop());if(id&&/^\\d+$/.test(String(id)))send('job_impression',{job_id:Number(id)});io.unobserve(entry.target);}});},{threshold:.25});cards.forEach(function(card){io.observe(card);});}
    document.querySelectorAll('.apply-big,.apply-mobile-sticky').forEach(function(el){el.addEventListener('click',function(){if(path)send('job_apply_click',{job_id:Number(path[1])});});});
    document.querySelectorAll('a[href^="/job/"]').forEach(function(el){el.addEventListener('click',function(){var m=el.getAttribute('href').match(/^\\/job\\/(\\d+)$/);if(m&&!path)send('search_result_click',{job_id:Number(m[1])});});});
    document.querySelectorAll('.job-save-outline,.card-save-btn').forEach(function(el){el.addEventListener('click',function(){var id=el.getAttribute('data-job-id')||el.id.replace(/[^0-9]/g,'')||(path?path[1]:'');if(id)send('job_favorite',{job_id:Number(id)});});});
    document.querySelectorAll('form').forEach(function(form){form.addEventListener('submit',function(){var input=form.querySelector('input[name="q"],input[type="search"],input[name="search"]');if(input&&input.value.trim())send('search',{metadata:{query:input.value.trim().slice(0,120)}});if((form.getAttribute('action')||'').indexOf('/company/post-job')>=0)send('job_post_completed');if((form.getAttribute('action')||'').indexOf('/api/monetization/orders')>=0)send('checkout_started');});});
    document.addEventListener('change',function(event){var el=event.target;if(el&&el.id&&/^f[A-Z]/.test(el.id)&&el.value)send('filter_used',{metadata:{filter:el.id.slice(1),value:String(el.value).slice(0,80)}});});
  });
})();
</script>`;
}
