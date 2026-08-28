import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/pages/home.js', import.meta.url), 'utf8');
assert.match(source, /\.home-jobs-grid\{[^}]*align-items:start/);
assert.match(source, /\.home-sidebar\{[^}]*align-self:start[^}]*align-content:start[^}]*grid-auto-rows:max-content/);
assert.match(source, /\.side-card\{align-self:start;height:max-content/);
assert.match(source, /@media\(max-width:960px\)[\s\S]*?\.home-jobs-grid\{grid-template-columns:1fr/);
assert.match(source, /@media\(max-width:760px\)[\s\S]*?\.home-sidebar\{grid-template-columns:1fr/);
assert.match(source, /class="fc-strip"/);
assert.match(source, /company-tile-arrow/);
assert.match(source, /class="category-strip"/);
assert.match(source, /class="cg-arrow"/);
assert.match(source, /class="employer-cta-section"/);
assert.match(source, /class="cta-secondary"/);
assert.match(source, /@media\(max-width:760px\)[\s\S]*?\.cg-grid\{display:flex/);
console.log('home-layout tests: all assertions passed');
