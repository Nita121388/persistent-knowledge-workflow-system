import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@pkws/storage';
import { eq } from 'drizzle-orm';
import { WorkspaceRuleCreateSchema, WorkspaceRuleUpdateSchema } from '@pkws/shared/utils.js';

export const workspaceRuleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/workspace-rules', async () => {
    const db = getDb();
    const rules = await db.select()
      .from(schema.workspaceRules)
      .orderBy(schema.workspaceRules.priority)
      .all() as any;
    return { ok: true, data: rules };
  });

  app.post('/workspace-rules', async (request, reply) => {
    const parsed = WorkspaceRuleCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid rule', details: parsed.error.flatten() },
      });
    }

    const db = getDb();
    const now = new Date().toISOString();
    const ruleId = `rule_${Date.now().toString(36)}`;

    db.insert(schema.workspaceRules).values({
      id: ruleId,
      title: parsed.data.title,
      content: parsed.data.content,
      enabled: parsed.data.enabled,
      priority: parsed.data.priority,
      createdAt: now,
      updatedAt: now,
    }).run();

    return { ok: true, data: { id: ruleId, ...parsed.data } };
  });

  app.put('/workspace-rules/:ruleId', async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    const parsed = WorkspaceRuleUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid update', details: parsed.error.flatten() },
      });
    }

    const db = getDb();
    db.update(schema.workspaceRules)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(schema.workspaceRules.id, ruleId))
      .run();

    return { ok: true, data: { success: true } };
  });

  app.delete('/workspace-rules/:ruleId', async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    const db = getDb();
    db.delete(schema.workspaceRules)
      .where(eq(schema.workspaceRules.id, ruleId))
      .run();
    return { ok: true, data: { success: true } };
  });
};
