// src/lib/sitemap.js
import { listCompanies, listSkills, listCountries } from './entities.js';

// `blogPosts` / `categoryOrder` are passed in from index.js since they're
// still defined as in-code constants there (static content stays static).
export async function buildSitemapXml(env, base, { blogPosts = [], categoryOrder = [] } = {}) {
  const urls = [];
  const add = (loc, opts = {}) => urls.push(
    `<url><loc>${loc}</loc>${opts.changefreq ? `<changefreq>${opts.changefreq}</changefreq>` : ''}${opts.priority ? `<priority>${opts.priority}</priority>` : ''}${opts.lastmod ? `<lastmod>${opts.lastmod}</lastmod>` : ''}</url>`
  );

  // core pages
  add(`${base}/`, { changefreq: 'hourly', priority: '1.0' });
  add(`${base}/blog`, { changefreq: 'weekly', priority: '0.8' });
  add(`${base}/privacy`, { changefreq: 'yearly', priority: '0.3' });
  add(`${base}/terms`, { changefreq: 'yearly', priority: '0.3' });
  add(`${base}/disclaimer`, { changefreq: 'yearly', priority: '0.3' });

  // directory index pages
  add(`${base}/companies`, { changefreq: 'daily', priority: '0.7' });
  add(`${base}/categories`, { changefreq: 'daily', priority: '0.7' });
  add(`${base}/skills`, { changefreq: 'daily', priority: '0.6' });
  add(`${base}/countries`, { changefreq: 'daily', priority: '0.6' });

  // blog
  for (const p of blogPosts) add(`${base}/blog/${p.id}`, { changefreq: 'monthly', priority: '0.7' });

  // categories (static list, cheap)
  for (const key of categoryOrder) add(`${base}/categories/${key}`, { changefreq: 'daily', priority: '0.65' });

  // jobs / companies / skills / countries queries are all independent —
  // run them in parallel instead of sequentially awaiting each one. This
  // alone can cut the endpoint's total wall-clock time roughly in half to
  // a third, which matters because a slow-but-eventually-successful
  // response is exactly what causes crawlers (which apply their own fetch
  // timeouts) to report "couldn't fetch" even though a browser, given
  // enough time, would eventually see a valid file.
  //
  // CAP SIZING: Google's sitemap protocol allows up to 50,000 URLs per
  // file. These four ceilings (30,000 + 3,000 + 1,500 + 600 = 35,100, plus
  // ~28 static/blog/category entries above) stay comfortably under that
  // limit even if every category is maxed out simultaneously, while being
  // generous enough to include effectively all real content for a long
  // time. The previous values (1000 / 500 / 300 / 300) were sized as if
  // this were a small site and were silently capping ~96% of job pages
  // out of the sitemap once the job count passed 1,000 — if growth ever
  // approaches these new ceilings, the next step is splitting into a
  // sitemap INDEX (multiple sitemap-*.xml files) rather than raising them
  // further, per Google's own guidance for very large sites.
  const [jobsResult, companiesResult, skillsResult, countriesResult] = await Promise.allSettled([
    env.DB.prepare("SELECT id,created_at FROM jobs ORDER BY id DESC LIMIT 30000").all(),
    listCompanies(env, { limit: 3000 }),
    listSkills(env, { limit: 1500 }),
    listCountries(env, { limit: 600 }),
  ]);

  if (jobsResult.status === 'fulfilled') {
    for (const j of jobsResult.value.results || []) {
      add(`${base}/job/${j.id}`, { changefreq: 'weekly', priority: '0.6', lastmod: new Date(j.created_at || Date.now()).toISOString().split('T')[0] });
    }
  }
  if (companiesResult.status === 'fulfilled') {
    for (const c of companiesResult.value) add(`${base}/companies/${c.slug}`, { changefreq: 'weekly', priority: '0.55' });
  }
  if (skillsResult.status === 'fulfilled') {
    for (const s of skillsResult.value) add(`${base}/skills/${s.slug}`, { changefreq: 'weekly', priority: '0.5' });
  }
  if (countriesResult.status === 'fulfilled') {
    for (const c of countriesResult.value) add(`${base}/countries/${c.slug}`, { changefreq: 'weekly', priority: '0.5' });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('')}
</urlset>`.trim();
}
