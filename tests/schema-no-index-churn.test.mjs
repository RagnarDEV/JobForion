// A migration pass must never CREATE an index it later DROPs: on a real catalogue every such pair rebuilds the
// whole index (~12k written rows each) on every SCHEMA_VERSION bump (measured on production: 41k writes in a day).
import assert from 'node:assert/strict';
import { D1Shim } from './helpers/d1-shim.mjs';
import { ensureAllSchema } from '../src/db/schema.js';

const shim = new D1Shim();
const sqls = [];
const orig = shim.prepare.bind(shim);
shim.prepare = (sql) => { sqls.push(String(sql)); return orig(sql); };
await ensureAllSchema({ DB: shim, SCHEMA_MIGRATION_BUDGET: '1000' });

const created = new Set(), dropped = new Set();
for (const sql of sqls) {
  let m = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF NOT EXISTS\s+(\w+)/i.exec(sql); if (m) created.add(m[1]);
  m = /DROP\s+INDEX\s+IF EXISTS\s+(\w+)/i.exec(sql); if (m) dropped.add(m[1]);
}
assert.ok(created.size > 20 && dropped.size >= 3, 'migration statements were captured');
const churn = [...created].filter(n => dropped.has(n));
assert.deepEqual(churn, [], `indexes created then dropped in the same migration: ${churn.join(', ')}`);
console.log('schema-no-index-churn tests: all assertions passed');
