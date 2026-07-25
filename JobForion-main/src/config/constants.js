// src/config/constants.js
// Site-wide constants: category taxonomy, featured companies, canonical base URL.

export const CATEGORY_META = {
  developer: { label: 'Development',       emoji: '💻', color: '#3556FF' },
  designer:  { label: 'Design',             emoji: '🎨', color: '#D6489B' },
  marketing: { label: 'Marketing',          emoji: '📣', color: '#F5A623' },
  data:      { label: 'Data & AI',          emoji: '📊', color: '#0EA5C4' },
  devops:    { label: 'DevOps',             emoji: '⚙️', color: '#0FAE79' },
  writer:    { label: 'Writing',            emoji: '✍️', color: '#7C3AED' },
  sales:     { label: 'Sales',              emoji: '💼', color: '#F97316' },
  support:   { label: 'Customer Support',   emoji: '🎧', color: '#14B8A6' },
  product:   { label: 'Product Management', emoji: '📦', color: '#6366F1' },
  finance:   { label: 'Finance & Accounting', emoji: '💰', color: '#059669' },
  recruit:   { label: 'HR & Recruiting',    emoji: '🤝', color: '#C026D3' },
  quality:   { label: 'QA & Testing',       emoji: '🔍', color: '#0891B2' },
  manager:   { label: 'Management',         emoji: '👔', color: '#FF5C7A' },
};
export const CATEGORY_ORDER = Object.keys(CATEGORY_META);
export const FEATURED_COMPANIES = ["Shopify", "GitLab", "Automattic", "Zapier", "Notion", "Stripe", "Doist", "Buffer"];

export const BASE_URL = 'https://jobforion.manasa.workers.dev';

