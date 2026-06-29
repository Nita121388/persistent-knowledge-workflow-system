import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    const dbOk = fs.existsSync('/tmp'); // basic check, DB init handled by storage
    return {
      ok: true,
      data: {
        status: dbOk ? 'ok' : 'degraded',
        version: '0.1.0',
      },
    };
  });
};
