// Standing-read guard: per-isolate config caches revalidate against ONE revision row
// instead of re-reading every settings row every few minutes.
import assert from 'node:assert/strict';
import { D1Shim } from './helpers/d1-shim.mjs';
import { currentConfigRev, bumpConfigRev, useConfigEnv, resetConfigRevProbe, entryStillValid, REV_PROBE_MS, CONFIG_HARD_TTL_MS } from '../src/lib/platform/config-rev.js';
import { getSettings, setSettings } from '../src/lib/platform/settings.js';
import { memoConfig, clearConfigMemo } from '../src/lib/platform/config-memo.js';
import { memoStat, clearStatMemo } from '../src/lib/platform/stat-memo.js';

const env = { DB: new D1Shim() };
env.DB.db.exec('CREATE TABLE site_settings(key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
useConfigEnv(env);
let now = Date.UTC(2026, 9, 15, 10, 0, 0);
const realNow = Date.now; Date.now = () => now;
const tick = (ms) => { now += ms; };
const countingDb = () => { let n = 0; const o = env.DB.prepare.bind(env.DB); env.DB.prepare = (sql) => { if (/FROM site_settings/i.test(sql)) n++; return o(sql); }; return { reads: () => n, restore: () => { env.DB.prepare = o; } }; };

// 1. settings: full reload only when the revision moves (or after the hard TTL)
const spy = countingDb();
await getSettings(env);
const base = spy.reads();
for (let i = 0; i < 60; i++) { tick(30000); await getSettings(env); }              // 30 min of traffic on a warm isolate
assert.ok(spy.reads() - base <= 40, `~1 probe row/min, not a full reload every 5 min (statements: ${spy.reads() - base})`);
env.DB.db.prepare("INSERT OR REPLACE INTO site_settings(key,value) VALUES ('maintenance_message','changed directly')").run(); // no bump
tick(CONFIG_HARD_TTL_MS + 1000);
assert.equal((await getSettings(env)).maintenance_message, 'changed directly', 'hard TTL is the safety net for writers that never bump');

// 2. an admin write is visible immediately on this isolate and through the revision on others
await setSettings(env, { site_name: 'Alpha' });
assert.equal((await getSettings(env)).site_name, 'Alpha');
const before = await currentConfigRev();
env.DB.db.prepare("UPDATE site_settings SET value='Beta' WHERE key='site_name'").run();
await bumpConfigRev(env);                                                           // "another isolate" bumped it
resetConfigRevProbe();
tick(REV_PROBE_MS + 1000);
assert.notEqual(await currentConfigRev(), before, 'bump changes the revision');
assert.equal((await getSettings(env)).site_name, 'Beta', 'revision change forces a reload');

// 3. memoConfig: soft TTL → revalidate → reload only on change
clearConfigMemo(); resetConfigRevProbe();
let loads = 0;
const load = () => memoConfig('t:key', async () => ++loads);
assert.equal(await load(), 1); tick(60000); assert.equal(await load(), 1, 'inside soft TTL');
tick(200000); assert.equal(await load(), 1, 'past soft TTL but revision unchanged → still cached');
await bumpConfigRev(env); tick(130000);                                           // soft TTL (120 s) is the max staleness window
assert.equal(await load(), 2, 'revision bumped → reloaded');
tick(CONFIG_HARD_TTL_MS + 1000); assert.equal(await load(), 3, 'hard TTL → reloaded');

// 4. entryStillValid edge cases
assert.equal(await entryStillValid(null, 1000), false);
assert.equal(await entryStillValid({ at: now - 5000, rev: null }, 1000), false, 'entries without a revision expire at the soft TTL');

// 5. stat memo
clearStatMemo(); let counts = 0;
const stat = (force) => memoStat('k', async () => ++counts, { ttl: 600000, force });
assert.equal(await stat(), 1); tick(300000); assert.equal(await stat(), 1); assert.equal(await stat(true), 2, 'force refresh'); tick(700000); assert.equal(await stat(), 3);

Date.now = realNow;
spy.restore();
console.log('config-rev tests: all assertions passed');
