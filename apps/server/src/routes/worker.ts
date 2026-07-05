import type { FastifyPluginAsync } from 'fastify';

export const workerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/worker/status', async () => {
    return { ok: true, data: { status: 'running' } };
  });
};
