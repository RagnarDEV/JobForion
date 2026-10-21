// src/components/admin/live-charts.js
// Styles + browser script for the Live Analytics page (pages/admin/live.js).
//
// No chart library: charts are inline SVG built here (zero extra requests,
// works inside the existing CSP, themes via the admin CSS variables).
//
// COST GUARDS (the page must never burn the free-plan quota):
//   • polls every 15 s (3 s only while the server says more rows are waiting)
//   • pauses automatically when the tab is hidden
//   • stops by itself after 30 min until the admin presses Resume
//   • each poll asks only for rows newer than the last id already received
//
// SECURITY: every server-provided string is passed through esc() before it is
// placed in innerHTML; no server data is ever evaluated or used as a URL.
// NOTE: this file is a template literal — keep the client code free of
// backticks and "${" sequences (string concatenation only).

export const LIVE_CSS = `
.lv-page{padding-bottom:48px}
.lv-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.lv-head h1{margin:0 0 5px;display:flex;align-items:center;gap:10px}
.lv-head p{margin:0;color:var(--ink3);font-size:12px;line-height:1.6;max-width:640px}
.lv-badge{display:inline-flex;align-items:center;gap:6px;font:800 10px/1 var(--font-body,inherit);letter-spacing:.8px;padding:5px 9px;border-radius:99px;background:rgba(15,174,121,.12);color:var(--green,#0FAE79);border:1px solid rgba(15,174,121,.25)}
.lv-badge i{width:7px;height:7px;border-radius:50%;background:currentColor;animation:lv-pulse 1.6s ease-in-out infinite}
.lv-badge.off{background:var(--surface2);color:var(--ink3);border-color:var(--border2)}
.lv-badge.off i{animation:none}
.lv-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lv-status{font-size:11px;color:var(--ink3)}
.lv-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:14px}
.lv-kpi{padding:14px;border:1px solid var(--border);border-radius:13px;background:var(--surface);box-shadow:var(--shadow-card,var(--shadow))}
.lv-kpi span{display:flex;align-items:center;gap:6px;color:var(--ink3);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px}
.lv-kpi strong{display:block;margin-top:8px;color:var(--ink);font:800 24px var(--font-heading,sans-serif)}
.lv-kpi small{display:block;margin-top:3px;color:var(--ink3);font-size:10px}
.lv-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px;margin-top:14px}
.lv-card{padding:16px;border-radius:14px;min-width:0}
.lv-card h2{margin:0 0 3px;font:800 14px var(--font-heading,sans-serif);color:var(--ink)}
.lv-card>p{margin:0 0 12px;color:var(--ink3);font-size:11px;line-height:1.5}
.lv-c8{grid-column:span 8}.lv-c4{grid-column:span 4}.lv-c6{grid-column:span 6}.lv-c12{grid-column:span 12}
.lv-seg{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--border2);border-radius:10px;background:var(--surface2)}
.lv-seg button{border:0;background:transparent;color:var(--ink2);font:700 11px inherit;padding:6px 11px;border-radius:7px;cursor:pointer}
.lv-seg button[aria-pressed="true"]{background:var(--brand);color:#fff}
.lv-legend{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px}
.lv-leg{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border2);background:var(--surface);color:var(--ink2);font:700 11px inherit;padding:5px 10px;border-radius:99px;cursor:pointer}
.lv-leg[aria-pressed="false"]{opacity:.45}
.lv-sw{width:9px;height:9px;border-radius:3px;display:inline-block}
.lv-chart-wrap{position:relative}
#lvChart{width:100%;touch-action:pan-y}
#lvChart svg{display:block;width:100%;height:auto}
.lv-grid-l{stroke:var(--border);stroke-width:1}
.lv-axis{fill:var(--ink3);font:600 10px sans-serif}
.lv-stop1{stop-color:var(--brand,#3556FF);stop-opacity:.32}
.lv-stop2{stop-color:var(--brand,#3556FF);stop-opacity:0}
.lv-line-pv{fill:none;stroke:var(--brand,#3556FF);stroke-width:2.2;stroke-linejoin:round}
.lv-line-jv{fill:none;stroke:var(--cyan,#0EA5C4);stroke-width:2;stroke-linejoin:round}
.lv-line-ap{fill:none;stroke:var(--green,#0FAE79);stroke-width:2;stroke-linejoin:round}
.lv-cross{stroke:var(--ink3);stroke-dasharray:3 3;stroke-width:1}
.lv-dot{fill:var(--brand,#3556FF)}
.lv-ring{fill:none;stroke:var(--brand,#3556FF);stroke-width:2;transform-box:fill-box;transform-origin:center;animation:lv-ring 1.8s ease-out infinite}
.lv-tip{position:absolute;top:0;pointer-events:none;min-width:130px;padding:9px 11px;border:1px solid var(--border2);border-radius:10px;background:var(--surface);box-shadow:var(--shadow-lg);font-size:11px;color:var(--ink2);display:none;z-index:3}
.lv-tip b{display:block;color:var(--ink);margin-bottom:4px}
.lv-tip div{display:flex;justify-content:space-between;gap:14px}
.lv-empty{padding:26px 8px;text-align:center;color:var(--ink3);font-size:12px}
.lv-bars{display:grid;gap:5px}
.lv-bar{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:30px;padding:5px 9px;border:1px solid transparent;border-radius:8px;background:var(--surface2);color:var(--ink2);font:600 11.5px inherit;text-align:start;overflow:hidden;cursor:pointer}
.lv-bar:disabled{cursor:default}
.lv-bar:not(:disabled):hover,.lv-bar.sel{border-color:var(--brand)}
.lv-bar-fill{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,rgba(53,86,255,.18),rgba(53,86,255,.04));pointer-events:none}
.lv-bar-k{position:relative;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.lv-bar-v{position:relative;color:var(--ink);font-weight:800}
.lv-donut{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.lv-donut svg{width:132px;height:132px;flex:none}
.lv-donut-n{fill:var(--ink);font:800 17px sans-serif}
.lv-legend2{display:grid;gap:7px;font-size:12px;color:var(--ink2)}
.lv-legend2 div{display:flex;align-items:center;gap:7px}
.lv-legend2 b{margin-inline-start:auto;color:var(--ink)}
.lv-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.lv-chip{border:1px solid var(--border2);background:var(--surface);color:var(--ink2);font:700 11px inherit;padding:6px 11px;border-radius:99px;cursor:pointer}
.lv-chip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--bg,#fff)}
.lv-feed{display:grid;max-height:420px;overflow-y:auto}
.lv-row{display:grid;grid-template-columns:22px minmax(0,1.4fr) 34px 22px minmax(0,.8fr) 38px;gap:8px;align-items:center;padding:8px 4px;border-bottom:1px solid var(--border);font-size:11.5px;color:var(--ink2)}
.lv-row.fresh{animation:lv-fresh 2.4s ease-out}
.lv-row b{display:block;color:var(--ink);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lv-row small{display:block;color:var(--ink3);font-size:10px}
.lv-row .lv-cc{font-weight:800;color:var(--ink)}
.lv-row .lv-src{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lv-row .lv-ago{text-align:end;color:var(--ink3)}
.lv-jobs{display:grid;gap:6px}
.lv-job{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:9px;background:var(--surface2);font-size:11.5px}
.lv-job b{display:block;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lv-job small{color:var(--ink3)}
.lv-job span{white-space:nowrap;color:var(--ink2);font-weight:700}
.lv-meter{margin-bottom:12px}
.lv-meter div{display:flex;justify-content:space-between;font-size:11px;color:var(--ink2);margin-bottom:5px}
.lv-meter i{display:block;height:8px;border-radius:99px;background:var(--surface2);overflow:hidden}
.lv-meter em{display:block;height:100%;border-radius:99px;background:var(--green,#0FAE79);transition:width .4s}
.lv-meter em.warn{background:var(--amber,#F5A623)}.lv-meter em.hot{background:var(--coral,#FF5C7A)}
.lv-note{font-size:10.5px;color:var(--ink3);line-height:1.6;margin-top:6px}
.lv-sys{display:grid;gap:6px;font-size:11.5px;color:var(--ink2)}
.lv-sys div{display:flex;justify-content:space-between;gap:10px}
.lv-sys b{color:var(--ink)}
@keyframes lv-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(1.5)}}
@keyframes lv-ring{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.3);opacity:0}}
@keyframes lv-fresh{0%{background:rgba(53,86,255,.16)}100%{background:transparent}}
@media(prefers-reduced-motion:reduce){.lv-badge i,.lv-ring,.lv-row.fresh{animation:none}}
@media(max-width:1100px){.lv-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:900px){.lv-c8,.lv-c4,.lv-c6{grid-column:span 12}}
@media(max-width:560px){.lv-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.lv-kpi{padding:12px}.lv-kpi strong{font-size:20px}.lv-card{padding:13px}.lv-row{grid-template-columns:20px minmax(0,1fr) 30px 36px}.lv-row .lv-dev,.lv-row .lv-src{display:none}.lv-tools .adm-btn{flex:1;justify-content:center}}
`;

export function liveClientScript(icons) {
  const iconsJson = JSON.stringify(icons).replace(/</g, '\\u003c');
  return `
(function(){
'use strict';
var ICONS=${iconsJson};
var BASE='/admin/analytics/live/data?mode=';
var POLL_MS=15000,FAST_MS=3000,SESSION_MS=30*60*1000;
var TXT={};
document.querySelectorAll('#lvText [data-k]').forEach(function(n){TXT[n.getAttribute('data-k')]=n.textContent.trim();});
function T(k){return TXT[k]||k;}
function $(id){return document.getElementById(id);}
function M(){return Object.create(null);}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function fmt(n){return Number(n||0).toLocaleString();}
function pad(n){return n<10?'0'+n:''+n;}
function bump(o,k,n){if(!k)return;o[k]=(o[k]||0)+(n||1);}
function topN(o,n){return Object.keys(o).map(function(k){return[k,o[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0,n);}

var S={lastId:0,offset:0,paused:false,expired:false,started:Date.now(),polls:0,timer:null,inflight:false,
  range:'1h',show:{pv:true,jv:true,ap:false},filter:'all',fPage:'',fCountry:'',hover:null,
  minutes:M(),hours:M(),daily:{7:null,30:null},pages:M(),countries:M(),sources:M(),devices:M(),terms:M(),zero:M(),
  jobs:[],totals:{pv:0,jv:0,ap:0,se:0,imp:0},active:M(),feed:[],sys:{},dbMs:0,windowStart:null,capped:false,events:0,geo:null};

function now(){return Date.now()+S.offset;}
function ago(t){var s=Math.max(0,Math.round((now()-t)/1000));if(s<60)return s+'s';var m=Math.floor(s/60);return m<60?m+'m':Math.floor(m/60)+'h';}
function hhmm(ms){var d=new Date(ms);return pad(d.getHours())+':'+pad(d.getMinutes());}
function region(c){if(!c||c==='XX')return T('unknown');try{if(!S.dn)S.dn=new Intl.DisplayNames([document.documentElement.lang||'en'],{type:'region'});return S.dn.of(c)||c;}catch(e){return c;}}

function kindOf(y){return y==='page_view'?'pv':y==='job_view'?'jv':y==='job_apply_click'?'ap':y==='search'?'se':'other';}

function addEvent(e,live){
  var k=kindOf(e.y),mk=Math.floor(e.t/60000),hk=Math.floor(e.t/3600000);
  if(k==='pv'||k==='jv'||k==='ap'){
    var i=k==='pv'?0:k==='jv'?1:2;
    var m=S.minutes[mk]||(S.minutes[mk]=[0,0,0]);m[i]++;
    var h=S.hours[hk]||(S.hours[hk]=[0,0,0]);h[i]++;
  }
  if(k!=='other'&&S.totals[k]!==undefined)S.totals[k]++;
  if(k==='pv'){bump(S.pages,e.p||'/');bump(S.countries,e.c);if(e.s&&e.s!=='internal')bump(S.sources,e.s);bump(S.devices,e.d);}
  if(k==='se'&&e.q){bump(S.terms,e.q);if(e.n===0)bump(S.zero,e.q);}
  if(e.u)S.active[e.u]=e.t;
  if(live){S.events++;e.f=Date.now();S.feed.unshift(e);if(S.feed.length>60)S.feed.length=60;}
}

function toMap(arr){var o=M();(arr||[]).forEach(function(p){o[p[0]]=p[1];});return o;}
function hydrate(d){
  S.lastId=d.lastId||0;S.offset=d.serverNow-Date.now();
  S.minutes=M();Object.keys(d.minutes||{}).forEach(function(k){S.minutes[k]=d.minutes[k];});
  S.hours=M();Object.keys(d.hours||{}).forEach(function(k){S.hours[k]=d.hours[k];});
  S.totals=d.totals||S.totals;
  S.pages=toMap(d.tops.pages);S.countries=toMap(d.tops.countries);S.sources=toMap(d.tops.sources);
  S.devices=toMap(d.tops.devices);S.terms=toMap(d.tops.terms);S.zero=toMap(d.tops.zero);S.jobs=d.tops.jobs||[];
  S.active=M();(d.active||[]).forEach(function(p){S.active[p[0]]=p[1];});
  S.feed=d.feed||[];S.sys=d.system||{};S.dbMs=d.dbMs||0;S.windowStart=d.windowStart;S.capped=!!d.capped;
  S.events=(d.totals.pv+d.totals.jv+d.totals.ap+d.totals.se+d.totals.imp)||0;
}

function activeCount(){var c=0,cut=now()-300000,u;for(u in S.active){if(S.active[u]>=cut)c++;else delete S.active[u];}return c;}
function perMin(){var t=now(),tot=0,i,m;for(i=0;i<5;i++){m=S.minutes[Math.floor((t-i*60000)/60000)];if(m)tot+=m[0];}return (tot/5).toFixed(1);}

function setText(id,v){var el=$(id);if(el)el.textContent=v;}
function renderKpis(){
  setText('kActive',fmt(activeCount()));setText('kRate',perMin());
  setText('kPv',fmt(S.totals.pv));setText('kJv',fmt(S.totals.jv));setText('kAp',fmt(S.totals.ap));
  setText('kSe',fmt(S.totals.se));
  var z=0,k;for(k in S.zero)z+=S.zero[k];
  setText('kSeNote',S.totals.se?Math.round(z/S.totals.se*100)+'% '+T('zero_results'):T('no_searches'));
  var cov=$('lvWindow');
  if(cov)cov.textContent=S.windowStart?(S.capped?T('window_capped')+' ':T('window_since')+' ')+hhmm(S.windowStart):'';
}

function seriesFor(range){
  var t=now(),out=[],i,k,v;
  if(range==='1h'){for(i=59;i>=0;i--){k=Math.floor((t-i*60000)/60000);v=S.minutes[k]||[0,0,0];out.push({l:hhmm(k*60000),v:v});}}
  else if(range==='24h'){for(i=23;i>=0;i--){k=Math.floor((t-i*3600000)/3600000);v=S.hours[k]||[0,0,0];out.push({l:pad(new Date(k*3600000).getHours())+':00',v:v});}}
  else{var d=S.daily[range==='7d'?7:30];if(!d)return null;out=d.map(function(r){return{l:String(r.d).slice(5),v:[r.pv,r.jv,r.ap]};});}
  return out;
}
function niceMax(m){if(m<=4)return 4;var p=Math.pow(10,Math.floor(Math.log10(m))),f=m/p;return(f<=1?1:f<=2?2:f<=5?5:10)*p;}

var CW=600,CH=220,PL=34,PR=10,PT=12,PB=24;
function drawChart(){
  var box=$('lvChart');if(!box)return;
  var pts=seriesFor(S.range);
  if(!pts){box.innerHTML='<div class="lv-empty">'+esc(T('loading'))+'</div>';return;}
  S.pts=pts;
  var max=1,keys=['pv','jv','ap'];
  pts.forEach(function(p){keys.forEach(function(kk,i){if(S.show[kk]&&p.v[i]>max)max=p.v[i];});});
  max=niceMax(max);
  var w=CW-PL-PR,h=CH-PT-PB,n=pts.length,step=n>1?w/(n-1):w;
  function X(i){return PL+i*step;}function Y(v){return PT+h-(v/max)*h;}
  var i,g='',xl='',paths='',area='';
  for(i=0;i<=4;i++){var gv=max*i/4,gy=Y(gv);g+='<line class="lv-grid-l" x1="'+PL+'" x2="'+(CW-PR)+'" y1="'+gy.toFixed(1)+'" y2="'+gy.toFixed(1)+'"/><text class="lv-axis" x="'+(PL-6)+'" y="'+(gy+3).toFixed(1)+'" text-anchor="end">'+Math.round(gv)+'</text>';}
  for(i=0;i<5;i++){var idx=Math.round((n-1)*i/4);xl+='<text class="lv-axis" x="'+X(idx).toFixed(1)+'" y="'+(CH-6)+'" text-anchor="'+(i===0?'start':i===4?'end':'middle')+'">'+esc(pts[idx].l)+'</text>';}
  keys.forEach(function(kk,ki){
    if(!S.show[kk])return;
    var d=pts.map(function(p,j){return(j?'L':'M')+X(j).toFixed(1)+' '+Y(p.v[ki]).toFixed(1);}).join('');
    if(kk==='pv')area='<path d="'+d+'L'+X(n-1).toFixed(1)+' '+(PT+h)+'L'+X(0).toFixed(1)+' '+(PT+h)+'Z" fill="url(#lvg)"/>';
    paths+='<path class="lv-line-'+kk+'" d="'+d+'"/>';
  });
  var last=pts[n-1],lk=S.show.pv?0:S.show.jv?1:2,live='';
  if(S.range==='1h'||S.range==='24h')live='<circle class="lv-ring" cx="'+X(n-1).toFixed(1)+'" cy="'+Y(last.v[lk]).toFixed(1)+'" r="4"/><circle class="lv-dot" cx="'+X(n-1).toFixed(1)+'" cy="'+Y(last.v[lk]).toFixed(1)+'" r="3.5"/>';
  S.geo={step:step,n:n};
  box.innerHTML='<svg viewBox="0 0 '+CW+' '+CH+'" role="img" aria-label="'+esc(T('chart_label'))+'"><defs><linearGradient id="lvg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="lv-stop1"/><stop offset="1" class="lv-stop2"/></linearGradient></defs>'+g+xl+area+paths+live+'<line id="lvCross" class="lv-cross" y1="'+PT+'" y2="'+(PT+h)+'" style="display:none"/></svg>';
  if(S.hover!=null)showTip(S.hover);
}
function showTip(i){
  var box=$('lvChart'),tip=$('lvTip'),pts=S.pts;
  if(!box||!tip||!pts||!pts[i])return;
  S.hover=i;
  var r=box.getBoundingClientRect(),x=(PL+i*S.geo.step)/CW*r.width;
  var cross=$('lvCross');if(cross){cross.setAttribute('x1',PL+i*S.geo.step);cross.setAttribute('x2',PL+i*S.geo.step);cross.style.display='';}
  var p=pts[i],rows='';
  if(S.show.pv)rows+='<div><span>'+esc(T('series_pv'))+'</span><b>'+fmt(p.v[0])+'</b></div>';
  if(S.show.jv)rows+='<div><span>'+esc(T('series_jv'))+'</span><b>'+fmt(p.v[1])+'</b></div>';
  if(S.show.ap)rows+='<div><span>'+esc(T('series_ap'))+'</span><b>'+fmt(p.v[2])+'</b></div>';
  tip.innerHTML='<b>'+esc(p.l)+'</b>'+rows;tip.style.display='block';
  var left=Math.min(Math.max(0,x-tip.offsetWidth/2),Math.max(0,r.width-tip.offsetWidth));tip.style.left=left+'px';
}
function hideTip(){S.hover=null;var tip=$('lvTip'),c=$('lvCross');if(tip)tip.style.display='none';if(c)c.style.display='none';}

function bars(id,entries,o){
  var el=$(id);if(!el)return;
  if(!entries.length){el.innerHTML='<div class="lv-empty">'+esc(T('no_data'))+'</div>';return;}
  var max=entries[0][1]||1;
  el.innerHTML=entries.map(function(e){
    var pct=Math.max(3,Math.round(e[1]/max*100)),sel=o.sel&&o.sel===e[0]?' sel':'';
    return '<button type="button" class="lv-bar'+sel+'" data-k="'+esc(e[0])+'"'+(o.click?'':' disabled')+'><span class="lv-bar-fill" style="width:'+pct+'%"></span><span class="lv-bar-k">'+esc(o.label?o.label(e[0]):e[0])+'</span><span class="lv-bar-v">'+fmt(e[1])+'</span></button>';
  }).join('');
  if(o.click)el.querySelectorAll('.lv-bar').forEach(function(b){b.onclick=function(){o.click(b.getAttribute('data-k'));};});
}
var DEV_COL={desktop:'var(--brand,#3556FF)',mobile:'var(--cyan,#0EA5C4)',tablet:'var(--brand2,#7C3AED)',unknown:'var(--ink3,#8890A4)'};
function donut(){
  var el=$('lvDonut'),tot=0,k;for(k in S.devices)tot+=S.devices[k];
  if(!el)return;
  if(!tot){el.innerHTML='<div class="lv-empty">'+esc(T('no_data'))+'</div>';return;}
  var R=42,C=2*Math.PI*R,off=0,segs='',leg='';
  ['desktop','mobile','tablet','unknown'].forEach(function(d){
    var v=S.devices[d]||0;if(!v)return;var len=v/tot*C;
    segs+='<circle cx="60" cy="60" r="'+R+'" fill="none" stroke-width="14" style="stroke:'+DEV_COL[d]+'" stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 60 60)"/>';off+=len;
    leg+='<div><span class="lv-sw" style="background:'+DEV_COL[d]+'"></span>'+ICONS[d]+'<span>'+esc(T('dev_'+d))+'</span><b>'+Math.round(v/tot*100)+'%</b></div>';
  });
  el.innerHTML='<svg viewBox="0 0 120 120" role="img" aria-label="'+esc(T('devices'))+'">'+segs+'<text x="60" y="64" text-anchor="middle" class="lv-donut-n">'+fmt(tot)+'</text></svg><div class="lv-legend2">'+leg+'</div>';
}

function matches(e){
  var f=S.filter;
  if(f!=='all'&&kindOf(e.y)!==f)return false;
  if(S.fPage&&e.p!==S.fPage)return false;
  if(S.fCountry&&e.c!==S.fCountry)return false;
  return true;
}
function rowHtml(e){
  var k=kindOf(e.y),ic=ICONS[k]||ICONS.other,title,sub;
  if(k==='pv'){title=e.p||'/';sub=T('ev_page_view');}
  else if(k==='jv'||k==='ap'){title=T('job')+' #'+e.j;sub=T(k==='jv'?'ev_job_view':'ev_job_apply_click');}
  else if(k==='se'){title=e.q||'—';sub=T('ev_search')+(e.n!==undefined?' · '+e.n:'');}
  else{title=String(e.y).replace(/_/g,' ');sub=e.p||'';}
  return '<div class="lv-row'+(Date.now()-(e.f||0)<2500?' fresh':'')+'"><span>'+ic+'</span><div><b title="'+esc(title)+'">'+esc(title)+'</b><small>'+esc(sub)+'</small></div><span class="lv-cc">'+esc(e.c)+'</span><span class="lv-dev">'+(ICONS[e.d]||ICONS.unknown)+'</span><span class="lv-src">'+esc(e.s||'direct')+'</span><span class="lv-ago">'+ago(e.t)+'</span></div>';
}
function renderFeed(){
  var el=$('lvFeed');if(!el)return;
  var list=S.feed.filter(matches).slice(0,40);
  el.innerHTML=list.length?list.map(rowHtml).join(''):'<div class="lv-empty">'+esc(T('no_activity'))+'</div>';
  document.querySelectorAll('#lvChips .lv-chip').forEach(function(c){c.setAttribute('aria-pressed',c.getAttribute('data-f')===S.filter?'true':'false');});
  var clr=$('lvClear');if(clr){clr.style.display=(S.fPage||S.fCountry)?'':'none';clr.textContent=T('clear_filter')+': '+(S.fPage||region(S.fCountry));}
}
function renderJobs(){
  var el=$('lvJobs');if(!el)return;
  if(!S.jobs.length){el.innerHTML='<div class="lv-empty">'+esc(T('no_data'))+'</div>';return;}
  el.innerHTML=S.jobs.map(function(j){return '<div class="lv-job"><div style="min-width:0"><b>'+esc(j.title)+'</b><small>'+esc(j.company)+'</small></div><span>'+fmt(j.views)+' '+esc(T('views_short'))+' · '+fmt(j.applies)+' '+esc(T('applies_short'))+'</span></div>';}).join('');
}
function meter(id,val,limit,label){
  var el=$(id);if(!el)return;
  var pct=limit?Math.min(100,val/limit*100):0,cls=pct>=85?'hot':pct>=60?'warn':'';
  el.innerHTML='<div><span>'+esc(label)+'</span><b>'+fmt(Math.round(val))+(limit?' / '+fmt(limit):'')+'</b></div><i><em class="'+cls+'" style="width:'+pct.toFixed(1)+'%"></em></i>';
}
function renderSystem(){
  meter('lvMeterSync',S.sys.syncUsed||0,S.sys.syncBudget||0,T('meter_sync'));
  meter('lvMeterEvents',S.events*4,100000,T('meter_events'));
  meter('lvMeterPolls',S.polls,SESSION_MS/POLL_MS,T('meter_polls'));
  var s=S.sys,el=$('lvSys');if(!el)return;
  el.innerHTML='<div><span>'+esc(T('sys_tracking'))+'</span><b>'+esc(s.enabled===false?T('off'):T('on'))+' · '+esc(String(s.sampleRate||100))+'%</b></div><div><span>'+esc(T('sys_db'))+'</span><b>'+fmt(S.dbMs)+' ms</b></div><div><span>'+esc(T('sys_sync'))+'</span><b>'+(s.lastSync?esc(ago(s.lastSync.t))+' · +'+fmt(s.lastSync.inserted):esc(T('never')))+'</b></div>';
}
function renderAll(){
  renderKpis();drawChart();
  bars('lvPages',topN(S.pages,10),{click:function(k){S.fPage=S.fPage===k?'':k;renderAll();},sel:S.fPage});
  bars('lvCountries',topN(S.countries,10),{label:region,click:function(k){S.fCountry=S.fCountry===k?'':k;renderAll();},sel:S.fCountry});
  bars('lvSources',topN(S.sources,8),{});
  bars('lvTerms',topN(S.terms,8),{});
  bars('lvZero',topN(S.zero,6),{});
  donut();renderJobs();renderFeed();renderSystem();
}

function setStatus(txt,off){setText('lvStatus',txt);var b=$('lvBadge');if(b){b.className='lv-badge'+(off?' off':'');}}
function syncBtn(){
  var b=$('lvToggle');if(!b)return;
  var running=!S.paused&&!S.expired;
  b.innerHTML=(running?ICONS.pause:ICONS.play)+' '+esc(running?T('pause'):T('resume'));
  setStatus(running?T('live_on'):S.expired?T('session_end'):T('paused'),!running);
}
function schedule(ms){clearTimeout(S.timer);if(S.paused||S.expired||document.hidden)return;S.timer=setTimeout(poll,ms);}

function poll(){
  if(S.paused||S.expired||document.hidden||S.inflight)return;
  if(Date.now()-S.started>SESSION_MS){S.expired=true;syncBtn();return;}
  S.inflight=true;
  fetch(BASE+'delta&since='+S.lastId,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}})
  .then(function(r){if(r.status===401){S.expired=true;setStatus(T('signed_out'),true);throw new Error('401');}return r.json();})
  .then(function(d){
    S.inflight=false;S.polls++;
    if(!d||!d.ok)throw new Error('bad');
    S.offset=d.serverNow-Date.now();S.dbMs=d.dbMs||S.dbMs;S.lastId=d.lastId;
    (d.events||[]).forEach(function(e){addEvent(e,true);});
    S.totals.imp+=d.imp||0;S.events+=d.imp||0;
    (d.activity||[]).forEach(function(p){S.active[p[0]]=p[1];});
    renderAll();setStatus(T('live_on'),false);
    schedule(d.more?FAST_MS:POLL_MS);
  })
  .catch(function(e){S.inflight=false;if(S.expired)return;setStatus(T('retrying'),true);schedule(POLL_MS*2);});
}

function loadSeries(days){
  if(S.daily[days])return;
  fetch(BASE+'series&days='+days,{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.json();})
  .then(function(d){S.polls++;if(d&&d.ok){S.daily[days]=d.rows||[];if((S.range==='7d'&&days===7)||(S.range==='30d'&&days===30))drawChart();}})
  .catch(function(){setStatus(T('retrying'),true);});
}
function setRange(r){
  S.range=r;hideTip();
  document.querySelectorAll('#lvRange button').forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-r')===r?'true':'false');});
  if(r==='7d')loadSeries(7);if(r==='30d')loadSeries(30);
  setText('lvChartNote',r==='7d'||r==='30d'?T('note_daily'):T('note_live'));
  drawChart();
}

function init(refresh){
  setStatus(T('loading'),true);
  fetch(BASE+'init'+(refresh?'&refresh=1':''),{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}})
  .then(function(r){if(r.status===401)throw new Error('401');return r.json();})
  .then(function(d){
    if(!d||!d.ok)throw new Error('bad');
    S.polls++;S.started=Date.now();S.expired=false;hydrate(d);renderAll();syncBtn();schedule(POLL_MS);
  })
  .catch(function(){setStatus(T('load_failed'),true);});
}

document.addEventListener('visibilitychange',function(){
  if(document.hidden){clearTimeout(S.timer);return;}
  if(!S.paused&&!S.expired)poll();
});
$('lvToggle').onclick=function(){
  if(S.expired){S.expired=false;S.paused=false;S.started=Date.now();S.polls=0;syncBtn();poll();return;}
  S.paused=!S.paused;syncBtn();if(!S.paused)poll();else clearTimeout(S.timer);
};
$('lvRefresh').onclick=function(){init(true);};
document.querySelectorAll('#lvRange button').forEach(function(b){b.onclick=function(){setRange(b.getAttribute('data-r'));};});
document.querySelectorAll('.lv-leg').forEach(function(b){b.onclick=function(){var k=b.getAttribute('data-s');S.show[k]=!S.show[k];b.setAttribute('aria-pressed',S.show[k]?'true':'false');drawChart();};});
document.querySelectorAll('#lvChips .lv-chip').forEach(function(b){b.onclick=function(){S.filter=b.getAttribute('data-f');renderFeed();};});
$('lvClear').onclick=function(){S.fPage='';S.fCountry='';renderAll();};
var box=$('lvChart');
box.onpointermove=function(ev){if(!S.geo)return;var r=box.getBoundingClientRect(),x=(ev.clientX-r.left)/r.width*CW,i=Math.round((x-PL)/S.geo.step);showTip(Math.max(0,Math.min(S.geo.n-1,i)));};
box.onpointerleave=hideTip;
setInterval(function(){if(!document.hidden&&S.lastId!==undefined&&$('lvFeed')){renderKpis();renderFeed();if(S.range==='1h'||S.range==='24h')drawChart();}},5000);
init(false);
})();
`;
}
