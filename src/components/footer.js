// src/components/footer.js

import { escapeHtml } from '../lib/entities.js';
import { SETTINGS_DEFAULTS } from '../lib/settings.js';

// `settings` is optional — omit it and every field falls back to the
// exact hardcoded value this file always had (see SETTINGS_DEFAULTS in
// lib/settings.js), so existing callers are unaffected. Social links are
// only rendered as real hrefs once an admin fills them in at
// /admin/settings; until then they render as '#' exactly as before,
// rather than showing a broken/empty link.
// `footerPages` (optional, new) is the array from lib/pages-cms.js's
// getFooterPages() — {slug, title} rows for every published page with
// show_in_footer=1 (Privacy/Terms/Disclaimer come from there now too,
// since they're just seeded rows in the same `pages` table — see
// db/schema.js). Falls back to the original hardcoded 3 links so any
// caller not yet passing it renders exactly as before.
const DEFAULT_FOOTER_PAGES = [
  { slug: 'privacy', title: 'Privacy policy' },
  { slug: 'terms', title: 'Terms of service' },
  { slug: 'disclaimer', title: 'Disclaimer' },
];

export function footerHtml(base, settings, footerPages) {
  const siteName = escapeHtml(settings?.site_name || SETTINGS_DEFAULTS.site_name);
  const twitter = settings?.social_twitter || '';
  const linkedin = settings?.social_linkedin || '';
  const facebook = settings?.social_facebook || '';
  const year = new Date().getFullYear();
  const pages = footerPages || DEFAULT_FOOTER_PAGES;
  return `
<footer class="site-footer">
  <div class="sf-inner">
    <div class="sf-top">
      <div>
        <div class="sf-brand"><img src="/favicon.svg" alt="${siteName}">${siteName}</div>
        <p class="sf-desc">The curated platform for finding verified remote jobs and hiring remote talent — in development, design, marketing, data and more.</p>
        <div class="sf-social">
          <a href="${linkedin ? escapeHtml(linkedin) : '#'}" aria-label="LinkedIn" ${linkedin ? 'target="_blank" rel="noopener noreferrer"' : ''}><svg viewBox="0 0 24 24"><path d="M20.4 20.4h-3.5v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.2zM5.3 7.4a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM7 20.4H3.6V9H7v11.4z"/></svg></a>
          <a href="${twitter ? escapeHtml(twitter) : '#'}" aria-label="X" ${twitter ? 'target="_blank" rel="noopener noreferrer"' : ''}><svg viewBox="0 0 24 24"><path d="M18.9 3H22l-7.2 8.3L23 21h-6.9l-5.4-6.6L4.6 21H1.4l7.7-8.9L1 3h7l4.9 6.1L18.9 3zm-1.2 16h1.7L7.4 4.9H5.6L17.7 19z"/></svg></a>
          <a href="${facebook ? escapeHtml(facebook) : '#'}" aria-label="Facebook" ${facebook ? 'target="_blank" rel="noopener noreferrer"' : ''}><svg viewBox="0 0 24 24"><path d="M13.5 21v-7.7h2.6l.4-3h-3v-1.9c0-.9.2-1.5 1.5-1.5H16.6V3.9C16.3 3.9 15.3 3.8 14.2 3.8c-2.4 0-4 1.5-4 4.1v2.3H7.6v3h2.6V21h3.3z"/></svg></a>
        </div>
      </div>
      <div class="sf-col">
        <div class="sf-col-title">For Job Seekers</div>
        <a href="/">Browse remote jobs</a>
        <a href="/companies">Companies hiring</a>
        <a href="/categories">Browse by category</a>
        <a href="/skills">Browse by skill</a>
        <a href="/countries">Browse by country</a>
        <a href="#" onclick="openPostJobModal();return false;">Post a job</a>
      </div>
      <div class="sf-col">
        <div class="sf-col-title">Resources</div>
        <a href="/blog">Career blog</a>
        <a href="/feed.rss">RSS feed</a>
        <a href="/sitemap.xml">Sitemap</a>
      </div>
      <div class="sf-col">
        <div class="sf-col-title">Company</div>
        ${pages.map(p => `<a href="/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a>`).join('') || '<span style="color:var(--navy-ink2);font-size:13px">No pages yet</span>'}
      </div>
    </div>
    <div class="sf-bottom">
      <span>© ${year} ${siteName}. All rights reserved.</span>
      <span>Made for the remote-first workforce 🌍</span>
    </div>
  </div>
</footer>`;
}
