// Developer tool: lists admin UI strings that have NO Arabic translation yet.
//   node scripts/harvest-admin-strings.mjs            → untranslated strings (runtime + source scan)
//   node scripts/harvest-admin-strings.mjs --all      → every string found
// Runtime pass boots the real Worker against an in-memory D1 and renders every admin page;
// the source pass scans templates for strings the empty database does not render (table rows,
// conditional branches, flash/error messages in the routers).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractStrings, makeTranslator, decodeEntities } from '../src/lib/admin-i18n/translate.js';
import { AR_EXACT, AR_PATTERNS } from '../src/lib/admin-i18n/ar/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { D1Shim } = await import('../tests/helpers/d1-shim.mjs');
const mem = new Map();
globalThis.caches = { default: { async match(r) { return mem.get(r.url)?.clone(); }, async put(r, res) { mem.set(r.url, res); }, async delete(r) { return mem.delete(r.url); } } };
const worker = (await import('../src/index.js')).default;
const env = { DB: new D1Shim(), ADMIN_PASSWORD: 'harvest-pass-123456', CSRF_SECRET: 'harvest-csrf-secret-xyz' };
const ctx = { waitUntil() {} };
const call = (p, o = {}) => worker.fetch(new Request(`https://jobforion.com${p}`, { redirect: 'manual', ...o }), { ...env }, ctx);
// the schema migration is resumable and paused per request — warm it up so every page renders fully
for (let i = 0; i < 14; i++) await call('/');
const login = await call('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=harvest-pass-123456' });
const cookie = (login.headers.get('Set-Cookie') || '').split(';')[0];

const found = new Map();
const note = (s, where) => { if (!found.has(s)) found.set(s, where); };

// runtime pass
const shell = fs.readFileSync(path.join(root, 'src/pages/admin/shell.js'), 'utf8');
const hrefs = [...shell.matchAll(/href: '(\/admin[^']*)'/g)].map((m) => m[1]);
const pages = [...new Set(['/admin', '/admin/login', '/admin/jobs/duplicates', '/admin/jobs/edit?id=1', ...hrefs])];
for (const p of pages) {
  try {
    const html = await (await call(p, { headers: { Cookie: cookie } })).text();
    for (const s of extractStrings(html)) note(s, `page ${p}`);
  } catch (e) { console.error('render failed', p, e.message); }
}
// login page (no cookie)
for (const s of extractStrings(await (await call('/admin')).text())) note(s, 'login');

// source pass (skipped with --runtime-only: precise but only sees what the empty database renders)
const runtimeOnly = process.argv.includes('--runtime-only');
const files = [
  ...fs.readdirSync(path.join(root, 'src/pages/admin')).map((f) => `src/pages/admin/${f}`),
  'src/pages/admin.js', 'src/pages/admin/shell.js',
  ...fs.readdirSync(path.join(root, 'src/routes/admin')).map((f) => `src/routes/admin/${f}`),
].filter((f) => f.endsWith('.js'));
for (const f of runtimeOnly ? [] : files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const masked = src.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '\u0000');
  for (const m of masked.matchAll(/>([^<>`]{2,300})</g)) for (const part of m[1].split('\u0000')) { const s = decodeEntities(part).replace(/\s+/g, ' ').trim(); if (/[A-Za-z]{2}/.test(s) && !/[{};=]/.test(s) && !/^[A-Za-z0-9_./#-]+$/.test(s) || /^[A-Z][a-z]+$/.test(s)) note(s, f); }
  for (const m of masked.matchAll(/\b(?:placeholder|title|aria-label)="([^"\u0000]{3,160})"/g)) note(m[1], f);
  if (f.includes('routes/admin')) {
    for (const m of masked.matchAll(/(['"])((?:(?!\1)[^\\\n\u0000]){10,200})\1/g)) {
      const s = m[2];
      if (/ /.test(s) && /^[A-Z]/.test(s) && !/[{}<>=;]/.test(s) && !/^(Content-Type|Set-Cookie)/.test(s)) note(s, f);
    }
  }
}
const tr = makeTranslator({ exact: AR_EXACT, patterns: AR_PATTERNS });
const all = [...found.keys()].sort();
const missing = all.filter((s) => !tr.has(s));
if (process.argv.includes('--all')) { console.log(JSON.stringify(all, null, 1)); process.exit(0); }
console.log(`# ${all.length} strings found, ${all.length - missing.length} translated, ${missing.length} missing`);
if (process.argv.includes('--json')) console.log(JSON.stringify(missing, null, 1)); else for (const s of missing) console.log(`${s}\t(${found.get(s)})`);
