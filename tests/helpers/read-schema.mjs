// The D1 schema lives in src/db/schema.js (orchestrator) + src/db/schema/*.js
// (table definitions). Tests that assert on DDL read them as one source.
import fs from 'node:fs';
const dir = new URL('../../src/db/schema/', import.meta.url);
export function readSchemaSource() {
  const parts = [fs.readFileSync(new URL('../../src/db/schema.js', import.meta.url), 'utf8')];
  for (const name of fs.readdirSync(dir).sort()) if (name.endsWith('.js')) parts.push(fs.readFileSync(new URL(name, dir), 'utf8'));
  return parts.join('\n');
}
