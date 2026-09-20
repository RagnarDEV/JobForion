import { readHomeSource } from './helpers/read-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = readHomeSource();
const companiesRouter = fs.readFileSync(new URL('../src/routes/seo-pages.router.js', import.meta.url), 'utf8');
assert.match(source, /\.home-jobs-grid\{[^}]*align-items:start/);
assert.match(source, /\.home-sidebar\{[^}]*align-self:start[^}]*align-content:start[^}]*grid-auto-rows:max-content/);
assert.match(source, /\.side-card\{align-self:start;height:max-content/);
assert.match(source, /@media\(max-width:960px\)[\s\S]*?\.home-jobs-grid\{grid-template-columns:1fr/);
assert.match(source, /@media\(max-width:760px\)[\s\S]*?\.home-sidebar\{grid-template-columns:1fr/);
assert.match(source, /class="fc-strip(?:\s|\")/);
assert.match(source, /company-tile-arrow/);
assert.match(source, /class="category-strip(?:\s|\")/);
assert.match(source, /class="cg-arrow"/);
assert.match(source, /class="employer-cta-section(?:\s|\")/);
assert.match(source, /class="cta-secondary"/);
assert.match(source, /@media\(max-width:760px\)[\s\S]*?\.cg-grid\{display:flex/);
assert.match(source, /function initHomepageReveal\(\)/);
assert.match(source, /IntersectionObserver/);
assert.match(source, /prefers-reduced-motion:reduce/);
assert.match(source, /homepage-reveal-section\.is-visible/);
assert.match(source, /homepage-reveal-item/);
assert.doesNotMatch(source, /jobs-section homepage-reveal-section/);
assert.match(source, /\.jobs-heading\{margin-bottom:24px\}/);
assert.match(source, /@media\(max-width:760px\)[\s\S]*?\.jobs-heading\{margin-bottom:20px\}/);
assert.match(companiesRouter, /verified: url\.searchParams\.get\('verified'\) \|\| '',\n\s+page: url\.searchParams\.get\('page'\) \|\| ''/);
console.log('home-layout tests: all assertions passed');

// The homepage must use the canonical job-card stylesheet, not a private copy.
assert.match(source, /\$\{JOB_CARD_CSS\}/);
assert.doesNotMatch(source, /\.card-inner\{padding:13px 14px\}/);
