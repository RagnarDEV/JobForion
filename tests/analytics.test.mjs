import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ANALYTICS_EVENT_SET, dateRange, normalizeAnalyticsEvent, rowsToCsv } from '../src/lib/analytics.js';

assert.equal(ANALYTICS_EVENT_SET.has('page_view'), true);
assert.equal(ANALYTICS_EVENT_SET.has('payment_success'), true);
assert.equal(ANALYTICS_EVENT_SET.has('arbitrary_event'), false);

const event = normalizeAnalyticsEvent({ event_type: 'job_view', job_id: '42', user_id: 999, metadata: { query: 'remote dev', password: 'do-not-store', nested: { token: 'x', ok: 'yes' } } }, { user_id: 7, country: 'ae', timeZone: 'Asia/Dubai' });
assert.equal(event.job_id, 42);
assert.equal(event.user_id, 7);
assert.equal(event.country, 'AE');
assert.equal(JSON.parse(event.metadata).password, undefined);
assert.equal(JSON.parse(event.metadata).nested.token, undefined);
assert.equal(JSON.parse(event.metadata).nested.ok, 'yes');
assert.equal(normalizeAnalyticsEvent({ event_type: 'fake_revenue', metadata: { amount: 999999 } }), null);

const custom = dateRange({ preset: 'custom', from: '2026-01-01', to: '2026-01-31', timeZone: 'UTC' });
assert.deepEqual(custom, { preset: 'custom', from: '2026-01-01', to: '2026-01-31' });
assert.equal(dateRange({ preset: 'custom', from: '2026-02-01', to: '2026-01-01' }).preset, 'custom');
assert.match(dateRange({ preset: '7d' }).from, /^\d{4}-\d{2}-\d{2}$/);
assert.match(dateRange({ preset: 'today' }).to, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(rowsToCsv([{ key: 'x', events: 2, uniques: 1 }]), 'key,events,uniques\nx,2,1\n');
assert.equal(rowsToCsv([{ key: 'x,y', events: 2 }]), 'key,events\n"x,y",2\n');

const analytics = await readFile(new URL('../src/lib/analytics.js', import.meta.url), 'utf8');
const schema = await readFile(new URL('../src/db/schema.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/routes/api.router.js', import.meta.url), 'utf8');
const tracker = await readFile(new URL('../src/lib/analytics-tracker.js', import.meta.url), 'utf8');
assert.match(analytics, /analytics_event_queue/);
assert.match(analytics, /analytics_daily/);
assert.match(analytics, /LIMIT \?/);
assert.match(schema, /analytics_search_daily/);
assert.match(schema, /analytics_filter_daily/);
assert.match(schema, /analytics_alerts/);
assert.match(api, /\/api\/admin\/analytics/);
assert.match(api, /verifyAdminCookie/);
assert.match(tracker, /navigator\.sendBeacon/);
assert.doesNotMatch(tracker, /password|cvv|card_number/i);
console.log('analytics tests: all assertions passed');
