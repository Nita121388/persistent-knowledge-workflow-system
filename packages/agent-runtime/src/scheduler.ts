import type { CaseSession, CliResult } from './types.js';
import path from 'node:path';
import { Action, DEFAULTS } from './types.js';
import { type CaseId, genAiRunId } from '@pkws/shared';
import { buildContext, compressSession } from './context-builder.js';
import type { CaseContextData } from './context-builder.js';
import { runCliAgent, getAgentWorkDir, type CliRunnerOptions } from './cli-runner.js';
import { parseCliOutput, type ParsedCliOutput } from './output-parser.js';
import { writeProposal, applyVaultOps, type OutputWriterOptions } from './output-writer.js';
import type { SessionManager } from './session.js';

/**
 * Emit a per-cycle queue_update event so WebSocket clients
 * see the latest pending/waiting counts.
 */
function emitQueueUpdate(scheduler: Scheduler): void {
  scheduler.emitEvent?.({
    type: 'queue_update',
    pending: scheduler.pendingQueue.length,
    waiting: scheduler.waitQueue.length,
  } as any);
}

/**
 * Load case content data from the database for context building.
 * Fetches the artifact content and metadata for the given case.
 */
async function loadCaseData(db: any, schema: any, caseId: string): Promise<CaseContextData | undefined> {
  if (!db || !schema) return undefined;

  try {
    const caseRow = db.select().from(schema.cases).where(schema.cases.id.eq(caseId)).get();
    if (!caseRow) return undefined;

    const artifact = caseRow.primaryArtifactId
      ? db.select().from(schema.artifacts).where(schema.artifacts.id.eq(caseRow.primaryArtifactId)).get()
      : null;

    const instructionSummary = db.select()
      .from(schema.caseInstructionSummaries)
      .where(schema.caseInstructionSummaries.caseId.eq(caseId))
      .get();

    if (!artifact) return undefined;

    // Read the actual markdown file content if available
    let contentBody: string | undefined;
    try {
      const { readMarkdown } = await import('@pkws/vault');
      const md = await readMarkdown(artifact.vaultPath);
      if (md) {
        contentBody = md.body;
      }
    } catch {
      // File may not exist or vault package not available
    }

    return {
      title: artifact.title || caseRow.title,
      contentBody,
      sourceUrl: artifact.sourceUrl || undefined,
      frontmatterContext: artifact.frontmatterJson || undefined,
      instructionSummary: instructionSummary?.summary || undefined,
    };
  } catch (err) {
    console.warn(`[loadCaseData] Failed to load data for ${caseId}:`, err);
    return undefined;
  }
}

/**
 * Reload the workspace rules from the DB (line 2 / task #12).
 *
 * The scheduler captures rules into `session.workspaceRules` once at enqueue
 * time (runtime.enqueueCase → sessionManager init). If the user edits a rule
 * mid-session, that snapshot goes stale: every AI turn would still be fed the
 * old rules, and the per-turn ai_runs row (scheduler.ts ~L253) would persist
 * the stale rulesSnapshotJson. To keep each turn honest, the main loop calls
 * this before buildContext() and overwrites session.workspaceRules with the
 * current enabled-rule set ordered by priority — the same shape loadCaseData /
 * the legacy handleGenerateProposal path use.
 */
function reloadWorkspaceRules(db: any, schema: any, session: CaseSession): void {
  if (!db || !schema?.workspaceRules) return;
  try {
    const fresh = db.select()
      .from(schema.workspaceRules)
      .where(schema.workspaceRules.enabled.eq(true))
      .orderBy(schema.workspaceRules.priority)
      .all();
    if (fresh && fresh.length >= 0) {
      session.workspaceRules = fresh;
    }
  } catch (err) {
    // Non-fatal: fall back to the existing session snapshot.
    console.warn(`[reloadWorkspaceRules] Failed for session ${session.caseId}:`, err);
  }
}

/**
 * Decide what action to take for a given session.
 */
export function decideAction(session: CaseSession, config?: {
  compressThreshold?: number;
  maxTokensPerSession?: number;
}): Action {
  const compressThreshold = config?.compressThreshold ?? DEFAULTS.contextCompressThreshold;
  const maxTokensPerSession = config?.maxTokensPerSession ?? DEFAULTS.maxTokensPerSession;

  // First turn — load from SQLite
  if (session.turnCount === 0) {
    return Action.NewTurn;
  }

  // Token budget exceeded — compress
  if (session.totalTokens > maxTokensPerSession) {
    return Action.CompressThenContinue;
  }

  // Message count threshold — compress
  if (session.messages.length > compressThreshold) {
    return Action.CompressThenContinue;
  }

  // Default: continue with existing context
  return Action.Continue;
}

export interface SchedulerOptions {
  sessionManager: SessionManager;
  workspacePath: string;
  cliPath: string;
  /** Which CLI family the cliPath refers to. Used to pick --session-id scheme + transcript lookup. */
  agentId?: 'claude' | 'codex';
  db?: any;
  schema?: any;
  compressThreshold?: number;
  keepRecentCount?: number;
  maxTokensPerSession?: number;
  sleepMs?: number;
  cliTimeoutMs?: number;
  sandboxMode?: 'workspace-only' | 'vault-readonly' | 'full';
  vaultPath?: string;
}

export type SchedulerEvent =
  | { type: 'turn_started'; caseId: CaseId; action: Action }
  | { type: 'turn_completed'; caseId: CaseId; result: CliResult }
  | { type: 'turn_failed'; caseId: CaseId; error: string }
  | { type: 'session_created'; caseId: CaseId }
  | { type: 'session_evicted'; caseId: CaseId }
  | { type: 'idle' };

/**
 * The Scheduler manages which Case gets to run next.
 *
 * Priority:
 * 1. Cases with hasNewUserInput === true (user just commented)
 * 2. Cases with awaitingUserInput === false (ready for next AI turn)
 * 3. FIFO within the same priority level
 * 4. If all cases are awaitingUserInput → idle (sleep)
 */
export class Scheduler {
  pendingQueue: CaseId[] = [];       // public for emitQueueUpdate
  waitQueue: CaseId[] = [];          // public for emitQueueUpdate
  private readonly sessionManager: SessionManager;
  private readonly workspacePath: string;
  private readonly cliPath: string;
  private readonly agentId: 'claude' | 'codex' | undefined;
  private readonly compressThreshold: number;
  private readonly keepRecentCount: number;
  private readonly maxTokensPerSession: number;
  private readonly sleepMs: number;
  private readonly cliTimeoutMs: number;
  private readonly sandboxMode: 'workspace-only' | 'vault-readonly' | 'full';
  private readonly vaultPath: string | undefined;
  private readonly db: any;
  private readonly schema: any;

  private running = false;
  private retryCounts = new Map<CaseId, number>();
  private readonly maxRetries = 3;
  /** Exposed for internal emit helpers — external code uses setEventHandler */
  emitEvent?: (event: SchedulerEvent) => void;

  constructor(opts: SchedulerOptions) {
    this.sessionManager = opts.sessionManager;
    this.workspacePath = opts.workspacePath;
    this.cliPath = opts.cliPath;
    this.agentId = opts.agentId;
    this.db = opts.db ?? null;
    this.schema = opts.schema ?? null;
    this.compressThreshold = opts.compressThreshold ?? DEFAULTS.contextCompressThreshold;
    this.keepRecentCount = opts.keepRecentCount ?? DEFAULTS.contextKeepRecentCount;
    this.maxTokensPerSession = opts.maxTokensPerSession ?? DEFAULTS.maxTokensPerSession;
    this.sleepMs = opts.sleepMs ?? DEFAULTS.sleepMs;
    this.cliTimeoutMs = opts.cliTimeoutMs ?? DEFAULTS.cliTimeoutMs;
    this.sandboxMode = opts.sandboxMode ?? DEFAULTS.sandboxMode;
    this.vaultPath = opts.vaultPath;
  }

  /**
   * Register an event listener for scheduler lifecycle events.
   */
  setEventHandler(handler: (event: SchedulerEvent) => void): void {
    this.emitEvent = handler;
  }

  /**
   * Called when the user provides new input for a case.
   */
  onUserInput(caseId: CaseId, input: string): void {
    const session = this.sessionManager.get(caseId);
    if (!session) {
      console.warn(`[Scheduler] onUserInput: session not found for ${caseId}`);
      return;
    }

    // Append user message
    this.sessionManager.appendMessage(caseId, 'user', input);
    session.hasNewUserInput = true;
    session.awaitingUserInput = false;

    // Move from waitQueue to pendingQueue
    this.waitQueue = this.waitQueue.filter(id => id !== caseId);
    if (!this.pendingQueue.includes(caseId)) {
      this.pendingQueue.push(caseId);
    }
  }

  /**
   * Main scheduler loop — runs until stop() is called.
   */
  async runLoop(): Promise<void> {
    this.running = true;

    while (this.running) {
      const caseId = this.pickNext();

      if (!caseId) {
        // Nothing to do — sleep
        this.emitEvent?.({ type: 'idle' });
        await this.sleep();
        continue;
      }

      const session = this.sessionManager.get(caseId);
      if (!session) continue;

      // Hoisted out of try{} so the catch can close an in-flight ai_runs row.
      let aiRunId: ReturnType<typeof genAiRunId> | undefined;
      let startedAtMs: number | undefined;

      try {
        const action = decideAction(session, {
          compressThreshold: this.compressThreshold,
          maxTokensPerSession: this.maxTokensPerSession,
        });

        this.emitEvent?.({ type: 'turn_started', caseId, action });
        emitQueueUpdate(this);

        // Apply compression if needed
        if (action === Action.CompressThenContinue) {
          compressSession(session);
        }

        // Build the CLAUDE.md context
        const caseData = await loadCaseData(this.db, this.schema, caseId);
        // Line 2 / task #12: re-read enabled workspace rules from the DB on
        // every turn so mid-session rule edits take effect immediately (and
        // so the ai_runs.rowsSnapshotJson written below reflects current
        // rules, not the enqueue-time snapshot).
        reloadWorkspaceRules(this.db, this.schema, session);
        const context = buildContext(session, action, caseData);

        // Determine the agent work directory
        const workDir = getAgentWorkDir(this.workspacePath, caseId);

        // ---- ai_runs: open a per-turn processing row (line 2) ----
        // The scheduler is the agent-runtime entry-point that actually runs
        // the AI on the invoke-next path (when /invoke-next chooses the
        // agentRuntime branch instead of the generate_proposal fallback).
        // Tag these as kind='turn', trigger='user_invoke_next'. The CLI agent
        // path does not pseudo-refer to a proposals row, so proposalId stays
        // null on every turn row. startedAt is captured before runCliAgent so
        // durationMs reflects CLI wall time, not scheduler wait.
        aiRunId = genAiRunId();
        const startedAtIso = new Date().toISOString();
        startedAtMs = Date.now();
        const rulesSnapshotJson = JSON.stringify(
          session.workspaceRules.map(r => ({ title: r.title, content: r.content, priority: r.priority })),
        );
        const inputContextJson = JSON.stringify({
          action,
          caseId,
          caseData: caseData ? {
            title: caseData.title,
            sourceUrl: caseData.sourceUrl,
            instructionSummary: caseData.instructionSummary,
          } : undefined,
          taskPrompt: context,
          turnCount: session.turnCount,
        });
        if (this.db && this.schema?.aiRuns) {
          (this.db as any).insert(this.schema.aiRuns).values({
            id: aiRunId,
            caseId,
            kind: 'turn',
            trigger: 'user_invoke_next',
            model: this.cliPath,
            status: 'running',
            rulesSnapshotJson,
            inputContextJson,
            startedAt: startedAtIso,
            createdAt: startedAtIso,
          }).run();
        }

        // Run the CLI agent
        const result = await runCliAgent({
          cliPath: this.cliPath,
          agentId: this.agentId,
          workDir,
          taskPrompt: context,
          timeoutMs: this.cliTimeoutMs,
          sandboxMode: this.sandboxMode,
          vaultPath: this.vaultPath,
          workspacePath: this.workspacePath,
        });

        // Helper to close the ai_runs row opened above.
        const closeAiRun = (
          status: 'succeeded' | 'failed' | 'aborted',
          payload: {
            outputSummary?: string;
            proposedNextActionsJson?: string;
            error?: string;
          },
        ): void => {
          if (!(this.db && this.schema?.aiRuns && startedAtMs)) return;
          (this.db as any).update(this.schema.aiRuns)
            .set({
              status,
              outputSummary: payload.outputSummary ?? null,
              proposedNextActionsJson: payload.proposedNextActionsJson ?? null,
              error: payload.error ?? null,
              finishedAt: new Date().toISOString(),
              durationMs: Date.now() - startedAtMs,
              agentId: result.agentId ?? null,
              sessionId: result.sessionId ?? null,
              transcriptPath: result.transcriptPath ?? null,
            })
            .where((this.schema.aiRuns as any).id.eq(aiRunId))
            .run();
        };

        // Reset retry count on success
        this.retryCounts.delete(caseId);

        // Process the result
        if (result.exitCode === 0 && !result.timedOut) {
          // Parse structured output files (proposal.json, patch-operations.json)
          const parsed = parseCliOutput(result.outputFiles, result.stdout);

          if (parsed.errors.length > 0) {
            console.warn(`[Scheduler] Output parse warnings for ${caseId}:`, parsed.errors);
          }

          // Write proposal to DB if found
          if (parsed.proposal && this.db && this.schema) {
            try {
              await writeProposal(
                { db: this.db, schema: this.schema },
                caseId,
                parsed.proposal,
                this.cliPath,
              );
            } catch (err: any) {
              console.error(`[Scheduler] Failed to write proposal for ${caseId}:`, err.message);
            }
          }

          // Apply vault operations directly to the real vault (line 5 /
          // task #16). The CLI agent only emits patch-operations.json on a
          // turn where the user has approved a modify_vault next-step via
          // invoke-next; we apply immediately without staging as a DB row.
          if (parsed.patch && this.db && this.schema && this.vaultPath) {
            try {
              const backupsPath = path.join(this.workspacePath, 'backups', caseId);
              await applyVaultOps(
                { db: this.db, schema: this.schema },
                caseId,
                parsed.patch.operations,
                { vaultPath: this.vaultPath, backupsPath },
              );
            } catch (err: any) {
              console.error(`[Scheduler] Failed to apply vault ops for ${caseId}:`, err.message);
            }
          }

          // Add assistant response to in-memory messages
          const assistantContent = parsed.proposal
            ? `Proposal: ${parsed.proposal.title} — ${parsed.proposal.reasoningSummary}`
            : (result.stdout.trim() || '*(no output)*');
          this.sessionManager.appendMessage(caseId, 'assistant', assistantContent);

          // Store AI-generated context summary if available
          if (parsed.contextSummary) {
            const session = this.sessionManager.get(caseId);
            if (session) {
              session.compressedSummary = parsed.contextSummary.summary;
              if (parsed.contextSummary.keyPoints?.length) {
                session.compressedSummary += '\n\nKey points:\n- ' + parsed.contextSummary.keyPoints.join('\n- ');
              }
              if (parsed.contextSummary.openQuestions?.length) {
                session.compressedSummary += '\n\nOpen questions:\n- ' + parsed.contextSummary.openQuestions.join('\n- ');
              }
            }
          }

          // Check if the agent is asking for user input
          const asksForInput = result.stdout.toLowerCase().includes('ask_user')
            || result.stdout.toLowerCase().includes('please provide')
            || result.stdout.toLowerCase().includes('i need your input');

          if (asksForInput) {
            session.awaitingUserInput = true;
            session.hasNewUserInput = false;
            this.waitQueue.push(caseId);
          } else if (parsed.proposal) {
            // Proposal was generated — wait for user to review
            session.awaitingUserInput = true;
            session.hasNewUserInput = false;
            this.waitQueue.push(caseId);
          } else {
            // Agent is still working — re-queue for next cycle
            session.hasNewUserInput = false;
            this.pendingQueue.push(caseId);
          }

          this.emitEvent?.({ type: 'turn_completed', caseId, result });
          emitQueueUpdate(this);

          // Close the ai_runs row for this turn. proposal (if produced) is
          // mostly attached to a proposals-row pointer anyway; for turns the
          // narrative result is the next-action menu snapshot itself.
          closeAiRun('succeeded', {
            outputSummary:
              parsed.proposal
                ? `Proposal: ${parsed.proposal.title} — ${(parsed.proposal.reasoningSummary ?? '').slice(0, 1000)}`
                : (result.stdout.trim().slice(0, 1000) || undefined),
            proposedNextActionsJson: parsed.proposal?.proposedNextActions
              ? JSON.stringify(parsed.proposal.proposedNextActions)
              : undefined,
          });
        } else if (result.timedOut) {
          // Timeout — still record the partial output
          const partialContent = result.stdout.trim() || `*(timed out after ${this.cliTimeoutMs}ms)*`;
          this.sessionManager.appendMessage(caseId, 'assistant', partialContent);
          this.emitEvent?.({ type: 'turn_failed', caseId, error: `Timed out after ${this.cliTimeoutMs}ms` });
          emitQueueUpdate(this);
          closeAiRun('failed', {
            error: `Timed out after ${this.cliTimeoutMs}ms`,
            outputSummary: result.stdout.trim().slice(0, 1000) || undefined,
          });

          // Timeout: wait for user to decide retry
          session.awaitingUserInput = true;
          this.waitQueue.push(caseId);
        } else {
          // Error — apply retry logic for non-timeout failures
          const errorMsg = `CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`;
          this.sessionManager.appendMessage(caseId, 'assistant', `Error: ${errorMsg}`);
          this.emitEvent?.({ type: 'turn_failed', caseId, error: errorMsg });
          emitQueueUpdate(this);
          closeAiRun('failed', {
            error: errorMsg,
            outputSummary: result.stderr.trim().slice(0, 1000) || undefined,
          });

          // Retry up to maxRetries on non-timeout errors
          const retries = (this.retryCounts.get(caseId) ?? 0) + 1;
          this.retryCounts.set(caseId, retries);
          if (retries <= this.maxRetries) {
            console.log(`[Scheduler] Retry ${retries}/${this.maxRetries} for ${caseId} after CLI error`);
            this.pendingQueue.push(caseId);
          } else {
            console.error(`[Scheduler] Case ${caseId} failed after ${this.maxRetries} retries. Waiting for user.`);
            session.awaitingUserInput = true;
            this.waitQueue.push(caseId);
            this.retryCounts.delete(caseId);
          }
        }

        // Evict stale sessions periodically
        this.evictStale();
      } catch (err: any) {
        console.error(`[Scheduler] Error processing case ${caseId}:`, err);
        this.emitEvent?.({ type: 'turn_failed', caseId, error: err.message });
        emitQueueUpdate(this);

        // Close any ai_runs row opened inside the try block so it does not
        // linger forever in 'running' state when runCliAgent throws before
        // reaching the inner status branches.
        if (aiRunId && this.db && this.schema?.aiRuns && startedAtMs) {
          (this.db as any).update(this.schema.aiRuns)
            .set({
              status: 'failed',
              error: err?.message ?? String(err),
              finishedAt: new Date().toISOString(),
              durationMs: Date.now() - startedAtMs,
            })
            .where((this.schema.aiRuns as any).id.eq(aiRunId))
            .run();
        }

        // Error recovery: retry up to maxRetries times
        const retries = (this.retryCounts.get(caseId) ?? 0) + 1;
        this.retryCounts.set(caseId, retries);
        if (retries <= this.maxRetries) {
          console.log(`[Scheduler] Retry ${retries}/${this.maxRetries} for ${caseId}`);
          this.pendingQueue.push(caseId);
        } else {
          console.error(`[Scheduler] Case ${caseId} failed after ${this.maxRetries} retries. Moving to wait queue.`);
          const session = this.sessionManager.get(caseId);
          if (session) {
            session.awaitingUserInput = true;
            this.waitQueue.push(caseId);
          }
          this.retryCounts.delete(caseId);
        }
      }
    }
  }

  /**
   * Stop the scheduler loop.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Pick the next case to process.
   */
  private pickNext(): CaseId | null {
    // 1. Cases with new user input
    const newInputIndex = this.pendingQueue.findIndex(id => {
      const session = this.sessionManager.get(id);
      return session?.hasNewUserInput === true;
    });

    if (newInputIndex >= 0) {
      const [caseId] = this.pendingQueue.splice(newInputIndex, 1);
      return caseId;
    }

    // 2. Cases not waiting for user input
    const readyIndex = this.pendingQueue.findIndex(id => {
      const session = this.sessionManager.get(id);
      return session?.awaitingUserInput === false;
    });

    if (readyIndex >= 0) {
      const [caseId] = this.pendingQueue.splice(readyIndex, 1);
      return caseId;
    }

    // 3. Just pick the oldest in pendingQueue
    return this.pendingQueue.shift() ?? null;
  }

  /**
   * Add a case to the pending queue.
   */
  enqueue(caseId: CaseId): void {
    if (!this.pendingQueue.includes(caseId) && !this.waitQueue.includes(caseId)) {
      this.pendingQueue.push(caseId);
      this.emitEvent?.({ type: 'session_created', caseId });
    }
  }

  /**
   * Remove a case from all queues.
   */
  dequeue(caseId: CaseId): void {
    this.pendingQueue = this.pendingQueue.filter(id => id !== caseId);
    this.waitQueue = this.waitQueue.filter(id => id !== caseId);
    this.retryCounts.delete(caseId);
  }

  /**
   * Evict stale sessions.
   */
  private evictStale(): void {
    const evicted = this.sessionManager.evictStale();
    for (const session of evicted) {
      this.dequeue(session.caseId);
      this.emitEvent?.({ type: 'session_evicted', caseId: session.caseId });
    }
  }

  /**
   * Sleep for the configured interval.
   */
  private sleep(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, this.sleepMs));
  }

  /**
   * Get current queue stats.
   */
  get queueStats() {
    return {
      pending: this.pendingQueue.length,
      waiting: this.waitQueue.length,
      active: this.sessionManager.size,
    };
  }
}
