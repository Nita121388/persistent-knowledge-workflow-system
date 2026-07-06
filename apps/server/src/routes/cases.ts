import type { FastifyPluginAsync } from 'fastify';
import { exec } from 'node:child_process';
import { getDb, schema } from '@pkws/storage';
import { eq, desc, like, inArray, and } from 'drizzle-orm';
import { CommentRequestSchema, InvokeNextRequestSchema, type CaseId, type CaseStatus } from '@pkws/shared';
import type { CaseDetail, CaseListItem, ProposedNextAction } from '@pkws/shared';
import { genEventId, ReopenRequestSchema } from '@pkws/shared/utils.js';
import { agentRuntime } from '../index.js';

/**
 * Load the vault path from settings for Obsidian URI use.
 */
function getVaultPath(): string {
  try {
    const db = getDb();
    const row = db.select().from(schema.settings).get();
    return (row as any)?.vaultPath || '';
  } catch {
    return '';
  }
}

export const caseRoutes: FastifyPluginAsync = async (app) => {
  // GET /cases — list cases with optional filters
  app.get('/cases', async (request) => {
    const query = request.query as Record<string, string>;
    const db = getDb();

    let conditions = [];

    // Queue filter: inbox / review / active / closed
    // PatchPreview is a legacy patch-orchestration status (line 1). Under
    // the unified ai_turn model it no longer enters the review queue, so it
    // is bucketed into `closed` along with other patch-era terminal states
    // (Approved / Applying / RolledBack), whose agent-runtime writers will
    // be retired in task #16. Until then they only ever appear on legacy
    // rows already in the DB.
    if (query.queue) {
      const statusMap: Record<string, CaseStatus[]> = {
        inbox: ['Captured', 'Analyzing'],
        review: ['ReviewRequired', 'NeedDiscussion'],
        active: ['Approved', 'Applying'],
        closed: ['Done', 'Dropped', 'Rejected', 'Error', 'RolledBack', 'PatchPreview'],
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
          proposedNextActions: typeof raw.proposedNextActions === 'string' ? JSON.parse(raw.proposedNextActions) : raw.proposedNextActions,
          risks: raw.risks ? (typeof raw.risks === 'string' ? JSON.parse(raw.risks) : raw.risks) : undefined,
        };
      }
    }

    const instructionSummary = await db.select()
      .from(schema.caseInstructionSummaries)
      .where(eq(schema.caseInstructionSummaries.caseId, caseId))
      .get() as any;

    // Line 2 / task #13: pull per-node AI runs for transparency UI. Newest
    // first; capped to keep payloads bounded (the AiRunList is virtualized
    // client-side, but the API response should not be uncapped).
    const aiRunRows = await db.select()
      .from(schema.aiRuns)
      .where(eq(schema.aiRuns.caseId, caseId))
      .orderBy(desc(schema.aiRuns.createdAt))
      .limit(200)
      .all() as any[];
    const aiRuns = aiRunRows.map(row => ({
      ...row,
      // Storage persists these as TEXT (JSON); caseDetail route already
      // applies the same parse pattern for currentProposal fields.
      proposedNextActionsJson: row.proposedNextActionsJson ?? undefined,
    }));

    const detail: CaseDetail = {
      case: caseRow as any,
      anchor: anchor as any,
      artifact: artifact as any,
      vaultPath: getVaultPath(),
      currentProposal,
      instructionSummary: instructionSummary || undefined,
      timeline: timeline as any,
      aiRuns: aiRuns as any,
    };

    return { ok: true, data: detail };
  });

  // POST /cases/:caseId/ai-runs/:runId/open-transcript
  // Opens this AI run's transcript jsonl in the user's default editor.
  // Only meaningful for runs whose CLI wrote a transcript file (Claude Code /
  // Codex headless). generate_proposal-path rows have no transcript and
  // return 409.
  app.post('/cases/:caseId/ai-runs/:runId/open-transcript', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const db = getDb();
    const row = db.select()
      .from(schema.aiRuns)
      .where(eq(schema.aiRuns.id, runId))
      .get() as any;
    if (!row) {
      reply.code(404); return { ok: false, error: 'ai_run_not_found' };
    }
    const p = row.transcriptPath;
    if (!p) {
      reply.code(409);
      return {
        ok: false,
        error: 'no_transcript',
        message: 'This AI run used an API call (no CLI session file) or the transcript path is unavailable.',
      };
    }
    // Open with the OS's default JSONL handler. On Windows the leading "" is
    // required so `start` doesn't treat a quoted path as a window title.
    const platform = process.platform;
    const cmd = platform === 'win32'
      ? `start "" "${p}"`
      : platform === 'darwin'
        ? `open "${p}"`
        : `xdg-open "${p}"`;
    exec(cmd, (err) => {
      if (err) {
        request.log.error({ err, cmd }, 'failed to open transcript');
      }
    });
    return {
      ok: true,
      data: { transcriptPath: p, sessionId: row.sessionId, agentId: row.agentId },
    };
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

    // Cancel any existing pending/queued generate_proposal jobs for this case
    // to prevent race conditions when user submits multiple comments
    const { createJob } = await import('../worker/job-queue.js');
    const existingJobs = await db.select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.type, 'generate_proposal'),
          like(schema.jobs.payloadJson, `%${caseId}%`),
          inArray(schema.jobs.status, ['queued', 'running'])
        )
      )
      .all();
    for (const oldJob of existingJobs) {
      db.update(schema.jobs)
        .set({ status: 'cancelled', finishedAt: new Date().toISOString() })
        .where(eq(schema.jobs.id, oldJob.id))
        .run();
    }

    // Fallback: use the existing job queue path
    await createJob({
      type: 'generate_proposal',
      payload: { caseId, reason: 'user_comment', comment },
    });

    return { ok: true, data: { success: true, mode: 'job-queue' } };
  });

  // POST /cases/:caseId/invoke-next
  // User picked one of the AI-proposed next-step buttons (ProposedNextAction).
  // The backend looks up the picked action in the case's current proposal,
  // feeds the action's intent/sideEffect/payload back to the next AI turn as
  // user input, then enqueues a regenerate — same shape as /comment.
  // Vault writing, when applicable (sideEffect == 'modify_vault'), is
  // performed by the next AI turn itself (handled by line 5 sandbox changes),
  // NOT by this route.
  app.post('/cases/:caseId/invoke-next', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const parsed = InvokeNextRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid invoke-next request', details: parsed.error.flatten() },
      });
    }

    const db = getDb();
    const { actionId, feedback } = parsed.data;

    // Look up the picked action on the case's current proposal
    const caseRow = await db.select()
      .from(schema.cases)
      .where(eq(schema.cases.id, caseId))
      .get();
    if (!caseRow) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Case not found' },
      });
    }

    let action: ProposedNextAction | undefined;
    if (caseRow.currentProposalId) {
      const proposalRow = await db.select()
        .from(schema.proposals)
        .where(eq(schema.proposals.id, caseRow.currentProposalId))
        .get() as any;
      if (proposalRow) {
        const actions = typeof proposalRow.proposedNextActions === 'string'
          ? JSON.parse(proposalRow.proposedNextActions)
          : proposalRow.proposedNextActions;
        action = (actions as ProposedNextAction[])?.find(a => a?.id === actionId);
      }
    }

    if (!action) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'ACTION_NOT_FOUND', message: `Action ${actionId} not found on case's current proposal` },
      });
    }

    // Compose the user-input string that the next AI turn will receive.
    // The picked action's intent/sideEffect/payload are echoed back so the
    // next-turn AI sees what it proposed last turn and what the user picked.
    const pickedMessage = [
      `[User picked action: ${action.label}]`,
      `intent: ${action.intent}`,
      `sideEffect: ${action.sideEffect}`,
      action.description ? `description: ${action.description}` : '',
      action.payload ? `payload: ${action.payload}` : '',
      feedback ? `user feedback: ${feedback}` : '',
    ].filter(Boolean).join('\n');

    // Record timeline event
    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'user_commented',
      actor: 'user',
      summary: pickedMessage,
      dataJson: JSON.stringify({
        actionId,
        intent: action.intent,
        sideEffect: action.sideEffect,
        payload: action.payload,
        feedback,
      }),
      createdAt: new Date().toISOString(),
    }).run();

    // Update case status
    db.update(schema.cases)
      .set({
        status: 'NeedDiscussion',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.cases.id, caseId))
      .run();

    // If Agent Runtime is active, route the input there
    if (agentRuntime) {
      const rules = await db.select()
        .from(schema.workspaceRules)
        .where(eq(schema.workspaceRules.enabled, true))
        .orderBy(schema.workspaceRules.priority)
        .all();

      const instructionSummary = await db.select()
        .from(schema.caseInstructionSummaries)
        .where(eq(schema.caseInstructionSummaries.caseId, caseId))
        .get();

      agentRuntime.enqueueCase(caseId as CaseId, {
        workspaceRules: rules,
        caseInstructions: instructionSummary?.summary || '',
      });
      agentRuntime.onUserInput(caseId as CaseId, pickedMessage);

      return { ok: true, data: { success: true, mode: 'agent-runtime', action } };
    }

    // Fallback: cancel existing queued/running generate_proposal jobs, then enqueue a new one
    const { createJob } = await import('../worker/job-queue.js');
    const existingJobs = await db.select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.type, 'generate_proposal'),
          like(schema.jobs.payloadJson, `%${caseId}%`),
          inArray(schema.jobs.status, ['queued', 'running'])
        )
      )
      .all();
    for (const oldJob of existingJobs) {
      db.update(schema.jobs)
        .set({ status: 'cancelled', finishedAt: new Date().toISOString() })
        .where(eq(schema.jobs.id, oldJob.id))
        .run();
    }

    await createJob({
      type: 'generate_proposal',
      payload: {
        caseId,
        reason: 'user_invoke_next',
        actionId,
        message: pickedMessage,
      },
    });

    return { ok: true, data: { success: true, mode: 'job-queue', action } };
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

  // POST /cases/:caseId/analyze — trigger AI analysis from Captured state
  app.post('/cases/:caseId/analyze', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const db = getDb();

    const caseRow = await db.select()
      .from(schema.cases)
      .where(eq(schema.cases.id, caseId))
      .get();

    if (!caseRow) {
      return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Case not found' } });
    }

    if (caseRow.status !== 'Captured') {
      return reply.status(400).send({ ok: false, error: { code: 'WRONG_STATUS', message: 'Only Captured cases can be analyzed' } });
    }

    // Update status to Analyzing
    db.update(schema.cases)
      .set({ status: 'Analyzing', updatedAt: new Date().toISOString() })
      .where(eq(schema.cases.id, caseId))
      .run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'ai_proposal_started',
      actor: 'system',
      summary: 'User triggered AI analysis',
      createdAt: new Date().toISOString(),
    }).run();

    // Route to Agent Runtime or Job Queue
    if (agentRuntime) {
      const rules = await db.select()
        .from(schema.workspaceRules)
        .where(eq(schema.workspaceRules.enabled, true))
        .orderBy(schema.workspaceRules.priority)
        .all();

      const instructionSummary = await db.select()
        .from(schema.caseInstructionSummaries)
        .where(eq(schema.caseInstructionSummaries.caseId, caseId))
        .get();

      agentRuntime.enqueueCase(caseId, {
        workspaceRules: rules,
        caseInstructions: instructionSummary?.summary || '',
      });

      agentRuntime.onUserInput(caseId, 'Analyze this case and generate a proposal.');
      return { ok: true, data: { success: true, mode: 'agent-runtime' } };
    }

    // Fallback: use job queue
    const { createJob } = await import('../worker/job-queue.js');
    await createJob({
      type: 'generate_proposal',
      payload: { caseId, reason: 'user_requested_analysis' },
    });

    return { ok: true, data: { success: true, mode: 'job-queue' } };
  });

  // POST /cases/:caseId/cancel-analysis — cancel an ongoing analysis
  app.post('/cases/:caseId/cancel-analysis', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const db = getDb();

    const caseRow = await db.select()
      .from(schema.cases)
      .where(eq(schema.cases.id, caseId))
      .get();

    if (!caseRow) {
      return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Case not found' } });
    }

    if (caseRow.status !== 'Analyzing') {
      return reply.status(400).send({ ok: false, error: { code: 'WRONG_STATUS', message: 'Only Analyzing cases can be cancelled' } });
    }

    // Update status back to Captured
    db.update(schema.cases)
      .set({ status: 'Captured', updatedAt: new Date().toISOString() })
      .where(eq(schema.cases.id, caseId))
      .run();

    // Record timeline event
    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'error_occurred',
      actor: 'user',
      summary: 'User cancelled analysis',
      createdAt: new Date().toISOString(),
    }).run();

    // Cancel any pending jobs for this case
    db.update(schema.jobs)
      .set({ status: 'cancelled', finishedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.jobs.type, 'generate_proposal'),
          eq(schema.jobs.status, 'queued'),
        )
      )
      .run();

    // If Agent Runtime is running, detach the case
    if (agentRuntime) {
      await agentRuntime.detachCase(caseId);
    }

    return { ok: true, data: { success: true } };
  });

  // POST /cases/:caseId/proposals/regenerate
  // Resembles /comment (cases.ts above) but without the comment-text write:
  // we just want the AI to regenerate the proposal based on the latest
  // context. Routes through the Agent Runtime when it is active, else falls
  // back to the legacy generate_proposal job queue.
  app.post('/cases/:caseId/proposals/regenerate', async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const db = getDb();

    // If Agent Runtime is active, route the input there. Same shape as
    // /analyze and /comment — load rules + instruction summary, enqueue the
    // case, and feed the user input that drives the next turn.
    if (agentRuntime) {
      const rules = await db.select()
        .from(schema.workspaceRules)
        .where(eq(schema.workspaceRules.enabled, true))
        .orderBy(schema.workspaceRules.priority)
        .all();

      const instructionSummary = await db.select()
        .from(schema.caseInstructionSummaries)
        .where(eq(schema.caseInstructionSummaries.caseId, caseId))
        .get();

      agentRuntime.enqueueCase(caseId, {
        workspaceRules: rules,
        caseInstructions: instructionSummary?.summary || '',
      });

      agentRuntime.onUserInput(caseId, 'Regenerate the proposal based on the latest context.');
      return { ok: true, data: { success: true, mode: 'agent-runtime' } };
    }

    // Fallback: use the existing job queue path. Cancel any existing pending
    // / running generate_proposal jobs for this case first so a stale queued
    // job doesn't race with the new one. Mirrors /comment's fallback cleanup.
    const existingJobs = await db.select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.type, 'generate_proposal'),
          like(schema.jobs.payloadJson, `%${caseId}%`),
          inArray(schema.jobs.status, ['queued', 'running'])
        )
      )
      .all();
    for (const oldJob of existingJobs) {
      db.update(schema.jobs)
        .set({ status: 'cancelled', finishedAt: new Date().toISOString() })
        .where(eq(schema.jobs.id, oldJob.id))
        .run();
    }

    const { createJob } = await import('../worker/job-queue.js');
    const job = await createJob({
      type: 'generate_proposal',
      payload: { caseId, reason: 'user_requested_regenerate' },
    });

    return { ok: true, data: { jobId: job.id, mode: 'job-queue' } };
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

  // NOTE: Patch-orchestration routes (POST/GET /patch-intents, GET /patches/:id,
  // POST /patches/:id/reject, /approve-apply, /rollback) have been removed.
  // Vault modifications now flow through AI self-decided ProposedNextAction
  // picks via POST /cases/:caseId/invoke-next.

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
