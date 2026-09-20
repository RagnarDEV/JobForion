// src/lib/platform/html-sanitizer.js
// ════════════════════════════════════════════════════════════════
// Dependency-free ALLOW-LIST sanitizer for rich-editor HTML (blog bodies,
// CMS pages). It rebuilds the markup from scratch: only known tags survive,
// only known attributes survive, every URL is scheme-checked, and dangerous
// containers (script/style/iframe/object/embed/form/svg/math/template) are
// removed together with their content.
//
// This is DEFENSE IN DEPTH. The rich editor is admin-only and auto-generated
// posts are escaped at creation, but the CSP allows inline scripts, so a
// single stray <script>/onerror in stored HTML would execute on the main
// origin. Sanitising at render time also protects legacy rows retroactively.
// ════════════════════════════════════════════════════════════════

const DROP_WITH_CONTENT = /<(script|style|iframe|frame|frameset|object|embed|applet|form|svg|math|template|noscript|textarea|select|option|button|audio|video|canvas|title|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DROP_SINGLE = /<\/?(?:script|style|iframe|frame|frameset|object|embed|applet|form|svg|math|template|noscript|base|meta|link|input|button|param|source|track)\b[^>]*>/gi;

const TAGS = new Set([
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);
const VOID = new Set(['br', 'hr', 'img']);

const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function safeUrl(raw, { allowMailto = false } = {}) {
  const url = String(raw || '').replace(/[\u0000-\u001f\u007f\s]+/g, '').trim();
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//')) || url.startsWith('#')) return url;
  if (allowMailto && /^mailto:[^\s<>"']+$/i.test(url)) return url;
  return ''; // javascript:, data:, vbscript:, file:, anything unknown
}

function parseAttrs(rawAttrs) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(rawAttrs))) {
    const name = m[1].toLowerCase();
    if (name.startsWith('on')) continue; // every event handler, always
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function buildAttrs(tag, attrs) {
  const out = [];
  if (tag === 'a') {
    const href = safeUrl(attrs.href, { allowMailto: true });
    if (href) {
      out.push(`href="${escAttr(href)}"`);
      if (/^(https?:)?\/\//i.test(href)) out.push('target="_blank"', 'rel="noopener noreferrer nofollow ugc"');
    }
    if (attrs.title) out.push(`title="${escAttr(attrs.title.slice(0, 200))}"`);
  } else if (tag === 'img') {
    const src = safeUrl(attrs.src);
    if (!src) return null; // an <img> without a safe src is dropped entirely
    out.push(`src="${escAttr(src)}"`, `alt="${escAttr((attrs.alt || '').slice(0, 300))}"`, 'loading="lazy"', 'decoding="async"');
    for (const dim of ['width', 'height']) if (/^\d{1,4}$/.test(attrs[dim] || '')) out.push(`${dim}="${attrs[dim]}"`);
  } else if (tag === 'th' || tag === 'td') {
    for (const k of ['colspan', 'rowspan']) if (/^\d{1,2}$/.test(attrs[k] || '')) out.push(`${k}="${attrs[k]}"`);
  }
  if (attrs.class && /^[\w\s-]{1,120}$/.test(attrs.class)) out.push(`class="${escAttr(attrs.class.trim())}"`);
  const align = /^\s*text-align\s*:\s*(left|right|center|justify)\s*;?\s*$/i.exec(attrs.style || '');
  if (align) out.push(`style="text-align:${align[1].toLowerCase()}"`);
  return out;
}

export function sanitizeRichHtml(input) {
  let html = String(input ?? '');
  if (!html) return '';
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  html = html.replace(DROP_WITH_CONTENT, '').replace(DROP_SINGLE, '');
  return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (full, slash, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    if (!TAGS.has(tag)) return '';
    if (slash) return VOID.has(tag) ? '' : `</${tag}>`;
    const attrs = buildAttrs(tag, parseAttrs(rawAttrs));
    if (attrs === null) return '';
    return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}${VOID.has(tag) ? ' /' : ''}>`;
  }).replace(/<(?![a-zA-Z/])/g, '&lt;'); // stray "<" that is not a tag
}
