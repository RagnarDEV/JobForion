// src/components/rich-editor.js
// Single source of truth for the admin content editor — used by both
// pages/admin/pages-cms.js and pages/admin/blog-cms.js, so any future
// improvement (a new toolbar button, a paste-handling fix) happens once
// instead of drifting between two copies.
//
// Deliberately lightweight rather than pulling in a full WYSIWYG library:
// a `contenteditable` div with a small toolbar (document.execCommand —
// old API, but universally supported and entirely adequate for an
// admin-only internal tool editing a handful of semantic tags), synced
// into a hidden <textarea> that's what actually gets submitted. No
// external script, no extra CSP allowance needed beyond what the admin
// panel already has.
//
// SECURITY NOTE: the HTML this produces is stored and later rendered
// RAW (unescaped) on public pages/blog posts — by design, matching how
// the original hardcoded STATIC_PAGES/BLOG_POSTS content always worked
// (hand-authored trusted HTML). This is safe specifically because only
// an authenticated admin (verifyAdminCookie) can ever reach the form
// that writes it — it is NOT a channel for visitor-submitted content,
// unlike job listings/postings, which ARE escaped. Don't reuse this
// editor for anything a non-admin can submit without adding sanitization.

export function richEditorHtml(fieldName, initialHtml = '') {
  const id = `re_${fieldName}`;
  return `
<div class="rich-editor" id="${id}">
  <div class="re-toolbar">
    <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
    <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
    <button type="button" data-cmd="formatBlock" data-val="H2" title="Heading">H2</button>
    <button type="button" data-cmd="formatBlock" data-val="H3" title="Subheading">H3</button>
    <button type="button" data-cmd="formatBlock" data-val="P" title="Paragraph">¶</button>
    <button type="button" data-cmd="insertUnorderedList" title="Bullet list">• List</button>
    <button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
    <button type="button" data-cmd="createLink" data-prompt="Link URL:" title="Insert link">🔗</button>
    <button type="button" data-cmd="removeFormat" title="Clear formatting">✕ Clear</button>
  </div>
  <div class="re-surface" contenteditable="true">${initialHtml}</div>
  <textarea name="${fieldName}" class="re-hidden-textarea" style="display:none"></textarea>
</div>
<style>
.rich-editor{border:1.5px solid var(--border2);border-radius:10px;overflow:hidden;background:var(--surface)}
.re-toolbar{display:flex;flex-wrap:wrap;gap:4px;padding:8px;border-bottom:1px solid var(--border);background:var(--surface2)}
.re-toolbar button{padding:6px 10px;border-radius:6px;border:1px solid var(--border2);background:var(--surface);color:var(--ink2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
.re-toolbar button:hover{border-color:var(--brand);color:var(--brand)}
.re-surface{min-height:260px;max-height:520px;overflow-y:auto;padding:14px;font-size:14px;line-height:1.7;color:var(--ink);outline:none}
.re-surface h2{font-size:19px;font-weight:700;margin:16px 0 8px}
.re-surface h3{font-size:16px;font-weight:700;margin:14px 0 6px}
.re-surface p{margin-bottom:10px}
.re-surface ul,.re-surface ol{padding-left:22px;margin-bottom:10px}
.re-surface a{color:var(--brand)}
</style>
<script>
(function(){
  var root = document.getElementById(${JSON.stringify(id)});
  var surface = root.querySelector('.re-surface');
  var hidden = root.querySelector('.re-hidden-textarea');
  function sync(){ hidden.value = surface.innerHTML; }
  root.querySelectorAll('.re-toolbar button').forEach(function(btn){
    btn.addEventListener('click', function(){
      surface.focus();
      var cmd = btn.dataset.cmd;
      var val = btn.dataset.val || null;
      if (cmd === 'createLink') {
        var url = prompt(btn.dataset.prompt || 'URL:');
        if (!url) return;
        document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, val);
      }
      sync();
    });
  });
  // Paste as plain text only — avoids dragging in messy inline styles
  // and nested spans from Word/Google Docs, which would otherwise pile
  // up in the stored HTML over repeated edits.
  surface.addEventListener('paste', function(e){
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
    sync();
  });
  surface.addEventListener('input', sync);
  surface.addEventListener('blur', sync);
  var form = root.closest('form');
  if (form) form.addEventListener('submit', sync);
  sync();
})();
</script>`;
}
