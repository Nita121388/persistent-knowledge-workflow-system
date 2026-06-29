import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@pkws/storage';
import { eq } from 'drizzle-orm';

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.get('/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const db = getDb();

    const job = db.select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId))
      .get();

    if (!job) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: `Job not found: ${jobId}` },
      });
    }

    return { ok: true, data: job as any };
  });

  app.get('/jobs', async (request) => {
    const db = getDb();
    const query = request.query as Record<string, string>;

    let result = db.select()
      .from(schema.jobs)
      .orderBy(schema.jobs.createdAt)
      .limit(50);

    if (query.status) {
      result = result.where(eq(schema.jobs.status, query.status as any));
    }

    const rows = result.all() as any;
    return { ok: true, data: rows };
  });
};
