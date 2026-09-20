// src/pages/seo-pages.js
// Public barrel for the programmatic SEO pages. Implementation lives in
// src/pages/seo/ — one file per page family (jobs, categories, companies,
// countries, skills, search) plus shared.js. Import from here so callers
// never depend on the internal layout.
//
// SECURITY/CACHING NOTE: every render* function accepts an optional trailing
// `user` param but routes/seo-pages.router.js deliberately never passes it
// for edge-cached pages — a response built for one visitor's session must
// never be served to another. Leave `user` unset on cached pages.

export { renderJobsIndex, renderRemoteJobsLanding } from './seo/jobs.js';
export { renderCategoriesIndex, renderCategoryDetail } from './seo/categories.js';
export { renderCompaniesIndex, renderCompanyDetail } from './seo/companies.js';
export { renderCountriesIndex, renderCountryDetail } from './seo/countries.js';
export { renderSkillsIndex, renderSkillDetail } from './seo/skills.js';
export { renderSearchPage } from './seo/search.js';
