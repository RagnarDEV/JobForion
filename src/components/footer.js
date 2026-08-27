import { escapeHtml } from '../lib/entities.js';
import { SETTINGS_DEFAULTS } from '../lib/settings.js';

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
  const socialButton = (url, label, svg) => url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${label}">${svg}</a>`
    : `<button type="button" class="sf-social-placeholder" aria-label="${label} (coming soon)" title="Coming soon" disabled>${svg}</button>`;
  const socialMarkup = [
    socialButton(linkedin, 'LinkedIn', '<svg viewBox="0 0 24 24"><path d="M20.4 20.4h-3.5v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.2zM5.3 7.4a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM7 20.4H3.6V9H7v11.4z"/></svg>'),
    socialButton(twitter, 'X', '<svg viewBox="0 0 24 24"><path d="M18.9 3H22l-7.2 8.3L23 21h-6.9l-5.4-6.6L4.6 21H1.4l7.7-8.9L1 3h7l4.9 6.1L18.9 3zm-1.2 16h1.7L7.4 4.9H5.6L17.7 19z"/></svg>'),
    socialButton(facebook, 'Facebook', '<svg viewBox="0 0 24 24"><path d="M13.5 21v-7.7h2.6l.4-3h-3v-1.9c0-.9.2-1.5 1.5-1.5H16.6V3.9C16.3 3.9 15.3 3.8 14.2 3.8c-2.4 0-4 1.5-4 4.1v2.3H7.6v3h2.6V21h3.3z"/></svg>'),
  ].join('');
  const pages = footerPages || DEFAULT_FOOTER_PAGES;
  return `
<footer class="site-footer">
  <div class="sf-inner">
    <div class="sf-top">
      <div class="sf-intro">
        <div class="sf-brand"><img src="/favicon.svg" alt="${siteName}">${siteName}</div>
        <p class="sf-desc">The global platform for discovering verified remote jobs and hiring remote talent — with clarity, flexibility, and momentum.</p>
        <div class="sf-social">${socialMarkup}</div>
      </div>
      <div class="sf-col"><div class="sf-col-title">For job seekers</div><a href="/">Browse jobs</a><a href="/companies">Companies hiring</a><a href="/categories">Job categories</a><a href="/skills">Browse by skill</a><a href="/countries">Browse by country</a></div>
      <div class="sf-col"><div class="sf-col-title">For employers</div><button class="footer-action" type="button" onclick="openPostJobModal()">Post a job</button><a href="/company/dashboard">Employer dashboard</a><a href="/company/create">Create company profile</a><a href="/resources">Employer resources</a></div>
      <div class="sf-col"><div class="sf-col-title">Resources</div><a href="/resources">Resource hub</a><a href="/blog">Career blog</a><a href="/feed.rss">RSS feed</a><a href="/sitemap.xml">Sitemap</a><a href="/privacy">Privacy &amp; trust</a></div>
      <div class="sf-col"><div class="sf-col-title">Company</div>${pages.map(p => `<a href="/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a>`).join('') || '<span style="color:var(--navy-ink2);font-size:11px">No pages yet</span>'}</div>
    </div>
    <div class="sf-bottom"><span>© ${year} ${siteName}. All rights reserved.</span><span>Built for the remote-first workforce.</span></div>
  </div>
</footer>`;
}
