import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import fs from 'node:fs';

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqliteDb: Database.Database | null = null;

export function initStorage(workspacePath: string) {
  const dbDir = path.join(workspacePath, 'db');
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, 'pkws.sqlite');
  sqliteDb = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  dbInstance = drizzle(sqliteDb, { schema });

  // Run migrations
  const migrationsDir = path.join(import.meta.dirname, '..', 'drizzle');
  if (fs.existsSync(migrationsDir)) {
    migrate(dbInstance, { migrationsFolder: migrationsDir });
  }

  return dbInstance;
}

export function getDb() {
  if (!dbInstance) {
    throw new Error('Storage not initialized. Call initStorage() first.');
  }
  return dbInstance;
}

export function closeStorage() {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
    dbInstance = null;
  }
}

export { schema };
