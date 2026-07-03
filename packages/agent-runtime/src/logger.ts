import type { CaseId } from '@pkws/shared';

// Reuse the same ID format
function genLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

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
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

/**
 * Simple structured logger for PKWS.
 *
 * Singleton — use the exported `logger` instance.
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
    const id = genLogId();
    const dataJson = data ? JSON.stringify(data) : undefined;
    const caseId = (data?.caseId as string) || undefined;
    const jobId = (data?.jobId as string) || undefined;

    const entry: LogEntry = { id, timestamp, level, category, message, dataJson, caseId, jobId };

    // 1. Console output with colors
    const color = LEVEL_COLORS[level];
    const timeStr = timestamp.slice(11, 23);
    console.log(`${color}[${timeStr}] [${level.toUpperCase()}] [${category}]${RESET} ${message}`);

    // 2. Write to DB (fire-and-forget)
    if (this._isInitialized && this.db && this.schema) {
      try {
        this.db.insert(this.schema.logEntries).values({
          id, timestamp, level, category, message,
          dataJson: dataJson ?? null,
          caseId: caseId ?? null,
          jobId: jobId ?? null,
        }).run();
      } catch (err) {
        console.error(`[Logger] DB write failed:`, err);
      }
    }

    // 3. WebSocket broadcast
    this.wsBroadcast?.(entry);
  }
}

/** Singleton logger instance */
export const logger = new PKWSLogger();
