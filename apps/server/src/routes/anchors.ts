import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@pkws/storage';
import { eq } from 'drizzle-orm';

export const anchorRoutes: FastifyPluginAsync = async (app) => {
  // GET /anchors/:anchorId
  app.get('/anchors/:anchorId', async (request, reply) => {
    const { anchorId } = request.params as { anchorId: string };
    const db = getDb();

    const anchor = db.select()
      .from(schema.knowledgeAnchors)
      .where(eq(schema.knowledgeAnchors.id, anchorId))
      .get();

    if (!anchor) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: `Anchor not found: ${anchorId}` },
      });
    }

    const artifacts = db.select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.anchorId, anchorId))
      .all();

    const caseList = db.select()
      .from(schema.cases)
      .where(eq(schema.cases.anchorId, anchorId))
      .all();

    // Latest timeline events across cases
    const latestEvents = db.select()
      .from(schema.timelineEvents)
      .where(
        eq(schema.timelineEvents.caseId, caseList[0]?.id || '')
      )
      .limit(10)
      .all();

    return {
      ok: true,
      data: {
        anchor,
        artifacts,
        cases: caseList,
        latestTimelineEvents: latestEvents,
      },
    };
  });

  // POST /anchors/:anchorId/relink
  app.post('/anchors/:anchorId/relink', async (request, reply) => {
    const { anchorId } = request.params as { anchorId: string };
    const { newVaultPath } = request.body as { newVaultPath: string };
    const db = getDb();

    if (!newVaultPath) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'newVaultPath is required' },
      });
    }

    const now = new Date().toISOString();
    db.update(schema.knowledgeAnchors)
      .set({ currentVaultPath: newVaultPath, lastSeenAt: now, updatedAt: now })
      .where(eq(schema.knowledgeAnchors.id, anchorId))
      .run();

    return { ok: true, data: { success: true } };
  });
};
