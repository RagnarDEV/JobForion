import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/pages/home.js', import.meta.url), 'utf8');
assert.match(source, /trust_strip:\s*`<section class="trust-strip">/);
assert.match(source, /class="trust-card"/);
assert.match(source, /class="trust-intro"/);
assert.match(source, /class="trust-grid"/);
assert.equal((source.match(/class="trust-item"/g) || []).length, 4);
assert.match(source, /\.trust-card\{display:grid;grid-template-columns:/);
assert.match(source, /\.trust-card\{[^}]*align-items:center/);
assert.match(source, /\.trust-item\{display:flex;align-items:center/);
assert.match(source, /@media\(max-width:760px\)[\s\S]*?\.trust-grid\{grid-template-columns:1fr 1fr/);
console.log('trust-strip tests: all assertions passed');
