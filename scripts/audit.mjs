#!/usr/bin/env node
// Static audit for the whole repo (no dependencies). Fails (exit 1) on:
//   1. any JS syntax error                     (node --check equivalent)
//   2. an import of a file that does not exist
//   3. a named import that the target file does not export
// And REPORTS (does not fail) on: orphan files, unused imports.
// Usage: node scripts/audit.mjs [--strict]   (--strict also fails on unused imports/orphans)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const strict = process.argv.includes('--strict');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? (d.name === 'node_modules' ? [] : walk(p)) : (/\.(m?js)$/.test(d.name) ? [p] : []);
});
const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'tests')), ...walk(path.join(root, 'scripts'))];
const rel = (f) => path.relative(root, f);
let errors = 0;
const fail = (msg) => { errors++; console.error('✗', msg); };

// 1. syntax
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(`syntax: ${rel(f)}\n${r.stderr.split('\n').slice(0, 4).join('\n')}`);
}

// exports / imports
const src = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const exportsOf = (s) => {
  const ex = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/g)) ex.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of m[1].split(',')) { const t = n.trim(); if (t) ex.add(t.split(/\s+as\s+/).pop().trim()); }
  if (/export\s+default/.test(s)) ex.add('default');
  return ex;
};
const importRe = /import\s+(?:([\w$]+)\s*,?\s*)?(?:\*\s+as\s+([\w$]+)|\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]\s*;?/g;
// Barrel re-exports (export-from statements) also count as import edges.
const reexportRe = /export\s*(?:\{[^}]*\}|\*)\s*from\s*['"]([^'"]+)['"]/g;
const exportsMap = new Map([...src].map(([f, s]) => [f, exportsOf(s)]));
const importedBy = new Map(files.map((f) => [f, new Set()]));
const unusedImports = [];
for (const [f, s] of src) {
  const body = s.replace(importRe, '');
  for (const m of s.matchAll(importRe)) {
    const [, def, ns, names, spec] = m;
    if (!spec.startsWith('.')) continue;
    const target = path.normalize(path.resolve(path.dirname(f), spec));
    if (!src.has(target)) { fail(`${rel(f)}: imports missing file '${spec}'`); continue; }
    importedBy.get(target).add(f);
    const ex = exportsMap.get(target);
    const locals = [];
    if (def) { locals.push(def); if (!ex.has('default')) fail(`${rel(f)}: '${spec}' has no default export`); }
    if (ns) locals.push(ns);
    if (names) for (const n of names.split(',')) {
      const t = n.trim(); if (!t) continue;
      const [orig, alias] = t.split(/\s+as\s+/).map((x) => x.trim());
      if (!ex.has(orig)) fail(`${rel(f)}: '${orig}' is not exported by '${spec}'`);
      locals.push(alias || orig);
    }
    for (const l of locals) if (!new RegExp(`(?<![\\w$])${l.replace(/\$/g, '\\$')}(?![\\w$])`).test(body)) unusedImports.push(`${rel(f)}: ${l}`);
  }
}
for (const [f, s2] of src) for (const m of s2.matchAll(reexportRe)) {
  if (!m[1].startsWith('.')) continue;
  const target = path.normalize(path.resolve(path.dirname(f), m[1]));
  if (!src.has(target)) fail(`${rel(f)}: re-exports missing file '${m[1]}'`); else importedBy.get(target).add(f);
}
const orphans = files.filter((f) => f.startsWith(path.join(root, 'src')) && !importedBy.get(f).size && rel(f) !== 'src/index.js').map(rel);

console.log(`files: ${files.length}  errors: ${errors}  orphans: ${orphans.length}  unused imports: ${unusedImports.length}`);
if (orphans.length) console.log('orphan files:\n  ' + orphans.join('\n  '));
if (unusedImports.length) console.log('unused imports:\n  ' + unusedImports.join('\n  '));
process.exit(errors || (strict && (orphans.length || unusedImports.length)) ? 1 : 0);
