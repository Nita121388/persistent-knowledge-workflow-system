import type { CaseSession, CliResult } from './types.js';
import { Action, DEFAULTS } from './types.js';
import { type CaseId } from '@pkws/shared';
import { buildContext, compressSession } from './context-builder.js';
import type { CaseContextData } from './context-builder.js';
import { runCliAgent, getAgentWorkDir, type CliRunnerOptions } from './cli-runner.js';
import { parseCliOutput, type ParsedCliOutput } from './output-parser.js';
import { writeProposal, writePatch, type OutputWriterOptions } from './output-writer.js';
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
        const context = buildContext(session, action, caseData);

        // Determine the agent work directory
        const workDir = getAgentWorkDir(this.workspacePath, caseId);

        // Run the CLI agent
        const result = await runCliAgent({
          cliPath: this.cliPath,
          workDir,
          taskPrompt: context,
          timeoutMs: this.cliTimeoutMs,
          sandboxMode: this.sandboxMode,
          vaultPath: this.vaultPath,
          workspacePath: this.workspacePath,
        });

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

          // Write patch to DB if found
          if (parsed.patch && this.db && this.schema) {
            try {
              await writePatch(
                { db: this.db, schema: this.schema },
                caseId,
                parsed.patch.operations,
              );
            } catch (err: any) {
              console.error(`[Scheduler] Failed to write patch for ${caseId}:`, err.message);
            }
          }

          // Add assistant response to in-memory messages
          const assistantContent = parsed.proposal
            ? `Proposal: ${parsed.proposal.title} — ${parsed.proposal.reasoningSummary}`
            : (result.stdout.trim() || '*(no output)*');
          this.sessionManager.appendMessage(caseId, 'assistant', assistantContent);

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
        } else if (result.timedOut) {
          // Timeout — still record the partial output
          const partialContent = result.stdout.trim() || `*(timed out after ${this.cliTimeoutMs}ms)*`;
          this.sessionManager.appendMessage(caseId, 'assistant', partialContent);
          this.emitEvent?.({ type: 'turn_failed', caseId, error: `Timed out after ${this.cliTimeoutMs}ms` });
          emitQueueUpdate(this);

          // Timeout: wait for user to decide retry
          session.awaitingUserInput = true;
          this.waitQueue.push(caseId);
        } else {
          // Error — apply retry logic for non-timeout failures
          const errorMsg = `CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`;
          this.sessionManager.appendMessage(caseId, 'assistant', `Error: ${errorMsg}`);
          this.emitEvent?.({ type: 'turn_failed', caseId, error: errorMsg });
          emitQueueUpdate(this);

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
