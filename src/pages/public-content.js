// Public informational/content pages for Frontend V2.
// CMS pages remain the source of truth when an admin-managed page exists;
// built-in informational views only describe capabilities already present.

import { baseLayout } from '../layout/base-layout.js';
import { publicPageHeader, publicCard, PUBLIC_PAGE_CSS } from '../components/public-page.js';
import { buildBreadcrumb } from '../lib/breadcrumbs.js';
import { escapeHtml } from '../lib/entities.js';
import { getSettings } from '../lib/settings.js';
import { getCategories } from '../lib/categories.js';
import { getFooterPages, getMenuPages, getPageBySlug } from '../lib/pages-cms.js';
import { getNavButtons } from '../lib/nav-buttons.js';
import { getPosts } from '../lib/blog-cms.js';
import { renderStaticPage } from './static-pages.js';
import { iconBriefcase, iconBuilding, iconBookmark, iconFileText, iconGlobe } from '../assets/icons.js';

async function pageContext(env) {
  const [settings, cats, footerPages, menuPages, navButtons] = await Promise.all([
    getSettings(env), getCategories(env), getFooterPages(env), getMenuPages(env), getNavButtons(env),
  ]);
  const categoryBundle = { order: cats.map(c => c.key), map: Object.fromEntries(cats.map(c => [c.key, { label: c.label, emoji: c.emoji, color: c.color }])) };
  return { settings, categoryBundle, footerPages, menuPages, navButtons };
}

function emailValue(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export async function renderResourcesHub(base, env, user = null) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await pageContext(env);
  const posts = await getPosts(env);
  const articleCards = posts.slice(0, 6).map(post => publicCard({
    href: `/blog/${encodeURIComponent(post.slug || post.id)}`,
    icon: iconFileText({ size: 18 }),
    title: post.title,
    description: post.excerpt || 'Practical guidance for a focused job search.',
    meta: post.category || 'Career article',
  })).join('');
  const directoryCards = [
    publicCard({ href: '/categories', icon: iconBriefcase({ size: 18 }), title: 'Job categories', description: 'Browse live roles grouped by discipline.', meta: 'Explore categories' }),
    publicCard({ href: '/skills', icon: iconBookmark({ size: 18 }), title: 'Skills directory', description: 'Find opportunities connected to real job skills.', meta: 'Explore skills' }),
    publicCard({ href: '/countries', icon: iconGlobe({ size: 18 }), title: 'Countries & locations', description: 'Discover where active listings are hiring.', meta: 'Explore locations' }),
    publicCard({ href: '/remote-jobs', icon: iconBuilding({ size: 18 }), title: 'Remote jobs', description: 'Open the dedicated fully remote landing page.', meta: 'Browse remote work' }),
  ].join('');
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: 'Resources', path: '/resources' }]);
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: 'RESOURCE HUB', title: 'Resources to help you build your career', description: 'Use the JobForion directories and published articles to make your remote job search clearer and more deliberate.' })}<section class="public-section" aria-labelledby="resource-directories"><div class="public-section-heading"><div><h2 id="resource-directories">Explore JobForion</h2><p>Start with the public data and tools that match your next step.</p></div></div><div class="public-card-grid resources-grid">${directoryCards}</div></section>${articleCards ? `<section class="public-section" aria-labelledby="resource-articles"><div class="public-section-heading"><div><h2 id="resource-articles">Latest career advice</h2><p>Published articles from the existing JobForion blog.</p></div><a href="/blog">View all articles</a></div><div class="public-card-grid resources-grid">${articleCards}</div></section>` : `<section class="public-section"><div class="empty"><div class="e-icon">📭</div><h3>No articles yet</h3><p>New resources will appear here when they are published in the Blog CMS.</p></div></section>`}<div class="public-callout"><div><h2>Looking for a role?</h2><p>Search the live directory and refine results by location, salary, skill, or remote type.</p></div><a class="public-primary-link" href="/jobs">Browse all jobs</a></div></div>`;
  const schema = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${settings.site_name} Resources`, url: `${base}/resources` })}</script>`;
  return baseLayout(`Resources — ${settings.site_name}`, 'Career resources, job-search directories, and published guidance for remote work.', `${base}/resources`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

export async function renderInformationalPage(slug, base, env, user = null) {
  const existing = await getPageBySlug(env, slug);
  if (existing) return renderStaticPage(slug, base, env, user);
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await pageContext(env);
  const definitions = {
    about: {
      eyebrow: 'ABOUT JOBFORION', title: 'A clearer way to discover remote work',
      description: 'JobForion brings live remote opportunities, company profiles, and practical discovery tools into one focused experience.',
      sections: `<section class="public-prose"><h2>What JobForion does</h2><p>JobForion is a remote job discovery platform. It aggregates active listings from connected providers and direct employer submissions, then organizes them into searchable job, company, category, skill, and location experiences.</p><h2>Who it serves</h2><p>Job seekers can search current roles, explore companies, save jobs, create alerts, and track applications through the account experience. Employers can create supported company profiles and submit opportunities through the existing employer flow.</p><h2>Our remote-work focus</h2><p>The platform is designed to reduce friction in remote-first discovery: clearer metadata, useful filters, direct application links, and public pages that are easy to browse and share.</p></section>`,
    },
    'how-it-works': {
      eyebrow: 'HOW IT WORKS', title: 'A simple path from search to opportunity',
      description: 'Use the capabilities already available in JobForion to move from discovery to a more organized application process.',
      sections: `<section class="public-section"><div class="public-section-heading"><div><h2>For job seekers</h2><p>Everything here maps to an existing public or account route.</p></div></div><div class="public-step-grid"><article class="public-step"><span class="public-step-number">1</span><h3>Search</h3><p>Use the live Jobs directory and its filters.</p></article><article class="public-step"><span class="public-step-number">2</span><h3>Discover</h3><p>Explore companies, categories, skills, and locations.</p></article><article class="public-step"><span class="public-step-number">3</span><h3>Save</h3><p>Keep interesting roles in your authenticated Saved Jobs list.</p></article><article class="public-step"><span class="public-step-number">4</span><h3>Apply</h3><p>Follow the employer’s real external application link.</p></article><article class="public-step"><span class="public-step-number">5</span><h3>Track</h3><p>Review tracked applications in your account when recorded.</p></article></div></section><section class="public-section"><div class="public-section-heading"><div><h2>For employers</h2><p>Use the supported employer workflow.</p></div></div><div class="public-step-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))"><article class="public-step"><span class="public-step-number">1</span><h3>Create a profile</h3><p>Set up a supported public company profile.</p></article><article class="public-step"><span class="public-step-number">2</span><h3>Post jobs</h3><p>Submit an opportunity through the existing Post a Job flow.</p></article><article class="public-step"><span class="public-step-number">3</span><h3>Reach candidates</h3><p>Appear in public company and job discovery experiences.</p></article><article class="public-step"><span class="public-step-number">4</span><h3>Manage opportunities</h3><p>Use the existing employer dashboard where available.</p></article></div></section>`,
    },
    contact: {
      eyebrow: 'CONTACT', title: 'Let’s stay connected',
      description: 'Use the configured JobForion contact channel for questions, feedback, or partnership enquiries.',
      sections: `<section class="public-card-grid"><article class="public-card"><span class="public-card-icon" aria-hidden="true">${iconGlobe({ size: 18 })}</span><h2>Email JobForion</h2><p>Reach the configured contact address for general questions and platform feedback.</p><div class="public-card-meta"><small>Configured contact</small></div></article><article class="public-card"><span class="public-card-icon" aria-hidden="true">${iconBriefcase({ size: 18 })}</span><h2>Post a job</h2><p>Employers can use the existing posting flow without a separate contact form.</p><div class="public-card-meta"><small>Employer flow</small></div></article></section>`,
    },
  };
  const definition = definitions[slug];
  if (!definition) return null;
  const contact = slug === 'contact' ? emailValue(settings.contact_email) : '';
  const contactAction = contact ? `<a class="public-primary-link" href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a>` : '';
  const employerAction = slug === 'contact' ? `<button class="public-primary-link" type="button" onclick="openPostJobModal()">Post a job</button>` : '';
  const { html: bc, jsonLd: bcSchema } = buildBreadcrumb(base, [{ name: definition.title, path: `/${slug}` }]);
  const content = `<div class="page public-page">${PUBLIC_PAGE_CSS}${publicPageHeader({ breadcrumb: bc, eyebrow: definition.eyebrow, title: definition.title, description: definition.description, actions: slug === 'contact' ? `${contactAction}${employerAction}` : '' })}${definition.sections}${slug !== 'contact' ? `<div class="public-callout"><div><h2>Continue exploring</h2><p>Use the live directories and resources to take the next step.</p></div><a class="public-primary-link" href="/jobs">Browse jobs</a></div>` : ''}</div>`;
  const schema = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'AboutPage', name: definition.title, url: `${base}/${slug}` })}</script>`;
  return baseLayout(`${definition.title} — ${settings.site_name}`, definition.description, `${base}/${slug}`, '', content, schema + bcSchema, 'index, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}

export async function renderNotFoundPage(base, env, user = null) {
  const { settings, categoryBundle, footerPages, menuPages, navButtons } = await pageContext(env);
  const { html: bc } = buildBreadcrumb(base, []);
  const content = `<div class="page public-page not-found-page">${PUBLIC_PAGE_CSS}${bc}<div class="not-found-code">404</div><div class="public-page-header"><div class="public-page-header-copy"><p class="public-eyebrow">PAGE NOT FOUND</p><h1>We couldn’t find that page</h1><p>The address may be outdated or the content may have moved. Use one of the paths below to continue.</p></div></div><div class="public-card-grid"><a class="public-card" href="/"><span class="public-card-icon">⌂</span><h2>Go home</h2><p>Return to the JobForion homepage.</p><span class="public-card-meta"><small>Home</small></span></a><a class="public-card" href="/jobs"><span class="public-card-icon">${iconBriefcase({ size: 18 })}</span><h2>Browse jobs</h2><p>Search current roles from the live directory.</p><span class="public-card-meta"><small>Jobs</small></span></a><a class="public-card" href="/companies"><span class="public-card-icon">${iconBuilding({ size: 18 })}</span><h2>Browse companies</h2><p>Explore public company profiles.</p><span class="public-card-meta"><small>Companies</small></span></a></div></div>`;
  return baseLayout(`Page not found — ${settings.site_name}`, 'The requested JobForion page could not be found.', `${base}/404`, '', content, '', 'noindex, follow', settings, categoryBundle, footerPages, menuPages, navButtons, user);
}
