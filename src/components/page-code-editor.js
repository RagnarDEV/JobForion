// Admin editor and public renderer for optional page code blocks.
// Custom HTML/CSS/JS is deliberately rendered in an opaque-origin sandboxed
// iframe. The code can interact with its own document, but it cannot access
// the parent page, cookies, admin DOM, or same-origin APIs.

import { escapeHtml } from '../lib/entities.js';

export const PAGE_CODE_LIMITS = Object.freeze({
  html: 120000,
  css: 60000,
  js: 60000,
});

function bounded(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function escapeEmbeddedScript(value) {
  return String(value || '').split('</script').join('<\\u002fscript');
}

function safeScriptString(value) {
  return JSON.stringify(String(value || '')).replace(/</g, '\\u003c');
}

const FRAME_RESIZE_CODE = `(function(){function report(){var d=document.documentElement,b=document.body,h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0,320);parent.postMessage({__jobforionPageCode:true,height:h},'*')}window.addEventListener('load',function(){report();setTimeout(report,80)});new MutationObserver(report).observe(document.documentElement,{subtree:true,childList:true,attributes:true});if(window.ResizeObserver)new ResizeObserver(report).observe(document.documentElement);report();})();`;

function codeDocument(html, css, js) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${bounded(css, PAGE_CODE_LIMITS.css)}</style></head><body>${bounded(html, PAGE_CODE_LIMITS.html)}<script>${escapeEmbeddedScript(bounded(js, PAGE_CODE_LIMITS.js))}</script><script>${FRAME_RESIZE_CODE}</script></body></html>`;
}

export function pageCodeFrameHtml({ html = '', css = '', js = '', id = 'page_code_frame', title = 'Custom page content' } = {}) {
  const frameId = String(id || 'page_code_frame').replace(/[^a-z0-9_-]/gi, '_');
  const documentHtml = codeDocument(html, css, js);
  return `<iframe id="${escapeHtml(frameId)}" class="page-code-frame" title="${escapeHtml(title)}" sandbox="allow-scripts allow-forms" style="display:block;width:100%;height:360px;min-height:320px;border:0;background:#fff"></iframe><script>(function(){var f=document.getElementById(${JSON.stringify(frameId)});if(!f)return;function resize(e){if(e.source!==f.contentWindow||!e.data||e.data.__jobforionPageCode!==true)return;var h=Number(e.data.height);if(Number.isFinite(h))f.style.height=Math.min(12000,Math.max(320,Math.ceil(h)))+'px';}window.addEventListener('message',resize);try{f.srcdoc=${safeScriptString(documentHtml)};}catch(e){}})();</script>`;
}

export function pageCodeEditorHtml({ html = '', css = '', js = '' } = {}) {
  const htmlValue = escapeHtml(bounded(html, PAGE_CODE_LIMITS.html));
  const cssValue = escapeHtml(bounded(css, PAGE_CODE_LIMITS.css));
  const jsValue = escapeHtml(bounded(js, PAGE_CODE_LIMITS.js));
  const frameId = 'page_code_editor_preview';
  return `<section class="page-code-editor" aria-label="Custom HTML CSS and JavaScript">
    <div class="page-code-editor-head"><div><strong>Custom HTML / CSS / JavaScript</strong><span>Optional code is rendered in an isolated preview and public iframe.</span></div><button type="button" class="adm-btn-sm" id="pageCodeRenderBtn">Render preview</button></div>
    <div class="page-code-grid">
      <label><span>HTML</span><textarea name="custom_html" id="pageCustomHtml" class="adm-code-input" maxlength="${PAGE_CODE_LIMITS.html}" spellcheck="false" placeholder="&lt;section class=&quot;promo&quot;&gt;...&lt;/section&gt;">${htmlValue}</textarea></label>
      <label><span>CSS</span><textarea name="custom_css" id="pageCustomCss" class="adm-code-input" maxlength="${PAGE_CODE_LIMITS.css}" spellcheck="false" placeholder=".promo { padding: 24px; }">${cssValue}</textarea></label>
      <label><span>JavaScript</span><textarea name="custom_js" id="pageCustomJs" class="adm-code-input" maxlength="${PAGE_CODE_LIMITS.js}" spellcheck="false" placeholder="document.querySelector('.promo')?.addEventListener('click', ...)">${jsValue}</textarea></label>
    </div>
    <div class="page-code-help">JavaScript runs only inside the isolated preview/content frame. It cannot access JobForion cookies, the admin panel, or the parent page. Do not put secrets in public page code.</div>
    <div class="page-code-preview-label">Live preview</div>
    <iframe id="${frameId}" class="page-code-frame page-code-editor-frame" title="Custom code live preview" sandbox="allow-scripts allow-forms"></iframe>
  </section>
  <style>
    .page-code-editor{border:1px solid var(--border);border-radius:12px;background:var(--surface2);padding:14px}.page-code-editor-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.page-code-editor-head strong{display:block;color:var(--ink);font-size:13px}.page-code-editor-head span{display:block;margin-top:3px;color:var(--ink3);font-size:10.5px}.page-code-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.page-code-grid label{min-width:0}.page-code-grid label>span,.page-code-preview-label{display:block;margin-bottom:5px;color:var(--ink3);font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}.adm-code-input{display:block;width:100%;min-height:180px;box-sizing:border-box;resize:vertical;padding:10px;border:1px solid var(--border2);border-radius:8px;background:#111827;color:#e5e7eb;font:500 11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;outline:none}.adm-code-input:focus{border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-soft)}.page-code-help{margin:10px 0 12px;color:var(--ink3);font-size:10.5px;line-height:1.55}.page-code-frame{min-height:240px;border:1px solid var(--border);border-radius:8px;background:#fff}.page-code-editor-frame{height:360px;min-height:320px}.page-code-preview-label{margin-top:4px}@media(max-width:760px){.page-code-grid{grid-template-columns:1fr}.page-code-editor-head{align-items:flex-start;flex-direction:column}}
  </style>
  <script>(function(){var h=document.getElementById('pageCustomHtml'),c=document.getElementById('pageCustomCss'),j=document.getElementById('pageCustomJs'),f=document.getElementById(${JSON.stringify(frameId)}),b=document.getElementById('pageCodeRenderBtn');if(!h||!c||!j||!f)return;function render(){var boot='<script>'+${JSON.stringify(FRAME_RESIZE_CODE)}+'<'+'/script>';var doc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+c.value+'</style></head><body>'+h.value+'<script>'+j.value.split('<'+'/script').join('<\\u002fscript')+'<\\/script>'+boot+'</body></html>';try{f.srcdoc=doc;}catch(e){}}[h,c,j].forEach(function(x){x.addEventListener('input',render);});if(b)b.addEventListener('click',render);var form=f.closest('form');if(form)form.addEventListener('submit',function(){render();});render();})();</script>`;
}
