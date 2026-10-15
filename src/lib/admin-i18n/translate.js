// src/lib/admin-i18n/translate.js
// ════════════════════════════════════════════════════════════════
// Admin-only string translation (English → Arabic). Used ONLY for /admin
// responses — the public site never touches this module.
//
// HOW IT WORKS: admin pages are server-rendered English HTML. Rather than
// threading a t() call through ~4,000 lines of templates (and re-doing that for
// every future page), the finished HTML is localized in one place
// (lib/admin-i18n/localize.js). This module walks the HTML token by token and
// translates ONLY:
//   • text nodes whose whole trimmed text matches a dictionary key / pattern,
//   • placeholder / title / aria-label / alt attributes,
//   • confirm()/alert()/jnToast() string literals.
// Anything else — job titles, company names, emails, URLs, code, scripts' logic —
// can only change if it is byte-for-byte equal to a dictionary key, so real data
// is never rewritten. Unknown strings simply stay English (graceful fallback).
// New admin text: add one line to the dictionary in lib/admin-i18n/ar/*.js.
// ════════════════════════════════════════════════════════════════

const ENTITY_DECODE = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': '\u00a0', '&middot;': '·', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&rarr;': '→', '&larr;': '←' };
export function decodeEntities(s) {
  return String(s).replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp|middot|mdash|ndash|hellip|rarr|larr);/g, (m) => ENTITY_DECODE[m] || m);
}
export function encodeText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function encodeAttr(s) { return encodeText(s).replace(/"/g, '&quot;'); }

const norm = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();

// Compile 'Page {a} of {b}' into a matcher. A captured value is substituted verbatim
// into the Arabic template (see the placeholder kinds below).
export function compilePatterns(entries) {
  return Object.entries(entries).map(([en, ar]) => {
    const names = [];
    // {a}   → a token that contains a digit (numbers, "55,000", "0%", "$12") — so a pattern such as
    //          '{a}d' can never swallow ordinary words that merely end in "d";
    // {~a}  → any text (used where the dynamic part is a name, e.g. 'Reset {~a} to the default').
    const source = en.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(~?)(\w+)\}/g, (_, any, n) => { names.push(n); return any ? '(.+?)' : '(\\S*\\d\\S*)'; });
    return { re: new RegExp(`^${source}$`), names, ar };
  });
}

export function makeTranslator({ exact = {}, patterns = {} } = {}) {
  const compiled = compilePatterns(patterns);
  const lookup = new Map(Object.entries(exact).map(([k, v]) => [norm(k), v]));
  function translate(text) {
    const key = norm(text);
    if (!key) return null;
    const hit = lookup.get(key);
    if (hit !== undefined) return hit;
    for (const p of compiled) {
      const m = p.re.exec(key);
      if (m) return p.ar.replace(/\{(\w+)\}/g, (_, n) => { const i = p.names.indexOf(n); return i >= 0 ? m[i + 1] : ''; });
    }
    return null;
  }
  return { translate, has: (t) => translate(t) !== null };
}

// One alternation: comments | opaque blocks | tags | text.
// Tags may contain '>' inside quoted attribute values (onchange="a=>b"), so quotes are consumed whole.
const TAG_BODY = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const TOKEN_RE = new RegExp(`<!--[\\s\\S]*?-->|<(script|style|textarea|pre|code|svg)\\b${TAG_BODY}>[\\s\\S]*?<\\/\\1\\s*>|<${TAG_BODY}>|[^<]+`, 'gi');
const ATTR_RE = /(\s)(placeholder|title|aria-label|alt)=("([^"]*)"|'([^']*)')/gi;
const JS_STRING_CALL_RE = /\b(confirm|alert|jnToast)\(\s*(['"])((?:(?!\2)[^\\\n])*)\2/g;

function translateJsCalls(source, tr, htmlEscaped) {
  return source.replace(JS_STRING_CALL_RE, (full, fn, quote, body) => {
    const plain = htmlEscaped ? decodeEntities(body) : body;
    const out = tr.translate(plain);
    if (out === null) return full;
    let safe = out.replace(/\\/g, '\\\\').split(quote).join(`\\${quote}`);
    if (htmlEscaped) safe = encodeAttr(safe);
    return `${fn}(${quote}${safe}${quote}`;
  });
}

function translateTag(tag, tr) {
  let out = tag.replace(ATTR_RE, (full, sp, name, raw, dq, sq) => {
    const value = dq !== undefined ? dq : sq;
    const t = tr.translate(value);
    return t === null ? full : `${sp}${name}="${encodeAttr(t)}"`;
  });
  if (/\son(?:click|submit|change)=/i.test(out)) out = translateJsCalls(out, tr, true);
  return out;
}

export function translateHtml(html, tr) {
  return String(html).replace(TOKEN_RE, (token, opaque) => {
    if (token.startsWith('<!--')) return token;
    if (opaque) {
      // scripts: translate only the user-visible string literals passed to confirm/alert/toast
      return opaque.toLowerCase() === 'script' ? translateJsCalls(token, tr, false) : token;
    }
    if (token.startsWith('<')) return translateTag(token, tr);
    const t = tr.translate(token);
    if (t === null) return token;
    const lead = /^\s*/.exec(token)[0];
    const trail = /\s*$/.exec(token)[0];
    return `${lead}${encodeText(t)}${trail}`;
  });
}

// Developer tool (scripts/harvest-admin-strings.mjs): every translatable string in a page.
export function extractStrings(html) {
  const found = new Set();
  const add = (s) => { const k = norm(s); if (k && /[A-Za-z]{2}/.test(k)) found.add(k); };
  String(html).replace(TOKEN_RE, (token, opaque) => {
    if (token.startsWith('<!--')) return token;
    if (opaque) {
      if (opaque.toLowerCase() === 'script') token.replace(JS_STRING_CALL_RE, (m, fn, q, body) => { add(body); return m; });
      return token;
    }
    if (token.startsWith('<')) {
      token.replace(ATTR_RE, (m, sp, n, raw, dq, sq) => { add(dq !== undefined ? dq : sq); return m; });
      if (/\son(?:click|submit|change)=/i.test(token)) token.replace(JS_STRING_CALL_RE, (m, fn, q, body) => { add(decodeEntities(body)); return m; });
      return token;
    }
    add(token);
    return token;
  });
  return found;
}
