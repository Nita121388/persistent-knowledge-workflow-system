import type { CaseId } from '@pkws/shared';
import { genEventId } from '@pkws/shared/utils.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'system' | 'api' | 'agent' | 'worker' | 'ai' | 'db' | 'ws' | 'user';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  dataJson?: string;
  caseId?: string;
  jobId?: string;
}

type WsLogCallback = (entry: LogEntry) => void;

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',   // gray
  info: '\x1b[36m',    // cyan
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

/**
 * Simple structured logger for PKWS.
 *
 * Singleton — use the exported `logger` instance.
 * Writes to:
 * 1. SQLite (via Drizzle) for persistence and query
 * 2. stdout (colored, timestamped) for dev visibility
 * 3. WebSocket (via callback) for real-time frontend
 */
class PKWSLogger {
  private db: any = null;
  private schema: any = null;
  private wsBroadcast: WsLogCallback | null = null;
  private _isInitialized = false;

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  init(db: any, schema: any): void {
    this.db = db;
    this.schema = schema;
    this._isInitialized = true;
    this.info('system', 'Logger initialized');
  }

  setWsBroadcast(fn: WsLogCallback): void {
    this.wsBroadcast = fn;
  }

  debug(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('debug', category, message, data);
  }

  info(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('info', category, message, data);
  }

  warn(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('warn', category, message, data);
  }

  error(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('error', category, message, data);
  }

  private log(level: LogLevel, category: LogCategory, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const dataJson = data ? JSON.stringify(data) : undefined;
    const caseId = (data?.caseId as string) || undefined;
    const jobId = (data?.jobId as string) || undefined;

    const entry: LogEntry = {
      id, timestamp, level, category, message,
      dataJson, caseId, jobId,
    };

    // 1. Console output with colors
    const color = LEVEL_COLORS[level];
    const timeStr = timestamp.slice(11, 23); // HH:MM:SS.mmm
    console.log(`${color}[${timeStr}] [${level.toUpperCase()}] [${category}]${RESET} ${message}`);

    // 2. Write to DB (fire-and-forget)
    if (this._isInitialized && this.db && this.schema) {
      try {
        this.db.insert(this.schema.logEntries).values({
          id,
          timestamp,
          level,
          category,
          message,
          dataJson: dataJson ?? null,
          caseId: caseId ?? null,
          jobId: jobId ?? null,
        }).run();
      } catch (err) {
        // Don't recursively log errors — just console it
        console.error(`[Logger] DB write failed:`, err);
      }
    }

    // 3. WebSocket broadcast
    this.wsBroadcast?.(entry);
  }

  /**
   * Query log entries with filters.
   */
  async query(opts: {
    levels?: LogLevel[];
    categories?: LogCategory[];
    limit?: number;
    offset?: number;
    caseId?: string;
    search?: string;
    before?: string;
  } = {}): Promise<{ entries: LogEntry[]; total: number }> {
    if (!this._isInitialized || !this.db || !this.schema) {
      return { entries: [], total: 0 };
    }

    const { and, desc, like, eq, inArray, sql } = await import('drizzle-orm');
    const conditions: any[] = [];

    if (opts.levels && opts.levels.length > 0) {
      conditions.push(inArray(this.schema.logEntries.level, opts.levels));
    }
    if (opts.categories && opts.categories.length > 0) {
      conditions.push(inArray(this.schema.logEntries.category, opts.categories));
    }
    if (opts.caseId) {
      conditions.push(eq(this.schema.logEntries.caseId, opts.caseId));
    }
    if (opts.search) {
      conditions.push(like(this.schema.logEntries.message, `%${opts.search}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    try {
      const total = this.db.select({ count: sql<number>`count(*)` })
        .from(this.schema.logEntries)
        .where(where)
        .get();

      const rows = this.db.select()
        .from(this.schema.logEntries)
        .where(where)
        .orderBy(desc(this.schema.logEntries.timestamp))
        .limit(limit)
        .offset(offset)
        .all();

      return {
        entries: rows as LogEntry[],
        total: total?.count ?? 0,
      };
    } catch (err) {
      console.error('[Logger] Query failed:', err);
      return { entries: [], total: 0 };
    }
  }
}

/** Singleton logger instance */
export const logger = new PKWSLogger();
