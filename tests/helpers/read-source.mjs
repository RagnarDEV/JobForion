// Some tests assert on source text. Large modules are split into an entry
// file plus a folder of parts; these helpers return them as ONE string so the
// assertions keep working regardless of how the code is organised on disk.
import fs from 'node:fs';
const src = (rel) => new URL(`../../src/${rel}`, import.meta.url);
function readParts(entry, dir) {
  const parts = [fs.readFileSync(src(entry), 'utf8')];
  if (fs.existsSync(src(dir))) {
    for (const name of fs.readdirSync(src(dir)).sort()) if (name.endsWith('.js')) parts.push(fs.readFileSync(src(`${dir}/${name}`), 'utf8'));
  }
  return parts.join('\n');
}
export const readApiSource = () => readParts('routes/api.router.js', 'routes/api');
export const readHomeSource = () => readParts('pages/home.js', 'pages/home');
export const readSeoPagesSource = () => readParts('pages/seo-pages.js', 'pages/seo');
