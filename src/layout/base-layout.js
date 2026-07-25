// src/layout/base-layout.js
import { SHARED_CSS } from '../styles/shared-css.js';
import { faviconHtml } from '../assets/favicon.js';
import { BASE_URL } from '../config/constants.js';

// الدالة الرئيسية المستخدمة في home.js
export const renderBaseLayout = ({ 
  env, 
  request, 
  title = 'JobForion', 
  description = 'Discover remote job opportunities from top companies around the world.', 
  url = BASE_URL, 
  css = SHARED_CSS, 
  content = '', 
  footer = '', 
  structuredData = '' 
}) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${url}">
  ${faviconHtml}
  <style>${css}</style>
  ${structuredData ? `<script type="application/ld+json">${structuredData}</script>` : ''}
</head>
<body>
  ${content}
  ${footer}
</body>
</html>`;
};

// ==========================================
// أسماء مستعارة (Aliases) للتوافق مع باقي المشروع
// ==========================================
// هذه السطور تمنع الأخطاء في: blog.js, job-page.js, seo-pages.js, static-pages.js, pages.router.js
export const baseLayout = renderBaseLayout;
export default renderBaseLayout;
