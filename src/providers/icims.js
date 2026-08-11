// src/providers/icims.js
// Provider: iCIMS-hosted career sites, via the public XML job feed many
// iCIMS tenants expose for aggregators/job boards at:
//   https://<company>.icims.com/xmlfeed
// The "api_key" field for this provider holds the iCIMS subdomain, e.g.
// "acme" for acme.icims.com.
//
// BEST-EFFORT NOTE: iCIMS has no single documented public JSON API — the
// XML feed's exact tag names vary a little between tenants depending on
// how their iCIMS instance is configured. This parser targets the fields
// present in the standard feed layout (title/location/description/url)
// and simply skips any <job> block that doesn't have a usable link,
// rather than failing the whole source. Cloudflare Workers has no full
// DOM/XML parser available, so — consistent with this project's "no
// external deps" approach (see lib/entities.js's own HTML stripping) —
// this uses small, targeted regex extraction instead of a real XML parser.
export const id = 'icims';
export const needsKey = true;
export const keyFormatHint = 'iCIMS subdomain, e.g. acme';
export const ignoresQuery = true;

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i'));
  if (!m) return '';
  return m[1]
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .trim();
}

export async function fetchJobs({ apiKey: subdomain, timeoutMs = 15000 } = {}) {
  const url = `https://${encodeURIComponent(subdomain)}.icims.com/xmlfeed`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const blocks = xml.match(/<job>[\s\S]*?<\/job>/gi) || [];
    return blocks.map(b => map(b, subdomain)).filter(j => j.url);
  } finally {
    clearTimeout(timer);
  }
}

function map(block, subdomain) {
  const title = tag(block, 'title');
  const rawDesc = tag(block, 'description');
  const city = tag(block, 'city');
  const state = tag(block, 'state');
  const country = tag(block, 'country');
  const locationStr = [city, state, country].filter(Boolean).join(', ');
  const isRemote = /remote/i.test(locationStr) || /remote/i.test(title);
  return {
    title: title || 'Unknown',
    company: tag(block, 'company') || subdomain,
    location: isRemote ? 'Remote' : locationStr,
    url: tag(block, 'url') || tag(block, 'joburl') || '',
    description: rawDesc.replace(/<[^>]+>/g, ' ').slice(0, 5000),
    salary: '',
    remote_type: isRemote ? 'fully_remote' : '',
    skills: [],
    seniority: '',
    employment_type: (tag(block, 'type') || '').toLowerCase().replace(/[\s-]+/g, '_'),
    job_handle: tag(block, 'referencenumber') || tag(block, 'id') || '',
    source: 'icims',
  };
}
