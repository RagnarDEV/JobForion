// src/db/schema/state.js
// Per-isolate schema flags shared by the schema modules. They are plain
// in-memory optimisations ONLY — the persisted SCHEMA_VERSION row in D1
// (see ../schema.js) is authoritative. Kept in one object so the table
// modules and the orchestrator can all flip them without circular imports.
export const schemaState = {
  core: false,             // ensureTable() finished in this isolate
  ai: false,               // ensureAiTables() finished in this isolate
  account: false,          // ensureAccountTables() finished in this isolate
  versionConfirmed: false, // persisted SCHEMA_VERSION matched (or migration completed)
  ensurePromise: null,     // coalesces simultaneous cold-start requests
};
