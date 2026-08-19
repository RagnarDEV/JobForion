// src/lib/skill-extraction.js
// ════════════════════════════════════════════════════════════════
// ROOT-CAUSE FIX (companion to extractSalaryFromDescription() in
// lib/salary.js) for skills tags being empty on almost every synced
// job. Only 1 of the 9 ATS providers (Recruitee, via its `tags` field)
// returns anything skills-shaped — every other provider hardcodes
// `skills: []` because the raw API genuinely has no structured skills
// field. This scans the free-text job description for mentions of a
// curated, cross-category skill dictionary and returns whatever matches
// — used as a fallback in db/sync.js exactly like the salary fix:
//   j.skills = (j.skills && j.skills.length) ? j.skills : extractSkillsFromText(j.description)
//
// Deliberately keyword-matching, not NLP/AI — consistent with the rest
// of the project's "no AI" constraints elsewhere (e.g. Blog Automation).
// The dictionary spans every category on the site (CATEGORY_ORDER in
// config/constants.js: developer, designer, marketing, data, devops,
// writer, sales, support, product, finance, recruit, quality, manager),
// not just engineering — a marketing or finance job with zero
// programming terms should still pick up e.g. "SEO" or "QuickBooks".
// ════════════════════════════════════════════════════════════════

export const KNOWN_SKILLS = [
  // Programming languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'SQL', 'Scala',
  // Frontend
  'React', 'Vue', 'Angular', 'Next.js', 'Svelte', 'HTML', 'CSS', 'Tailwind', 'Redux',
  // Backend / infrastructure
  'Node.js', 'Django', 'Flask', 'Spring', 'Ruby on Rails', 'GraphQL', 'REST API', 'Docker', 'Kubernetes',
  'AWS', 'Azure', 'GCP', 'Terraform', 'CI/CD', 'Microservices', 'Linux', 'Git',
  // Data / ML
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Snowflake', 'Spark', 'Airflow', 'Tableau', 'Power BI', 'Excel',
  'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', 'ETL',
  // Design
  'Figma', 'Sketch', 'Adobe XD', 'Photoshop', 'Illustrator', 'UI/UX', 'Wireframing', 'Prototyping', 'Design Systems',
  // Marketing
  'SEO', 'SEM', 'Google Analytics', 'Content Marketing', 'Social Media Marketing', 'Email Marketing',
  'HubSpot', 'PPC', 'Copywriting', 'Growth Marketing', 'A/B Testing',
  // Sales / Support
  'Salesforce', 'CRM', 'Zendesk', 'Customer Support', 'Negotiation', 'Cold Calling', 'Account Management', 'Customer Success',
  // Product / Management
  'Agile', 'Scrum', 'Jira', 'Product Management', 'Roadmapping', 'Stakeholder Management', 'Kanban', 'OKRs',
  // Finance
  'Accounting', 'QuickBooks', 'Financial Modeling', 'Bookkeeping', 'GAAP', 'Forecasting', 'Budgeting',
  // Writing / Content
  'Content Writing', 'Technical Writing', 'Editing', 'Blogging', 'Journalism',
  // HR / Recruiting
  'Recruiting', 'Talent Acquisition', 'Onboarding', 'HRIS', 'Employer Branding',
  // QA
  'Manual Testing', 'Automated Testing', 'Selenium', 'QA', 'Test Cases', 'Cypress',
  // General professional
  'Project Management', 'Leadership', 'Public Speaking', 'Data Analysis',
];

// Special characters (., +, #, /) inside skill names like "C++", "C#",
// "Node.js", "CI/CD", "UI/UX" must be escaped before being dropped into
// a RegExp, or they'd be interpreted as regex syntax instead of literal
// characters.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matches only if the character immediately before/after the skill name
// isn't itself alphanumeric, so "React" doesn't match inside "Reactive"
// and "Go" doesn't match inside "Google" — a plain `\b` alone doesn't
// work here since some skill names start/end with symbols ("C++", "C#").
function skillRegex(skill) {
  const escaped = escapeRegex(skill);
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:[^A-Za-z0-9]|$)`, 'i');
}

const COMPILED = KNOWN_SKILLS.map(skill => ({ skill, re: skillRegex(skill) }));

export function extractSkillsFromText(text, limit = 8) {
  if (!text) return [];
  const plain = String(text).replace(/<[^>]+>/g, ' ');
  const found = [];
  for (const { skill, re } of COMPILED) {
    if (re.test(plain)) {
      found.push(skill);
      if (found.length >= limit) break;
    }
  }
  return found;
}
