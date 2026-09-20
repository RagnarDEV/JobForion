// src/db/schema/migration-kit.js
// The resumable-migration machinery: the budget sentinel, makeSkippableDB()
// (position-counting D1 wrapper) and ensureColumn() (atomic PRAGMA+ALTER
// unit). Table definitions live in core-tables.js / ai-tables.js /
// account-tables.js; the orchestrator is ../schema.js.

export class SchemaBudgetExceeded extends Error {}

// makeSkippableDB() is the mechanism that makes the migration genuinely
// resumable (not just "safe to retry"): every raw CREATE TABLE / CREATE
// INDEX / seed-batch statement in ensureTable()/ensureAccountTables()/
// ensureAiTables() gets a sequential position. Positions at or below the
// persisted `migration_cursor` are SKIPPED ENTIRELY (0 real D1 calls) —
// not just "cheap to re-verify", genuinely not executed — because we
// already know, from having recorded that cursor, that they succeeded in
// an earlier request. This is what guarantees forward progress every
// single invocation regardless of how large the total migration grows,
// instead of every retry wastefully re-paying the cost of everything
// already done (which, once that replay cost alone exceeds the budget,
// would stall forever — a real failure mode this project hit and fixed).
export function makeSkippableDB(realDB, migCtx, budgetGuard) {
  function shouldSkip() {
    migCtx.position++;
    return migCtx.position <= migCtx.cursor;
  }
  function wrap(realStmt) {
    const w = {
      _real: realStmt,
      bind(...args) { w._real = w._real.bind(...args); return w; },
      async run() {
        if (shouldSkip()) return { success: true, meta: { changes: 0, last_row_id: 0 } };
        budgetGuard();
        return w._real.run();
      },
      async all() { budgetGuard(); return w._real.all(); },
      async first(col) { budgetGuard(); return w._real.first(col); },
      async raw() { budgetGuard(); return w._real.raw(); },
    };
    return w;
  }
  return {
    prepare(sql) { return wrap(realDB.prepare(sql)); },
    async batch(wrappedStmts) {
      if (shouldSkip()) return wrappedStmts.map(() => ({ success: true, meta: { changes: 0 } }));
      budgetGuard();
      return realDB.batch(wrappedStmts.map(s => s._real || s));
    },
    async exec(sql) { budgetGuard(); return realDB.exec(sql); },
  };
}

// ensureColumn() is called ~60 times across the tables below. Each call is
// treated as ONE atomic resumable unit sharing the same position counter
// as makeSkippableDB() above (env.__migCtx, when present — during a normal
// non-migration call from elsewhere, __migCtx is absent and this simply
// behaves exactly as before: unconditional PRAGMA-checked ALTER). This is
// what avoids the earlier stall where 60+ un-skippable PRAGMA reads alone
// (even with every CREATE TABLE already done) permanently exceeded any
// reasonably-sized per-invocation budget: skipping the ENTIRE PRAGMA+ALTER
// pair atomically for already-confirmed-complete columns means a request
// resuming past the CREATE TABLE section reaches genuinely new work
// immediately, instead of re-paying 60 read-only round-trips first.
export async function ensureColumn(env, table, column, definition) {
  const migCtx = env.__migCtx;
  if (migCtx) {
    migCtx.position++;
    if (migCtx.position <= migCtx.cursor) return; // confirmed done in an earlier request
  }
  const realDB = env.__realDB || env.DB;
  const budgetGuard = env.__budgetGuard || (() => {});
  try {
    budgetGuard();
    const { results } = await realDB.prepare(`PRAGMA table_info(${table})`).all();
    const exists = (results || []).some(r => r.name === column);
    if (!exists) {
      budgetGuard();
      await realDB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  } catch (e) {
    // IMPORTANT: budgetGuard() throws a private SchemaBudgetExceeded
    // sentinel when the per-invocation D1-call budget runs out — that
    // must propagate up to ensureAllSchema()'s handler (which persists
    // the resume point), not be swallowed here. Only genuine DB errors
    // (e.g. the table itself doesn't exist yet — CREATE TABLE IF NOT
    // EXISTS elsewhere handles that) are safe to ignore.
    if (e instanceof SchemaBudgetExceeded) throw e;
  }
}
