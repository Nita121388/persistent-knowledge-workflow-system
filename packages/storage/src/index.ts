import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema.js';
import { createNodeSqliteClient, type NodeSqliteClient } from './sqlite-client.js';
import path from 'node:path';
import fs from 'node:fs';

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqliteClient: NodeSqliteClient | null = null;

/**
 * Async batched SQL executor for drizzle-orm's sqlite-proxy.
 * The proxy expects an async function, and the executors all return Promises
 * that resolve to the required shape.
 */
function makeSqlExecutor(client: NodeSqliteClient) {
  return async (sql: string, params: any[], method: 'run' | 'all' | 'get' | 'values') => {
    switch (method) {
      case 'run': {
        const result = client.run(sql, params);
        return { rows: result.rows, insertId: result.insertId };
      }
      case 'all':
        return { rows: client.all(sql, params) as any[] };
      case 'get': {
        const row = client.get(sql, params);
        return { rows: row ? [row] : [] };
      }
      case 'values':
        return { rows: client.all(sql, params) as any[] };
      default:
        throw new Error(`SQLite proxy: unknown method '${method}'`);
    }
  };
}

export function initStorage(workspacePath: string) {
  const dbDir = path.join(workspacePath, 'db');
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, 'pkws.sqlite');

  // Create the underlying SQLite client (synchronous, using node:sqlite)
  sqliteClient = createNodeSqliteClient(dbPath);

  // Create drizzle proxy using the native client with async executor
  dbInstance = drizzle<typeof schema>(makeSqlExecutor(sqliteClient), { schema });

  // Run migrations
  const migrationsDir = path.join(import.meta.dirname, '..', 'drizzle');
  if (fs.existsSync(migrationsDir)) {
    runMigrations(migrationsDir);
  }

  return dbInstance;
}

function runMigrations(migrationsDir: string) {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Create migration tracking table
  sqliteClient!.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `);

  // Get already applied migrations
  const applied = new Set(
    sqliteClient!.all<{ file: string }>('SELECT file FROM __drizzle_migrations', [])
      .map(r => r.file)
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    // Split by statement-breakpoint (drizzle-kit separator)
    const statements = sql.split('--> statement-breakpoint');
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed) {
        sqliteClient!.exec(trimmed);
      }
    }

    // Record migration
    sqliteClient!.run(
      'INSERT INTO __drizzle_migrations (file, applied_at) VALUES (?, ?)',
      [file, new Date().toISOString()]
    );
  }
}

export function getDb() {
  if (!dbInstance) {
    throw new Error('Storage not initialized. Call initStorage() first.');
  }
  return dbInstance;
}

export function getClient() {
  if (!sqliteClient) {
    throw new Error('Storage not initialized. Call initStorage() first.');
  }
  return sqliteClient;
}

export function closeStorage() {
  if (sqliteClient) {
    sqliteClient.close();
    sqliteClient = null;
    dbInstance = null;
  }
}

export { schema };
