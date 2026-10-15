// src/lib/admin-i18n/localize.js
// Admin-only language layer (English ↔ Arabic). The ONLY place that decides whether an
// admin response is localized. The public site never imports this file.
//
// Language is a plain cookie scoped to /admin (so it cannot leak to the public site):
//   adm_lang=ar → Arabic + RTL      anything else / missing → English (the default, untouched)
// English responses pass through with ZERO extra work.

import { makeTranslator, translateHtml } from './translate.js';
import { AR_EXACT, AR_PATTERNS } from './ar/index.js';

export const ADMIN_LANG_COOKIE = 'adm_lang';
const translator = makeTranslator({ exact: AR_EXACT, patterns: AR_PATTERNS });

export function getAdminLang(request) {
  const m = /(?:^|;\s*)adm_lang=(ar|en)(?:;|$)/.exec(request.headers.get('Cookie') || '');
  return m ? m[1] : 'en';
}

// Right-to-left overrides. Layout mostly flips for free (flex/grid follow `dir`); this block
// fixes what is hard-coded left/right, keeps technical inputs left-to-right, and sets an
// Arabic-first font stack.
const RTL_CSS = `
html[dir="rtl"] body{font-family:'Noto Sans Arabic','Inter',-apple-system,'Segoe UI',sans-serif;line-height:1.75}
html[dir="rtl"] h1,html[dir="rtl"] h2,html[dir="rtl"] h3,html[dir="rtl"] .adm-title,html[dir="rtl"] .adm-logo{font-family:'Noto Sans Arabic','Plus Jakarta Sans',sans-serif}
html[dir="rtl"] .adm-sidebar{border-right:0;border-left:1px solid var(--border)}
html[dir="rtl"] .adm-nav-group-title{letter-spacing:0}
html[dir="rtl"] th,html[dir="rtl"] td{text-align:right!important}
html[dir="rtl"] #toast-host{right:auto;left:18px}
html[dir="rtl"] .adm-mobile-drawer{left:auto;right:0;transform:translateX(102%);box-shadow:-16px 0 40px rgba(37,24,92,.2)}
html[dir="rtl"] .adm-mobile-drawer.open{transform:translateX(0)}
html[dir="rtl"] .adm-breadcrumbs span{display:inline-block;transform:scaleX(-1)}
html[dir="rtl"] input[type=url],html[dir="rtl"] input[type=email],html[dir="rtl"] input[type=password],html[dir="rtl"] input[type=number],html[dir="rtl"] input[type=date],html[dir="rtl"] input[name*=url],html[dir="rtl"] input[name*=key],html[dir="rtl"] input[name*=slug],html[dir="rtl"] input[name*=domain],html[dir="rtl"] input[name*=email],html[dir="rtl"] code,html[dir="rtl"] pre{direction:ltr;text-align:left;unicode-bidi:plaintext}
html[dir="rtl"] code,html[dir="rtl"] pre{unicode-bidi:embed}
html[dir="rtl"] select{background-position:left 10px center;padding-left:28px}
html[dir="rtl"] .adm-table-wrap,html[dir="rtl"] .aff-scroll{direction:rtl}
html[dir="rtl"] [style*="text-align:right"]{text-align:left!important}
html[dir="rtl"] .adm-nav-link svg,html[dir="rtl"] .adm-btn svg{flex-shrink:0}
`;
const ARABIC_FONT_LINK = '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet">';

export function localizeHtml(html) {
  let out = translateHtml(html, translator);
  out = out.replace(/<html lang="en"/i, '<html lang="ar" dir="rtl"');
  out = out.replace('</head>', `${ARABIC_FONT_LINK}<style>${RTL_CSS}</style></head>`);
  return out;
}

// flash messages travel in redirect Location headers (?flash=...) — translate them there so
// the toast shows in Arabic after a POST without any client-side dictionary.
export function localizeRedirect(location) {
  try {
    const u = new URL(location, 'https://admin.invalid');
    const flash = u.searchParams.get('flash');
    if (!flash) return location;
    const t = translator.translate(flash);
    if (t === null) return location;
    u.searchParams.set('flash', t);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch (e) { return location; }
}

export async function localizeAdminResponse(response, request) {
  if (!response || getAdminLang(request) !== 'ar') return response;
  const type = response.headers.get('Content-Type') || '';
  const location = response.headers.get('Location');
  if (location && response.status >= 300 && response.status < 400) {
    const next = localizeRedirect(location);
    if (next === location) return response;
    const headers = new Headers(response.headers);
    headers.set('Location', next);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  if (!/text\/html/i.test(type)) return response;
  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.set('Content-Language', 'ar');
  headers.append('Vary', 'Cookie');
  headers.delete('Content-Length');
  headers.delete('ETag');
  return new Response(localizeHtml(body), { status: response.status, statusText: response.statusText, headers });
}
