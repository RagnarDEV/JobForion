// Minimal Cloudflare D1 shim over node:sqlite — for local smoke tests only.
import { DatabaseSync } from 'node:sqlite';

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.db, this.sql, p.map(norm)); }
  _s() { return this.db.prepare(this.sql); }
  async all() {
    const rows = this._s().all(...this.params).map((r) => ({ ...r }));
    return { results: rows, success: true, meta: { changes: 0, rows_read: rows.length } };
  }
  async first(col) {
    const r = this._s().get(...this.params);
    if (!r) return null;
    return col ? r[col] : { ...r };
  }
  async run() {
    const r = this._s().run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
  }
  async raw() { return this._s().all(...this.params).map((r) => Object.values(r)); }
}

export class D1Shim {
  constructor() { this.db = new DatabaseSync(':memory:'); this.calls = 0; }
  prepare(sql) { this.calls++; return new Stmt(this.db, sql); }
  async exec(sql) { this.db.exec(sql); return { count: 1 }; }
  async batch(stmts) {
    const out = [];
    this.db.exec('BEGIN');
    try {
      for (const s of stmts) {
        const isSelect = /^\s*(select|pragma|with)/i.test(s.sql);
        out.push(isSelect ? await s.all() : await s.run());
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return out;
  }
}
