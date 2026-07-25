// src/pages/home.js
import { baseLayout } from '../layout/base-layout.js';
import { navHtml } from '../components/nav.js';
import { renderFooter } from '../components/footer.js';
import { SHARED_CSS } from '../styles/shared-css.js';
import { BASE_URL } from '../config/constants.js';
import {
  Search, Folder, Building2, Globe, Award,
  Clock, ChevronDown, Briefcase, MapPin, DollarSign
} from '../assets/icons.js';

// ===== Filter Data =====
const CATEGORIES = [
  { id: 'development', label: 'Development' }, { id: 'design', label: 'Design' },
  { id: 'marketing', label: 'Marketing' }, { id: 'finance', label: 'Finance' },
  { id: 'engineering', label: 'Engineering' }, { id: 'hr', label: 'HR' },
  { id: 'writing', label: 'Writing' }, { id: 'customer-support', label: 'Customer Support' },
  { id: 'sales', label: 'Sales' },
];

const COMPANIES = [
  { id: 'google', label: 'Google' }, { id: 'microsoft', label: 'Microsoft' },
  { id: 'amazon', label: 'Amazon' }, { id: 'apple', label: 'Apple' },
  { id: 'meta', label: 'Meta' }, { id: 'shopify', label: 'Shopify' },
  { id: 'gitlab', label: 'GitLab' }, { id: 'stripe', label: 'Stripe' },
];

const COUNTRIES = [
  { id: 'us', label: 'United States' }, { id: 'ca', label: 'Canada' },
  { id: 'de', label: 'Germany' }, { id: 'uk', label: 'United Kingdom' },
  { id: 'au', label: 'Australia' }, { id: 'fr', label: 'France' },
  { id: 'jp', label: 'Japan' }, { id: 'in', label: 'India' },
  { id: 'remote', label: 'Remote Worldwide' },
];

const EXPERIENCE_LEVELS = [
  { id: 'internship', label: 'Internship' }, { id: 'entry', label: 'Entry Level' },
  { id: 'junior', label: 'Junior' }, { id: 'mid', label: 'Mid-Level' },
  { id: 'senior', label: 'Senior' }, { id: 'lead', label: 'Lead' },
  { id: 'manager', label: 'Manager' }, { id: 'executive', label: 'Executive' },
];

const EMPLOYMENT_TYPES = [
  { id: 'full-time', label: 'Full-Time' }, { id: 'part-time', label: 'Part-Time' },
  { id: 'contract', label: 'Contract' }, { id: 'freelance', label: 'Freelance' },
  { id: 'temporary', label: 'Temporary' }, { id: 'internship', label: 'Internship' },
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
      <button class="filter__btn" data-filter-toggle="${id}" aria-haspopup="listbox" aria-expanded="false">
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

// ===== Job Card Renderer =====
const renderJobCard = (job) => {
  const title = escapeHtml(job.title || 'Untitled');
  const company = escapeHtml(job.company || 'Unknown Company');
  const location = escapeHtml(job.location || job.country || 'Remote');
  const type = escapeHtml(job.type || job.employment_type || 'Full-Time');
  const salary = job.salary ? escapeHtml(job.salary) : null;
  const url = `/job/${job.id}`;
  const postedDate = job.posted_at ? formatDate(job.posted_at) : null;

  return `
    <article class="job-card" data-job-id="${job.id}">
      <a href="${url}" class="job-card__link">
        <div class="job-card__header">
          <h3 class="job-card__title">${title}</h3>
          ${postedDate ? `<span class="job-card__date">${postedDate}</span>` : ''}
        </div>
        <div class="job-card__meta">
          <span class="job-card__company">${company}</span>
          <span class="job-card__location">${MapPin(16)} ${location}</span>
          ${salary ? `<span class="job-card__salary">${DollarSign(16)} ${salary}</span>` : ''}
        </div>
        <div class="job-card__tags">
          <span class="job-card__tag">${type}</span>
        </div>
      </a>
    </article>
  `;
};

// ===== Jobs Section =====
const renderJobsSection = (jobs, currentPage, totalPages) => {
  const jobsHtml = jobs.map(job => renderJobCard(job)).join('');
  const paginationHtml = totalPages > 1 ? renderPagination(currentPage, totalPages) : '';

  return `
    <section class="jobs-section">
      <div class="container">
        <div class="jobs-header">
          <h2 class="jobs-header__title">Latest Remote Jobs</h2>
          <p class="jobs-header__subtitle">${jobs.length} jobs available</p>
        </div>
        <div class="jobs-grid">${jobsHtml}</div>
        ${paginationHtml}
      </div>
    </section>
  `;
};

// ===== Empty State =====
const renderEmptyState = () => {
  return `
    <section class="jobs-section">
      <div class="container">
        <div class="empty-state">
          ${Briefcase(64)}
          <h3 class="empty-state__title">No jobs found</h3>
          <p class="empty-state__subtitle">Try adjusting your search or filters to find what you're looking for.</p>
          <a href="/" class="empty-state__btn">Clear Filters</a>
        </div>
      </div>
    </section>
  `;
};

// ===== Pagination =====
const renderPagination = (current, total) => {
  if (total <= 1) return '';
  let html = '<nav class="pagination" aria-label="Pagination">';
  if (current > 1) html += `<a href="/?page=${current - 1}" class="pagination__btn">Previous</a>`;
  for (let i = 1; i <= total; i++) {
    const isActive = i === current;
    html += `<a href="/?page=${i}" class="pagination__btn${isActive ? ' pagination__btn--active' : ''}" ${isActive ? 'aria-current="page"' : ''}>${i}</a>`;
  }
  if (current < total) html += `<a href="/?page=${current + 1}" class="pagination__btn">Next</a>`;
  html += '</nav>';
  return html;
};

// ===== JavaScript for Interactive Elements =====
const pageScript = `
<script>
(function() {
  const filterBtns = document.querySelectorAll('[data-filter-toggle]');
  const filterDropdowns = document.querySelectorAll('.filter__dropdown');
  
  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const filterId = btn.getAttribute('data-filter-toggle');
      const dropdown = document.querySelector('.filter[data-filter-group="' + filterId + '"] .filter__dropdown');
      const isOpen = btn.classList.contains('active');
      
      filterBtns.forEach(b => b.classList.remove('active'));
      filterDropdowns.forEach(d => d.classList.remove('open'));
      
      if (!isOpen) {
        btn.classList.add('active');
        dropdown.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      } else {
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  });
  
  document.querySelectorAll('.filter__dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const filterGroup = item.getAttribute('data-filter');
      const value = item.getAttribute('data-value');
      const label = item.querySelector('span').textContent;
      
      const btn = document.querySelector('.filter[data-filter-group="' + filterGroup + '"] .filter__btn');
      const icon = btn.querySelector('svg:first-child');
      const chevron = btn.querySelector('svg:last-child');
      
      btn.innerHTML = '';
      btn.appendChild(icon.cloneNode(true));
      btn.appendChild(document.createTextNode(' ' + label + ' '));
      btn.appendChild(chevron.cloneNode(true));
      
      item.closest('.filter__dropdown').classList.remove('open');
      btn.classList.remove('active');
      btn.setAttribute('aria-expanded', 'false');
      
      const url = new URL(window.location.href);
      url.searchParams.set(filterGroup, value);
      window.history.pushState({}, '', url);
    });
  });
  
  document.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    filterDropdowns.forEach(d => d.classList.remove('open'));
  });
  
  const searchForm = document.querySelector('.search');
  const searchInput = document.querySelector('.search__input');
  if (searchForm && searchInput) {
    searchForm.addEventListener('submit', (e) => {
      if (!searchInput.value.trim()) {
        e.preventDefault();
        searchInput.focus();
      }
    });
  }
})();
</script>
`;

// ===== Main Render Function (هذا هو السطر الذي كان ينقص ويصلح الخطأ) =====
export const renderMainHTML = async (env, request, context = {}) => {
  const { jobs = [], totalPages = 1, currentPage = 1, query = '' } = context;
  const baseUrl = env?.BASE_URL || BASE_URL;

  const filtersHtml = `
    ${renderFilterDropdown('category', 'Categories', Folder, CATEGORIES)}
    ${renderFilterDropdown('company', 'Companies', Building2, COMPANIES)}
    ${renderFilterDropdown('country', 'Countries', Globe, COUNTRIES)}
    ${renderFilterDropdown('experience', 'Experience', Award, EXPERIENCE_LEVELS)}
    ${renderFilterDropdown('type', 'Employment Type', Clock, EMPLOYMENT_TYPES)}
  `;

  const heroHtml = `
    <section class="hero">
      ${navHtml('/')}
      <div class="hero__container">
        <h1 class="hero__title">Find Your Dream Remote Job</h1>
        <p class="hero__subtitle">Discover thousands of remote opportunities from top companies worldwide</p>
        <form class="search" action="/search" method="get" role="search" aria-label="Job search">
          <div class="search__box">
            <span class="search__icon">${Search(22)}</span>
            <input type="text" name="q" class="search__input" placeholder="Search jobs by title, skill, or company..." value="${query}" aria-label="Search jobs" autocomplete="off" />
            <button type="submit" class="search__btn" aria-label="Search">${Search(20)}</button>
          </div>
        </form>
        <div class="filters" role="toolbar" aria-label="Job filters">${filtersHtml}</div>
      </div>
    </section>
  `;

  const jobsSectionHtml = jobs.length > 0 ? renderJobsSection(jobs, currentPage, totalPages) : renderEmptyState();
  
  const html = baseLayout({
    env, request,
    title: 'JobForion — Remote Jobs Worldwide',
    description: 'Discover remote job opportunities from top companies around the world.',
    url: baseUrl + '/',
    css: SHARED_CSS,
    content: `${heroHtml}${jobsSectionHtml}`,
    footer: renderFooter(),
    structuredData: JSON.stringify({
      '@context': 'https://schema.org', '@type': 'WebSite', name: 'JobForion', url: baseUrl,
      potentialAction: { '@type': 'SearchAction', target: `${baseUrl}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' }
    }),
  });

  // حقن كود الجافاسكريبت لتشغيل الأزرار والقوائم قبل إغلاق وسم body
  return html.replace('</body>', pageScript + '</body>');
};

// ===== أسماء مستعارة لضمان التوافق مع أي ملف آخر =====
export const renderHome = renderMainHTML;
export default renderMainHTML;

// ===== Utilities =====
const escapeHtml = (str) => {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

const formatDate = (dateStr) => {
  try {
    const date = new Date(dateStr);
    const diff = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return diff + ' days ago';
    if (diff < 30) return Math.floor(diff / 7) + ' weeks ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
};
