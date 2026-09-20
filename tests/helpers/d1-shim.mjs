// Minimal Cloudflare D1 shim over node:sqlite — for local smoke tests only.
import { DatabaseSync } from 'node:sqlite';

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Stmt {
  constructor(db, sql, params = [], owner = null) { this.db = db; this.sql = sql; this.params = params; this.owner = owner; }
  bind(...p) { return new Stmt(this.db, this.sql, p.map(norm), this.owner); }
  _count() { if (this.owner) this.owner.count(); }
  _s() { return this.db.prepare(this.sql); }
  async all() { this._count();
    const rows = this._s().all(...this.params).map((r) => ({ ...r }));
    return { results: rows, success: true, meta: { changes: 0, rows_read: rows.length } };
  }
  async first(col) { this._count();
    const r = this._s().get(...this.params);
    if (!r) return null;
    return col ? r[col] : { ...r };
  }
  async run() { this._count();
    const r = this._s().run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
  }
  async raw() { this._count(); return this._s().all(...this.params).map((r) => Object.values(r)); }
}

export class D1Shim {
  constructor() { this.db = new DatabaseSync(':memory:'); this.calls = 0; this.reqCalls = 0; this.limit = 0; }
  prepare(sql) { return new Stmt(this.db, sql, [], this); }
  count() { this.calls++; this.reqCalls++; if (this.limit && this.reqCalls > this.limit) throw new Error('Too many subrequests by single Worker invocation.'); }
  startRequest(limit = 0) { this.reqCalls = 0; this.limit = limit; }
  async exec(sql) { this.db.exec(sql); return { count: 1 }; }
  async batch(stmts) {
    this.count();
    const out = [];
    this.db.exec('BEGIN');
    try {
      for (const s of stmts) {
        const isSelect = /^\s*(select|pragma|with)/i.test(s.sql);
        { const saved = s.owner; s.owner = null; out.push(isSelect ? await s.all() : await s.run()); s.owner = saved; }
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return out;
  }
}
