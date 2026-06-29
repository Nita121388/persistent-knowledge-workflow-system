import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@pkws/storage';
import { InboxScanRequestSchema } from '@pkws/shared/utils.js';

export const inboxRoutes: FastifyPluginAsync = async (app) => {
  app.post('/inbox/scan', async (request, reply) => {
    const parsed = InboxScanRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid scan request',
          details: parsed.error.flatten(),
        },
      });
    }

    const { createJob } = await import('../worker/job-queue.js');
    const job = await createJob({
      type: 'scan_inbox',
      payload: { mode: parsed.data.mode },
    });

    return {
      ok: true,
      data: { jobId: job.id },
    };
  });
};
