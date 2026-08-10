// src/providers/icims.js
// Provider: iCIMS career portals — no single consistent public JSON API
// exists across every iCIMS tenant, but most portals expose a public RSS
// job feed by default at <company>.icims.com/xml/rss/. This is a
// best-effort integration: if a specific tenant has that feed disabled,
// fetchJobs() throws and the sync orchestrator simply logs the error and
// moves on to the next company — it never breaks the rest of a sync run.
// The "company" field holds the subdomain used in <company>.icims.com.
export const id = 'icims';
export const displayName = 'iCIMS';
export const keyFormatHint = 'career-site subdomain from <company>.icims.com (best-effort, RSS-based)';
export const ignoresQuery = true;

export async function fetchJobs({ company, timeoutMs = 15000 } = {}) {
  if (!company) throw new Error('No iCIMS subdomain provided');
  const url = `https://${encodeURIComponent(company)}.icims.com/xml/rss/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const jobs = parseRss(xml, company);
    if (!jobs.length) throw new Error('RSS feed returned no jobs — this tenant may have it disabled');
    return jobs.filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

// Minimal, dependency-free RSS <item> extractor — no XML parser is
// available in this Worker runtime, and pulling one in just for a single
// best-effort provider isn't worth the bundle size. Good enough for the
// simple flat structure iCIMS RSS feeds use.
function parseRss(xml, company) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/item>/i)[0] || '';
    const grab = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (!m) return '';
      return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim();
    };
    const title = grab('title');
    const link = grab('link');
    if (!title || !link) continue;
    const description = grab('description').replace(/<[^>]+>/g, ' ').slice(0, 5000);
    items.push({
      title,
      company,
      location: '',
      url: link,
      description,
      salary: '',
      remote_type: /remote/i.test(title + ' ' + description) ? 'fully_remote' : '',
      skills: [],
      seniority: '',
      employment_type: '',
      job_handle: '',
      source: 'icims',
    });
  }
  return items;
}
