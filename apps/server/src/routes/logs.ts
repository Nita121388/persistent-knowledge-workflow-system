import type { FastifyPluginAsync } from 'fastify';
import { getDb, getClient, schema } from '@pkws/storage';
import { desc, eq, lt, sql } from 'drizzle-orm';

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

    const limit = Math.min(parseInt(query.limit || '100'), 500);
    const offset = parseInt(query.offset || '0');
    const levelFilter = query.level || '';
    const categoryFilter = query.category || '';
    const caseId = query.caseId || '';
    const search = query.search || '';

    try {
      const client = getClient();
      const conditions: string[] = [];
      const params: any[] = [];

      if (levelFilter) {
        const levels = levelFilter.split(',').filter(Boolean);
        conditions.push(`level IN (${levels.map(() => '?').join(',')})`);
        params.push(...levels);
      }
      if (categoryFilter) {
        const categories = categoryFilter.split(',').filter(Boolean);
        conditions.push(`category IN (${categories.map(() => '?').join(',')})`);
        params.push(...categories);
      }
      if (caseId) {
        conditions.push('case_id = ?');
        params.push(caseId);
      }
      if (search) {
        conditions.push('message LIKE ?');
        params.push(`%${search}%`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Use raw SQLite client for reliable results
      const totalResult = client.get<{ count: number }>(`SELECT COUNT(*) as count FROM log_entries ${where}`, params);
      const rows = client.all<any>(`SELECT * FROM log_entries ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);

      return {
        ok: true,
        data: {
          entries: rows || [],
          total: totalResult?.count ?? 0,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: { code: 'QUERY_ERROR', message: err.message },
      };
    }
  });

  // DELETE /logs — clear old log entries
  app.delete('/logs', async (request) => {
    const query = request.query as Record<string, string>;
    const before = query.before || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const client = getClient();
      const result = client.run('DELETE FROM log_entries WHERE timestamp < ?', [before]);

      return {
        ok: true,
        data: { deletedCount: result.rows, before },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: { code: 'DELETE_ERROR', message: err.message },
      };
    }
  });
};
