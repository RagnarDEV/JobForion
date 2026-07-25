// src/pages/home.js
// Home page — clean hero, search, and filter dropdowns (no stats, no counters)

import { renderBaseLayout } from '../layout/base-layout.js';
import { renderNav } from '../components/nav.js';
import { renderFooter } from '../components/footer.js';
import { SHARED_CSS } from '../styles/shared-css.js';
import {
  Search, Folder, Building2, Globe, Award,
  Clock, ChevronDown
} from '../assets/icons.js';

// ===== Filter Data =====
const CATEGORIES = [
  { id: 'development', label: 'Development' },
  { id: 'design', label: 'Design' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'finance', label: 'Finance' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'hr', label: 'HR' },
  { id: 'writing', label: 'Writing' },
  { id: 'customer-support', label: 'Customer Support' },
  { id: 'sales', label: 'Sales' },
];

const COMPANIES = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft', label: 'Microsoft' },
  { id: 'amazon', label: 'Amazon' },
  { id: 'apple', label: 'Apple' },
  { id: 'meta', label: 'Meta' },
  { id: 'shopify', label: 'Shopify' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'stripe', label: 'Stripe' },
];

const COUNTRIES = [
  { id: 'us', label: 'United States' },
  { id: 'ca', label: 'Canada' },
  { id: 'de', label: 'Germany' },
  { id: 'uk', label: 'United Kingdom' },
  { id: 'au', label: 'Australia' },
  { id: 'fr', label: 'France' },
  { id: 'jp', label: 'Japan' },
  { id: 'in', label: 'India' },
  { id: 'remote', label: 'Remote Worldwide' },
];

const EXPERIENCE_LEVELS = [
  { id: 'internship', label: 'Internship' },
  { id: 'entry', label: 'Entry Level' },
  { id: 'junior', label: 'Junior' },
  { id: 'mid', label: 'Mid-Level' },
  { id: 'senior', label: 'Senior' },
  { id: 'lead', label: 'Lead' },
  { id: 'manager', label: 'Manager' },
  { id: 'executive', label: 'Executive' },
];

const EMPLOYMENT_TYPES = [
  { id: 'full-time', label: 'Full-Time' },
  { id: 'part-time', label: 'Part-Time' },
  { id: 'contract', label: 'Contract' },
  { id: 'freelance', label: 'Freelance' },
  { id: 'temporary', label: 'Temporary' },
  { id: 'internship', label: 'Internship' },
];

// ===== Filter Renderer =====
const renderFilterDropdown = (id, label, iconFn, items) => {
  const itemsHtml = items.map(item => `
    <div class="filter__dropdown-item" data-filter="${id}" data-value="${item.id}" role="option">
      ${iconFn(18)}
      <span>${item.label}</span>
    </div>
  `).join('');

  return `
    <div class="filter" data-filter-group="${id}">
      <button 
        class="filter__btn" 
        data-filter-toggle="${id}"
        aria-haspopup="listbox"
        aria-expanded="false"
      >
        ${iconFn(18)}
        <span>${label}</span>
        ${ChevronDown(16)}
      </button>
      <div class="filter__dropdown" role="listbox" aria-label="${label}">
        <div class="filter__dropdown-title">${label}</div>
        ${itemsHtml}
      </div>
    </div>
  `;
};

// ===== Home Page Render =====
export const renderHome = (env, request, context = {}) => {
  const { jobs = [], totalPages = 1, currentPage = 1, query = '' } = context;
  const baseUrl = env?.BASE_URL || 'https://jobforion.manasa.workers.dev';

  const filtersHtml = `
    ${renderFilterDropdown('category', 'Categories', Folder, CATEGORIES)}
    ${renderFilterDropdown('company', 'Companies', Building2, COMPANIES)}
    ${renderFilterDropdown('country', 'Countries', Globe, COUNTRIES)}
    ${renderFilterDropdown('experience', 'Experience', Award, EXPERIENCE_LEVELS)}
    ${renderFilterDropdown('type', 'Employment Type', Clock, EMPLOYMENT_TYPES)}
  `;

  const heroHtml = `
    <section class="hero">
      ${renderNav('/')}
      
      <div class="hero__container">
        <h1 class="hero__title">Find Your Dream Remote Job</h1>
        <p class="hero__subtitle">Discover thousands of remote opportunities from top companies worldwide</p>
        
        <form class="search" action="/search" method="get" role="search" aria-label="Job search">
          <div class="search__box">
            <span class="search__icon">${Search(22)}</span>
            <input 
              type="text" 
              name="q" 
              class="search__input" 
              placeholder="Search jobs by title, skill, or company..."
              value="${query}"
              aria-label="Search jobs"
              autocomplete="off"
            />
            <button type="submit" class="search__btn" aria-label="Search">
              ${Search(20)}
            </button>
          </div>
        </form>
        
        <div class="filters" role="toolbar" aria-label="Job filters">
          ${filtersHtml}
        </div>
      </div>
    </section>
  `;

  // Jobs listing section (below hero)
  const jobsSectionHtml = jobs.length > 0 ? renderJobsSection(jobs, currentPage, totalPages) : '';

  const pageContent = `
    ${heroHtml}
    ${jobsSectionHtml}
  `;

  return renderBaseLayout({
    env,
    request,
    title: 'JobForion — Remote Jobs Worldwide',
    description: 'Discover remote job opportunities from top companies around the world. Find your dream remote job today.',
    url: baseUrl + '/',
    css: SHARED_CSS,
    content: pageContent,
    footer: renderFooter(),
    structuredData: buildHomeJsonLd(baseUrl),
  });
};

// ===== Jobs Section (below hero) =====
const renderJobsSection = (jobs, currentPage, totalPages) => {
  const jobsHtml = jobs.map(job => renderJobCard(job)).join('');
  
  const paginationHtml = totalPages > 1 ? renderPagination(currentPage, totalPages) : '';

  return `
    <section class="jobs-section" style="padding: 4rem 0;">
      <div class="container">
        <div class="jobs-grid" style="display: grid; gap: 1.5rem;">
          ${jobsHtml}
        </div>
        ${paginationHtml}
      </div>
    </section>
  `;
};

// ===== Job Card (simplified) =====
const renderJobCard = (job) => {
  const title = escapeHtml(job.title || 'Untitled');
  const company = escapeHtml(job.company || 'Unknown Company');
  const location = escapeHtml(job.location || 'Remote');
  const type = escapeHtml(job.type || 'Full-Time');
  const url = `/job/${job.id}`;

  return `
    <article class="job-card" style="
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      transition: all var(--transition-base);
    ">
      <a href="${url}" style="display: block;">
        <h3 style="font-size: 1.1rem; font-weight: 600; color: var(--color-text); margin-bottom: 0.5rem;">
          ${title}
        </h3>
        <div style="display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.9rem; color: var(--color-text-muted);">
          <span>${company}</span>
          <span>•</span>
          <span>${location}</span>
          <span>•</span>
          <span>${type}</span>
        </div>
      </a>
    </article>
  `;
};

// ===== Pagination =====
const renderPagination = (current, total) => {
  if (total <= 1) return '';
  
  let html = '<nav class="pagination" style="display: flex; justify-content: center; gap: 0.5rem; margin-top: 3rem;" aria-label="Pagination">';
  
  for (let i = 1; i <= total; i++) {
    const isActive = i === current;
    html += `
      <a href="/?page=${i}" 
         style="
           padding: 0.5rem 1rem;
           border-radius: var(--radius-md);
           font-weight: ${isActive ? '600' : '400'};
           background: ${isActive ? 'var(--color-primary)' : 'var(--color-surface)'};
           color: ${isActive ? '#fff' : 'var(--color-text)'};
           border: 1px solid var(--color-border);
           transition: all var(--transition-fast);
         "
         ${isActive ? 'aria-current="page"' : ''}>
        ${i}
      </a>
    `;
  }
  
  html += '</nav>';
  return html;
};

// ===== JSON-LD =====
const buildHomeJsonLd = (baseUrl) => {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'JobForion',
    url: baseUrl,
    description: 'Remote job board — discover opportunities worldwide',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${baseUrl}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  });
};

// ===== Utility =====
const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export default renderHome;
