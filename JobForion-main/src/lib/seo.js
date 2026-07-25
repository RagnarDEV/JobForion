// src/lib/seo.js
// ════════════════════════════════════════════════════════════════
// Builds the <meta> block for a page. Every call site MUST pass an
// explicit, page-specific title + description — this module does
// not invent generic fallbacks, which is what causes duplicate
// titles/descriptions across a site. If a caller forgets one, we
// throw in dev-shaped errors are avoided (Workers has no console
// visibility by default) — instead we degrade to a clearly-marked
// placeholder so a missing tag is obvious in `view-source`, rather
// than silently duplicating the homepage's tags.
// ════════════════════════════════════════════════════════════════

const SITE_NAME = "JobForion";
const DEFAULT_OG_IMAGE_PATH = "/icon-512.png";

function safe(str, fallbackFlag) {
  const s = (str || '').toString().trim();
  return s || fallbackFlag;
}

export function buildMeta({
  title,
  description,
  canonical,
  base,
  ogImage,
  robots = "index, follow",
  type = "website",
  keywords,
  author = "JobForion",
  themeColor = "#3556FF",
} = {}) {
  const safeTitle = safe(title, "[MISSING TITLE — fix call site]");
  const safeDesc = safe(description, "[MISSING DESCRIPTION — fix call site]");
  const image = ogImage || `${base}${DEFAULT_OG_IMAGE_PATH}`;

  return `
<title>${safeTitle}</title>
<meta name="description" content="${safeDesc}">
<meta name="robots" content="${robots}">
<meta name="author" content="${author}">
<meta name="theme-color" content="${themeColor}">
${keywords ? `<meta name="keywords" content="${keywords}">` : ''}
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<meta name="twitter:image" content="${image}">`;
}

// Truncate to a search-engine-friendly length without cutting words mid-way.
export function truncateDescription(text, maxLen = 158) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}
