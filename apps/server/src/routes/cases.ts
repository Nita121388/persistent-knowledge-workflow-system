import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@pkws/storage';
import { eq, desc, like, inArray, and } from 'drizzle-orm';
import { CommentRequestSchema, ReopenRequestSchema, type CaseStatus } from '@pkws/shared';
import type { CaseDetail, CaseListItem } from '@pkws/shared';
import { genEventId } from '@pkws/shared/utils.js';
import { agentRuntime } from '../index.js';

export const caseRoutes: FastifyPluginAsync = async (app) => {
  // GET /cases — list cases with optional filters
  app.get('/cases', async (request) => {
    const query = request.query as Record<string, string>;
    const db = getDb();

    let conditions = [];

    // Queue filter: inbox / review / active / closed
    if (query.queue) {
      const statusMap: Record<string, CaseStatus[]> = {
        inbox: ['Captured', 'Analyzing'],
        review: ['ReviewRequired', 'NeedDiscussion', 'PatchPreview'],
        active: ['Approved', 'Applying'],
        closed: ['Done', 'Dropped', 'Rejected', 'Error', 'RolledBack'],
      };
      const statuses = statusMap[query.queue];
      if (statuses) {
        conditions.push(inArray(schema.cases.status, statuses));
      }
    }

    // Status filter
    if (query.status) {
      conditions.push(eq(schema.cases.status, query.status as CaseStatus));
    }

    // Text search
    if (query.q) {
      conditions.push(like(schema.cases.title, `%${query.q}%`));
    }

    const limit = Math.min(parseInt(query.limit || '50'), 200);
    const offset = parseInt(query.offset || '0');

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db.select()
      .from(schema.cases)
      .where(where)
      .orderBy(desc(schema.cases.updatedAt))
      .limit(limit)
      .offset(offset)
      .all();

    // Join anchor info for vault path
    const items: CaseListItem[] = rows.map(c => ({
      id: c.id as any,
      title: c.title,
      status: c.status as CaseStatus,
      anchorId: c.anchorId as any,
      currentVaultPath: '',
      updatedAt: c.updatedAt,
    }));

    // Fetch vault paths
    const anchorIds = [...new Set(items.map(i => i.anchorId))];
    if (anchorIds.length > 0) {
      const anchors = await db.select()
        .from(schema.knowledgeAnchors)
        .where(inArray(schema.knowledgeAnchors.id, anchorIds))
        .all();
      const anchorMap = new Map(anchors.map(a => [a.id, a.currentVaultPath]));
      for (const item of items) {
        item.currentVaultPath = anchorMap.get(item.anchorId) || '';
      }
    }

    return { ok: true, data: items };
  });

  // GET /cases/:caseId — full case detail
  app.get('/cases/:caseId', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const db = getDb();

    const caseRow = await db.select()
      .from(schema.cases)
      .where(eq(schema.cases.id, caseId))
      .get();

    if (!caseRow) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: `Case not found: ${caseId}` },
      });
    }

    const anchor = await db.select()
      .from(schema.knowledgeAnchors)
      .where(eq(schema.knowledgeAnchors.id, caseRow.anchorId))
      .get();

    const artifact = await db.select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, caseRow.primaryArtifactId))
      .get();

    const timeline = await db.select()
      .from(schema.timelineEvents)
      .where(eq(schema.timelineEvents.caseId, caseId))
      .orderBy(desc(schema.timelineEvents.createdAt))
      .limit(100)
      .all();

    let currentProposal = undefined;
    if (caseRow.currentProposalId) {
      const raw = await db.select()
        .from(schema.proposals)
        .where(eq(schema.proposals.id, caseRow.currentProposalId))
        .get() as any;
      if (raw) {
        currentProposal = {
          ...raw,
          suggestedActions: typeof raw.suggestedActions === 'string' ? JSON.parse(raw.suggestedActions) : raw.suggestedActions,
          risks: raw.risks ? (typeof raw.risks === 'string' ? JSON.parse(raw.risks) : raw.risks) : undefined,
          requiresPatch: !!raw.requiresPatch,
        };
      }
    }

    let currentPatch = undefined;
    if (caseRow.currentPatchId) {
      currentPatch = await db.select()
        .from(schema.patchManifests)
        .where(eq(schema.patchManifests.id, caseRow.currentPatchId))
        .get() as any;
    }

    const instructionSummary = await db.select()
      .from(schema.caseInstructionSummaries)
      .where(eq(schema.caseInstructionSummaries.caseId, caseId))
      .get() as any;

    const patchIntents = await db.select()
      .from(schema.patchIntents)
      .where(eq(schema.patchIntents.caseId, caseId))
      .orderBy(desc(schema.patchIntents.createdAt))
      .all() as any;

    const detail: CaseDetail = {
      case: caseRow as any,
      anchor: anchor as any,
      artifact: artifact as any,
      currentProposal,
      currentPatch,
      instructionSummary: instructionSummary || undefined,
      timeline: timeline as any,
      patchIntents,
    };

    return { ok: true, data: detail };
  });

  // POST /cases/:caseId/comment
  app.post('/cases/:caseId/comment', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const parsed = CommentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid comment', details: parsed.error.flatten() },
      });
    }

    const db = getDb();
    const { comment, updateInstructionSummary } = parsed.data;

    // Record timeline event
    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'user_commented',
      actor: 'user',
      summary: comment,
      dataJson: JSON.stringify({ updateInstructionSummary }),
      createdAt: new Date().toISOString(),
    }).run();

    // Update instruction summary if requested
    if (updateInstructionSummary) {
      const existing = await db.select()
        .from(schema.caseInstructionSummaries)
        .where(eq(schema.caseInstructionSummaries.caseId, caseId))
        .get();

      if (existing) {
        const oldSummary = existing.summary;
        db.update(schema.caseInstructionSummaries)
          .set({
            summary: `${oldSummary}\n- ${comment}`,
            updatedBy: 'user',
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.caseInstructionSummaries.caseId, caseId))
          .run();
      } else {
        db.insert(schema.caseInstructionSummaries).values({
          id: `cis_${caseId}`,
          caseId,
          summary: comment,
          updatedBy: 'user',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).run();
      }
    }

    // Update case status and create regeneration job, or route to Agent Runtime
    db.update(schema.cases)
      .set({
        status: 'NeedDiscussion',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.cases.id, caseId))
      .run();

    // If Agent Runtime is active, route the input there instead of via job queue
    if (agentRuntime) {
      // Load workspace rules and case instructions to pass to Agent Runtime
      const rules = await db.select()
        .from(schema.workspaceRules)
        .where(eq(schema.workspaceRules.enabled, true))
        .orderBy(schema.workspaceRules.priority)
        .all();

      const instructionSummary = await db.select()
        .from(schema.caseInstructionSummaries)
        .where(eq(schema.caseInstructionSummaries.caseId, caseId))
        .get();

      // Get the case to pass system context
      const caseRow = await db.select()
        .from(schema.cases)
        .where(eq(schema.cases.id, caseId))
        .get();

      // Enqueue the case in the Agent Runtime
      agentRuntime.enqueueCase(caseId, {
        workspaceRules: rules,
        caseInstructions: instructionSummary?.summary || '',
      });

      // Pass the user input to the scheduler
      agentRuntime.onUserInput(caseId, comment);

      return { ok: true, data: { success: true, mode: 'agent-runtime' } };
    }

    // Fallback: use the existing job queue path
    const { createJob } = await import('../worker/job-queue.js');
    await createJob({
      type: 'generate_proposal',
      payload: { caseId, reason: 'user_comment', comment },
    });

    return { ok: true, data: { success: true, mode: 'job-queue' } };
  });

  // POST /cases/:caseId/mark-done
  app.post('/cases/:caseId/mark-done', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const db = getDb();

    db.update(schema.cases)
      .set({ status: 'Done', closedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schema.cases.id, caseId))
      .run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'user_marked_done',
      actor: 'user',
      summary: 'User marked case as Done — no vault modifications needed',
      createdAt: new Date().toISOString(),
    }).run();

    return { ok: true, data: { success: true } };
  });

  // POST /cases/:caseId/drop
  app.post('/cases/:caseId/drop', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const db = getDb();

    db.update(schema.cases)
      .set({ status: 'Dropped', closedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schema.cases.id, caseId))
      .run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'user_dropped',
      actor: 'user',
      summary: 'User dropped this case',
      createdAt: new Date().toISOString(),
    }).run();

    return { ok: true, data: { success: true } };
  });

  // POST /cases/:caseId/reopen
  app.post('/cases/:caseId/reopen', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const parsed = ReopenRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
      });
    }

    const db = getDb();

    db.update(schema.cases)
      .set({ status: 'ReviewRequired', closedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.cases.id, caseId))
      .run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'case_created',
      actor: 'system',
      summary: `Case reopened: ${parsed.data.reason || 'No reason given'}`,
      createdAt: new Date().toISOString(),
    }).run();

    return { ok: true, data: { success: true } };
  });

  // POST /cases/:caseId/proposals/regenerate
  app.post('/cases/:caseId/proposals/regenerate', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const { createJob } = await import('../worker/job-queue.js');
    const job = await createJob({
      type: 'generate_proposal',
      payload: { caseId, reason: 'user_requested_regenerate' },
    });

    return { ok: true, data: { jobId: job.id } };
  });

  // POST /cases/:caseId/patch-intents
  app.post('/cases/:caseId/patch-intents', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const { PatchIntentRequestSchema: PISchema } = await import('@pkws/shared/utils.js');
    const parsed = PISchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid patch intent', details: parsed.error.flatten() },
      });
    }

    const db = getDb();
    const { genPatchIntentId } = await import('@pkws/shared/utils.js');

    const piId = genPatchIntentId();
    const now = new Date().toISOString();

    db.insert(schema.patchIntents).values({
      id: piId,
      caseId,
      action: parsed.data.action,
      instruction: parsed.data.instruction || null,
      targetPath: parsed.data.targetPath || null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }).run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'patch_intent_created',
      actor: 'user',
      summary: `User requested patch: ${parsed.data.action} ${parsed.data.targetPath || ''}`,
      createdAt: now,
    }).run();

    // Create job to generate the patch
    const { createJob } = await import('../worker/job-queue.js');
    const job = await createJob({
      type: 'generate_patch',
      payload: { caseId, patchIntentId: piId, action: parsed.data.action },
    });

    return { ok: true, data: { patchIntentId: piId, jobId: job.id } };
  });

  // GET /cases/:caseId/proposals
  app.get('/cases/:caseId/proposals', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const db = getDb();

    const proposals = await db.select()
      .from(schema.proposals)
      .where(eq(schema.proposals.caseId, caseId))
      .orderBy(desc(schema.proposals.createdAt))
      .all() as any;

    return { ok: true, data: proposals };
  });

  // GET /cases/:caseId/patch-intents
  app.get('/cases/:caseId/patch-intents', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const db = getDb();

    const intents = await db.select()
      .from(schema.patchIntents)
      .where(eq(schema.patchIntents.caseId, caseId))
      .orderBy(desc(schema.patchIntents.createdAt))
      .all() as any;

    return { ok: true, data: intents };
  });

  // GET /cases/:caseId/patches/:patchId
  app.get('/cases/:caseId/patches/:patchId', async (request, reply) => {
    const { patchId } = request.params as { patchId: string };
    const db = getDb();

    const patch = await db.select()
      .from(schema.patchManifests)
      .where(eq(schema.patchManifests.id, patchId))
      .get() as any;

    if (!patch) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Patch not found' },
      });
    }

    const operations = JSON.parse(patch.operationsJson);
    const affectedFiles: string[] = [];
    for (const op of operations) {
      if (op.type === 'create_file') affectedFiles.push(op.path);
      else if (op.type === 'update_file') affectedFiles.push(op.path);
      else if (op.type === 'move_file') affectedFiles.push(op.fromPath, op.toPath);
    }

    return {
      ok: true,
      data: {
        id: patch.id,
        status: patch.status,
        operations,
        affectedFiles: [...new Set(affectedFiles)],
        previewJson: patch.previewJson ? JSON.parse(patch.previewJson) : undefined,
      },
    };
  });

  // POST /cases/:caseId/patches/:patchId/reject
  app.post('/cases/:caseId/patches/:patchId/reject', async (request, reply) => {
    const { caseId, patchId } = request.params as { caseId: string; patchId: string };
    const db = getDb();

    db.update(schema.patchManifests)
      .set({ status: 'rejected', updatedAt: new Date().toISOString() })
      .where(eq(schema.patchManifests.id, patchId))
      .run();

    db.update(schema.cases)
      .set({ status: 'ReviewRequired', updatedAt: new Date().toISOString() })
      .where(eq(schema.cases.id, caseId))
      .run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'patch_rejected',
      actor: 'user',
      summary: 'User rejected the patch',
      createdAt: new Date().toISOString(),
    }).run();

    return { ok: true, data: { success: true } };
  });

  // POST /cases/:caseId/patches/:patchId/approve-apply
  app.post('/cases/:caseId/patches/:patchId/approve-apply', async (request, reply) => {
    const { caseId, patchId } = request.params as { caseId: string; patchId: string };
    const db = getDb();

    const patch = await db.select()
      .from(schema.patchManifests)
      .where(eq(schema.patchManifests.id, patchId))
      .get();

    if (!patch) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Patch not found' },
      });
    }

    if (patch.status !== 'preview') {
      return reply.status(400).send({
        ok: false,
        error: { code: 'PATCH_NOT_APPROVED', message: `Patch status is '${patch.status}', expected 'preview'` },
      });
    }

    // Approve and create apply job
    db.update(schema.patchManifests)
      .set({ status: 'approved', updatedAt: new Date().toISOString() })
      .where(eq(schema.patchManifests.id, patchId))
      .run();

    db.update(schema.cases)
      .set({ status: 'Approved', updatedAt: new Date().toISOString() })
      .where(eq(schema.cases.id, caseId))
      .run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'patch_approved',
      actor: 'user',
      summary: 'User approved the patch',
      createdAt: new Date().toISOString(),
    }).run();

    const { createJob } = await import('../worker/job-queue.js');
    const job = await createJob({
      type: 'apply_patch',
      payload: { caseId, patchManifestId: patchId },
    });

    return { ok: true, data: { jobId: job.id } };
  });

  // POST /cases/:caseId/rollback
  app.post('/cases/:caseId/rollback', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const db = getDb();

    // Find the latest apply manifest for this case
    const apply = await db.select()
      .from(schema.applyManifests)
      .where(eq(schema.applyManifests.caseId, caseId))
      .orderBy(desc(schema.applyManifests.appliedAt))
      .get();

    if (!apply) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'No apply manifest found for rollback' },
      });
    }

    if (apply.status === 'rolled_back') {
      return reply.status(400).send({
        ok: false,
        error: { code: 'CONFLICT', message: 'This apply has already been rolled back' },
      });
    }

    db.update(schema.cases)
      .set({ status: 'RolledBack', updatedAt: new Date().toISOString() })
      .where(eq(schema.cases.id, caseId))
      .run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'rollback_requested',
      actor: 'user',
      summary: `User requested rollback of apply ${apply.id}`,
      createdAt: new Date().toISOString(),
    }).run();

    const { createJob } = await import('../worker/job-queue.js');
    const job = await createJob({
      type: 'rollback_apply',
      payload: { caseId, applyManifestId: apply.id },
    });

    return { ok: true, data: { jobId: job.id } };
  });

  // GET /cases/:caseId/timeline
  app.get('/cases/:caseId/timeline', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const db = getDb();

    const events = await db.select()
      .from(schema.timelineEvents)
      .where(eq(schema.timelineEvents.caseId, caseId))
      .orderBy(desc(schema.timelineEvents.createdAt))
      .limit(200)
      .all() as any;

    return { ok: true, data: events };
  });
};
