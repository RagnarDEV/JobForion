// src/lib/metadata.js
import { buildMeta } from './seo.js';

export const ICON_LINKS = `
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">`;

const GOOGLE_SITE_VERIFICATION = "7Q0EJk3kQKNLNzIhyzH4k5CsuHsQEa-U0Pwp_w_b0n0";

// Assembles the full <head> inner content for a page: charset, viewport,
// verification tag, meta block (from seo.js), icons, fonts, RSS link,
// and any extra <script type="application/ld+json"> / <style> the
// caller passes in (extraHead).
export function buildHead({
  title, description, canonical, base, ogImage, robots, type, keywords,
  extraHead = '', preloadFonts = true,
} = {}) {
  const meta = buildMeta({ title, description, canonical, base, ogImage, robots, type, keywords });
  return `
<meta charset="UTF-8">
<meta name="google-site-verification" content="${GOOGLE_SITE_VERIFICATION}"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${meta}
${ICON_LINKS}
<link rel="alternate" type="application/rss+xml" title="JobForion Jobs Feed" href="${base}/feed.rss">
${preloadFonts ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">` : ''}
${extraHead}`;
}
