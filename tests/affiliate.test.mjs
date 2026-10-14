// Affiliate Manager: validation, targeting, tracked redirect, click accounting, conversions, rendering.
import assert from 'node:assert/strict';
import { D1Shim } from './helpers/d1-shim.mjs';
import {
  cleanOfferInput, validateDestinationTemplate, pickOffers, buildDestination, offerIsLive,
  saveProgram, saveOffer, listOffers, getAffiliateStats, addConversion, importConversionsCsv,
  parseMoneyMinor, formatMinor, earningsPerClick, cleanupAffiliate, parseCsv, deleteProgram, placementEnabled,
} from '../src/lib/affiliate/affiliate.js';
import { affiliateBlockHtml } from '../src/components/affiliate-block.js';
import { handleAffiliateRoute } from '../src/routes/affiliate.router.js';
import { setSettings } from '../src/lib/platform/settings.js';
import { safeAdminRedirect } from '../src/lib/platform/safe-redirect.js';

const env = { DB: new D1Shim(), CSRF_SECRET: 'test-secret' };
env.DB.db.exec(`
CREATE TABLE site_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
CREATE TABLE aff_programs(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,network TEXT,commission_note TEXT,status TEXT NOT NULL DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE aff_offers(id INTEGER PRIMARY KEY AUTOINCREMENT,program_id INTEGER NOT NULL,slug TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT,cta_label TEXT,badge TEXT,icon_key TEXT,destination_url TEXT NOT NULL,placements TEXT,category_keys TEXT,skill_keys TEXT,weight INTEGER DEFAULT 1,status TEXT NOT NULL DEFAULT 'active',starts_at TEXT,ends_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE aff_daily(day TEXT NOT NULL,offer_id INTEGER NOT NULL,placement TEXT NOT NULL,clicks INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,offer_id,placement)) WITHOUT ROWID;
CREATE TABLE aff_clicks(id INTEGER PRIMARY KEY AUTOINCREMENT,click_id TEXT UNIQUE NOT NULL,offer_id INTEGER NOT NULL,placement TEXT,page_path TEXT,ip_hash TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE aff_conversions(id INTEGER PRIMARY KEY AUTOINCREMENT,offer_id INTEGER NOT NULL,click_id TEXT,amount_minor INTEGER NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT 'USD',status TEXT NOT NULL DEFAULT 'pending',note TEXT,occurred_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
const db = env.DB.db;
const setSetting = (k, v) => setSettings(env, { [k]: v }); // clears the isolate settings cache like the admin does

// ── destination template validation ──
assert.ok(validateDestinationTemplate('https://partner.example/p?aff=ME&sub={click_id}').ok);
for (const bad of ['javascript:alert(1)', 'ftp://x.com', 'https://x.com/ a', 'https://x.com/"onmouseover=1', 'https://x.com/{secret}', '', '//evil.com', 'data:text/html,hi', 'https://x.com/<script>'])
  assert.equal(validateDestinationTemplate(bad).ok, false, `rejects ${bad}`);

// ── offer input ──
const programs = [{ id: 1 }];
const base = { program_id: '1', title: 'Python Course', destination_url: 'https://partner.example/c?aff=ME', placements: ['job_page', 'evil', 'blog_post'] };
let c = cleanOfferInput(base, { programs });
assert.ok(c.ok); assert.equal(c.value.slug, 'python-course'); assert.equal(c.value.placements, 'job_page,blog_post', 'unknown placements dropped');
assert.equal(cleanOfferInput({ ...base, program_id: '9' }, { programs }).ok, false, 'unknown program rejected');
assert.equal(cleanOfferInput({ ...base, slug: '../x' }, { programs }).value?.slug, 'x', 'slug sanitised');
assert.equal(cleanOfferInput({ ...base, starts_at: '2026-05-02', ends_at: '2026-05-01' }, { programs }).ok, false, 'end before start rejected');
assert.equal(cleanOfferInput({ ...base, weight: '999' }, { programs }).value.weight, 10);
assert.equal(cleanOfferInput({ ...base, title: '' }, { programs }).ok, false);

// ── money ──
assert.equal(parseMoneyMinor('12.5'), 1250); assert.equal(parseMoneyMinor('$1,234.56'), 123456);
assert.equal(parseMoneyMinor('abc'), null); assert.equal(parseMoneyMinor('1.234'), null);
assert.equal(formatMinor(123456, 'EUR'), '€1,234.56');

// ── selection / targeting ──
const mk = (o) => ({ id: o.id, slug: `o${o.id}`, title: `T${o.id}`, weight: 1, placements: 'job_page', category_keys: '', skill_keys: '', starts_at: null, ends_at: null, ...o });
const now = Date.UTC(2026, 9, 14);
const offers = [mk({ id: 1 }), mk({ id: 2, skill_keys: 'python' }), mk({ id: 3, category_keys: 'designer' }), mk({ id: 4, placements: 'blog_post' }), mk({ id: 5, ends_at: '2026-10-01' }), mk({ id: 6, starts_at: '2026-12-01' })];
const idsFor = (ctx, place = 'job_page') => pickOffers(offers, place, { ...ctx, limit: 10, now, rand: () => 0.5 }).map((o) => o.id).sort();
assert.deepEqual(idsFor({ skills: ['Python'], categoryKey: 'developer' }), [1, 2], 'python page: generic + python offer; not designer, expired or future');
assert.deepEqual(idsFor({ categoryKey: 'designer' }), [1, 3]);
assert.deepEqual(idsFor({}), [1], 'untargeted page only gets untargeted offers');
assert.deepEqual(idsFor({}, 'blog_post'), [4]);
assert.equal(offerIsLive(mk({ id: 9, ends_at: '2026-10-14' }), now), true, 'end date is inclusive');
assert.equal(pickOffers(offers, 'job_page', { limit: 1, now }).length, 1);
const seen = new Set(); for (let i = 0; i < 60; i++) seen.add(pickOffers([mk({ id: 1 }), mk({ id: 2 })], 'job_page', { limit: 1 })[0].id);
assert.equal(seen.size, 2, 'both offers rotate');
assert.equal(placementEnabled({ affiliate_enabled: '0', aff_place_job_page: '1' }, 'job_page'), false);
assert.equal(placementEnabled({ affiliate_enabled: '1', aff_place_job_page: '1' }, 'job_page'), true);
assert.equal(placementEnabled({ affiliate_enabled: '1', aff_place_job_page: '1' }, 'nope'), false);

// ── destination building ──
const offer = { slug: 'py', destination_url: 'https://partner.example/c?aff=ME&sub={click_id}&o={offer}&pl={placement}' };
assert.equal(buildDestination(offer, { clickId: 'abc123', placement: 'job_page' }), 'https://partner.example/c?aff=ME&sub=abc123&o=py&pl=job_page');
assert.equal(buildDestination({ slug: 'x', destination_url: 'javascript:alert(1)' }, { clickId: 'a' }), '');
assert.ok(!buildDestination({ slug: 'a b&c', destination_url: 'https://p.example/?o={offer}' }, { clickId: 'a' }).includes(' '), 'placeholder values are encoded');

// ── rendering ──
const html = affiliateBlockHtml([{ slug: 'py', title: '<img src=x onerror=1>', description: '"quoted"', cta_label: 'Go', badge: '<b>', icon_key: 'bogus' }], { placement: 'job_page', disclosure: 'We <b>may</b> earn' });
assert.ok(html.includes('rel="sponsored nofollow noopener"'));
assert.ok(html.includes('/go/py?p=job_page'));
assert.ok(!html.includes('<img src=x') && !html.includes('<b>may') && html.includes('&lt;img'), 'all text escaped');
assert.equal(affiliateBlockHtml([], { placement: 'x' }), '');

// ── CRUD through the DB ──
assert.ok((await saveProgram(env, { name: 'Acme', status: 'active' })).ok);
assert.equal((await saveProgram(env, { name: '' })).ok, false);
assert.ok((await saveOffer(env, { program_id: 1, title: 'Python Course', slug: 'python-course', destination_url: 'https://partner.example/c?aff=ME&sub={click_id}', placements: ['job_page'], status: 'active' })).ok);
assert.match((await saveOffer(env, { program_id: 1, title: 'Dup', slug: 'python-course', destination_url: 'https://partner.example/' })).error, /slug/i, 'duplicate slug reported');
assert.equal((await deleteProgram(env, 1)).ok, false, 'program with offers cannot be deleted');
assert.equal((await listOffers(env)).length, 1);

// ── /go/ redirect ──
const goRequest = (path, headers = {}, method = 'GET') => new Request(`https://jobforion.test${path}`, { method, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari', 'CF-Connecting-IP': '203.0.113.7', ...headers } });
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const go = async (path, headers, method) => { const r = await handleAffiliateRoute(new URL(`https://jobforion.test${path}`), goRequest(path, headers, method), env, ctx); await Promise.all(pending.splice(0)); return r; };

await setSetting('affiliate_enabled', '0');
assert.equal((await go('/go/python-course')).status, 404, 'disabled → 404');
await setSetting('affiliate_enabled', '1');
let r = await go('/go/python-course?p=job_page');
assert.equal(r.status, 302);
const loc = new URL(r.headers.get('Location'));
assert.equal(loc.host, 'partner.example'); assert.equal(loc.searchParams.get('aff'), 'ME');
assert.match(loc.searchParams.get('sub'), /^[0-9a-f]{24}$/, 'fresh click id forwarded to the partner');
assert.equal(r.headers.get('Cache-Control'), 'no-store'); assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
assert.equal(db.prepare('SELECT SUM(clicks) c FROM aff_daily').get().c, 1);
assert.equal(db.prepare('SELECT COUNT(*) c FROM aff_clicks').get().c, 1);
assert.equal(db.prepare('SELECT placement p FROM aff_clicks').get().p, 'job_page');
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM aff_clicks').all()).includes('203.0.113.7'), 'raw IP never stored');

await go('/go/python-course?p=job_page', { 'User-Agent': 'Googlebot/2.1' });
await go('/go/python-course', {}, 'HEAD');
assert.equal(db.prepare('SELECT SUM(clicks) c FROM aff_daily').get().c, 1, 'bots and HEAD requests are redirected but not counted');
await go('/go/python-course?p=<script>');
assert.equal(db.prepare("SELECT COUNT(*) c FROM aff_daily WHERE placement='direct'").get().c, 1, 'unknown placement collapses to direct');
for (const bad of ['/go/', '/go/nope', '/go/..%2Fadmin', '/go/%E0%A4%A', '/go/python-course%00', '/go/Python_Course']) {
  const res = await go(bad);
  assert.equal(res.status, 404, `${bad} → 404`);
}
assert.equal((await go('/go/python-course', {}, 'POST')).status, 405);
// client can never choose the destination
const forged = await go('/go/python-course?p=job_page&url=https://evil.example&to=//evil.example&redirect=https://evil.example');
assert.equal(new URL(forged.headers.get('Location')).host, 'partner.example', 'redirect target ignores every query parameter');

// paused offer / inactive program stop redirecting
db.prepare("UPDATE aff_offers SET status='paused'").run();
assert.equal((await go('/go/python-course')).status, 404);
db.prepare("UPDATE aff_offers SET status='active'").run();
db.prepare("UPDATE aff_programs SET status='inactive'").run();
assert.equal((await go('/go/python-course')).status, 404);
db.prepare("UPDATE aff_programs SET status='active'").run();

// detail cap: counters keep counting, detail rows stop
await setSetting('aff_detail_clicks_per_day', '1');
const before = db.prepare('SELECT COUNT(*) c FROM aff_clicks').get().c;
await go('/go/python-course?p=blog_post', { 'CF-Connecting-IP': '198.51.100.9' });
assert.equal(db.prepare('SELECT COUNT(*) c FROM aff_clicks').get().c, before, 'detail rows capped');
assert.ok(db.prepare('SELECT SUM(clicks) c FROM aff_daily').get().c >= 3, 'counters unaffected by the cap');

// ── conversions ──
const clickId = db.prepare('SELECT click_id FROM aff_clicks LIMIT 1').get().click_id;
assert.ok((await addConversion(env, { click_id: clickId, amount: '25.00', status: 'approved' })).ok, 'offer resolved from click id');
assert.equal((await addConversion(env, { offer_id: 1, amount: 'x' })).ok, false);
assert.equal((await addConversion(env, { amount: '5' })).ok, false, 'needs an offer or a known click');
assert.equal((await addConversion(env, { click_id: 'deadbeef', amount: '5' })).ok, false, 'unknown click id rejected');
const imp = await importConversionsCsv(env, 'click_id,offer,amount,currency,status,note\n,python-course,10.50,USD,approved,"a, b"\n,nope,5,USD,approved,x\n,python-course,abc,USD,approved,x\n,python-course,7,EUR,pending,\n');
assert.deepEqual([imp.imported, imp.failed], [2, 2]);
assert.equal((await importConversionsCsv(env, 'foo,bar\n1,2')).ok, false);
assert.equal(parseCsv('a,b\n"x,1","y""z"\n')[1][1], 'y"z');
const stats = await getAffiliateStats(env, 30);
assert.equal(stats.earnings.USD, 3550, 'only approved USD amounts count (25.00 + 10.50)');
assert.equal(stats.earnings.EUR, undefined, 'pending EUR is not earnings');
assert.ok(stats.byOffer[0].clicks >= 3);
assert.equal(earningsPerClick(10, { USD: 5000 }), '$5.00');
assert.equal(earningsPerClick(10, { USD: 5000, EUR: 100 }), null, 'no EPC across currencies');

// ── retention ──
db.prepare("UPDATE aff_clicks SET created_at=datetime('now','-120 day')").run();
assert.ok((await cleanupAffiliate(env, 90)).deleted >= 1);
assert.equal(db.prepare('SELECT COUNT(*) c FROM aff_clicks').get().c, 0);

// ── admin page renders, escapes stored text, and reflects data ──
const { renderAffiliateContent } = await import('../src/pages/admin/affiliate.js');
db.prepare("UPDATE aff_offers SET title='<script>alert(1)</script>' WHERE id=1").run();
const page = await renderAffiliateContent(env, new URL('https://jobforion.test/admin/affiliate?days=30&edit_offer=1'));
assert.ok(!page.includes('<script>alert(1)</script>') && page.includes('&lt;script&gt;'), 'admin output escaped');
assert.ok(page.includes('/admin/affiliate/offers/save') && page.includes('/admin/affiliate/conversions/import'));
assert.ok(page.includes('enctype="multipart/form-data"'));

// ── admin redirect helper still strict ──
assert.equal(safeAdminRedirect('//evil.com'), '/admin/jobs');
console.log('affiliate tests: all assertions passed');
