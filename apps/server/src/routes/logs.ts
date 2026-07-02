import type { FastifyPluginAsync } from 'fastify';
import { logger } from '@pkws/agent-runtime';
import type { LogLevel, LogCategory } from '@pkws/agent-runtime';

/**
 * Log query API.
 *
 * GET /api/logs?level=info,warn&category=agent,worker&limit=50&offset=0&search=xxx&caseId=xxx
 * DELETE /api/logs?before=2026-07-01T00:00:00Z
 */
export const logRoutes: FastifyPluginAsync = async (app) => {
  // GET /logs — query log entries
  app.get('/logs', async (request) => {
    const query = request.query as Record<string, string>;

    const levels = query.level
      ? query.level.split(',').filter(Boolean) as LogLevel[]
      : undefined;
    const categories = query.category
      ? query.category.split(',').filter(Boolean) as LogCategory[]
      : undefined;
    const limit = Math.min(parseInt(query.limit || '100'), 500);
    const offset = parseInt(query.offset || '0');
    const caseId = query.caseId || undefined;
    const search = query.search || undefined;

    const result = await logger.query({ levels, categories, limit, offset, caseId, search });

    return {
      ok: true,
      data: result,
    };
  });

  // DELETE /logs — clear old log entries
  app.delete('/logs', async (request) => {
    const query = request.query as Record<string, string>;
    const before = query.before || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const { getDb, schema } = await import('@pkws/storage');
      const { lt, sql } = await import('drizzle-orm');
      const db = getDb();
      const result = db.delete(schema.logEntries)
        .where(lt(schema.logEntries.timestamp, before))
        .run();

      return {
        ok: true,
        data: { deletedCount: result.changes ?? 0, before },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: { code: 'DELETE_ERROR', message: err.message },
      };
    }
  });
};
