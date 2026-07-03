import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@pkws/storage';
import { InboxScanRequestSchema } from '@pkws/shared/utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';

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

    // Load inbox path to check pending files count
    const db = getDb();
    const settingsRow = await db.select().from(schema.settings).get();
    const inboxPath = settingsRow?.inboxPath || '';
    let pendingFiles = 0;
    if (inboxPath) {
      try {
        const entries = await fs.readdir(inboxPath);
        pendingFiles = entries.filter(e => e.endsWith('.md')).length;
      } catch {
        // Directory not accessible — proceed anyway
      }
    }

    const { createJob } = await import('../worker/job-queue.js');
    const job = await createJob({
      type: 'scan_inbox',
      payload: { mode: parsed.data.mode },
    });

    return {
      ok: true,
      data: {
        jobId: job.id,
        inboxPath,
        pendingFiles,
        message: pendingFiles > 0
          ? `Found ${pendingFiles} file(s) in inbox, scanning...`
          : 'Scanning inbox for new files...',
      },
    };
  });
};
