import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/**
 * Wraps Node.js built-in `node:sqlite` DatabaseSync to provide an API
 * that drizzle-orm's sqlite-proxy driver can talk to.
 */
export function createNodeSqliteClient(dbPath: string) {
  const db = new DatabaseSync(dbPath);

  // Enable WAL + foreign keys
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  // Map of prepared statements for reuse
  const stmtCache = new Map<string, ReturnType<typeof db.prepare>>();

  function getStmt(sql: string) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  /** Normalize params: node:sqlite doesn't accept booleans, convert to 0/1. */
  function normalizeParams(params: any[]): any[] {
    return params.map(p => {
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p;
    });
  }

  return {
    db,

    /** Run SQL and return affected rows. */
    run(sql: string, params: any[]): { rows: number; insertId?: number | bigint } {
      const stmt = getStmt(sql);
      const result = stmt.run(...normalizeParams(params));
      return { rows: Number(result.changes), insertId: result.lastInsertRowid };
    },

    /** Return all matching rows. */
    all<T = Record<string, unknown>>(sql: string, params: any[]): T[] {
      const stmt = getStmt(sql);
      return stmt.all(...normalizeParams(params)) as T[];
    },

    /** Return first matching row. */
    get<T = Record<string, unknown>>(sql: string, params: any[]): T | undefined {
      const stmt = getStmt(sql);
      return stmt.get(...normalizeParams(params)) as T | undefined;
    },

    /** Execute raw SQL (for DDL, migrations, etc). */
    exec(sql: string): void {
      db.exec(sql);
    },

    /** Run a callback inside a transaction. */
    transaction<T>(fn: () => T): T {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    close() {
      stmtCache.clear();
      db.close();
    },
  };
}

export type NodeSqliteClient = ReturnType<typeof createNodeSqliteClient>;
