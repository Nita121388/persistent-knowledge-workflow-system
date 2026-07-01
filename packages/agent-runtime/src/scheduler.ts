import type { CaseSession, CaseId } from './types.js';
import { Action, DEFAULTS } from './types.js';
import { buildContext } from './context-builder.js';
import { compressSession } from './context-builder.js';
import { runCliAgent, getAgentWorkDir, type CliRunnerOptions } from './cli-runner.js';
import type { SessionManager } from './session.js';
import type { CliResult } from './types.js';

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
  compressThreshold?: number;
  keepRecentCount?: number;
  maxTokensPerSession?: number;
  sleepMs?: number;
  cliTimeoutMs?: number;
}

export type SchedulerEvent =
  | { type: 'turn_started'; caseId: CaseId; action: Action }
  | { type: 'turn_completed'; caseId: CaseId; result: CliResult }
  | { type: 'turn_failed'; caseId: CaseId; error: string }
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
  private pendingQueue: CaseId[] = [];
  private waitQueue: CaseId[] = [];        // cases waiting for user input
  private readonly sessionManager: SessionManager;
  private readonly workspacePath: string;
  private readonly cliPath: string;
  private readonly compressThreshold: number;
  private readonly keepRecentCount: number;
  private readonly maxTokensPerSession: number;
  private readonly sleepMs: number;
  private readonly cliTimeoutMs: number;

  private running = false;
  private onEvent?: (event: SchedulerEvent) => void;

  constructor(opts: SchedulerOptions) {
    this.sessionManager = opts.sessionManager;
    this.workspacePath = opts.workspacePath;
    this.cliPath = opts.cliPath;
    this.compressThreshold = opts.compressThreshold ?? DEFAULTS.contextCompressThreshold;
    this.keepRecentCount = opts.keepRecentCount ?? DEFAULTS.contextKeepRecentCount;
    this.maxTokensPerSession = opts.maxTokensPerSession ?? DEFAULTS.maxTokensPerSession;
    this.sleepMs = opts.sleepMs ?? DEFAULTS.sleepMs;
    this.cliTimeoutMs = opts.cliTimeoutMs ?? DEFAULTS.cliTimeoutMs;
  }

  /**
   * Register an event listener for scheduler lifecycle events.
   */
  setEventHandler(handler: (event: SchedulerEvent) => void): void {
    this.onEvent = handler;
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
        this.onEvent?.({ type: 'idle' });
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

        this.onEvent?.({ type: 'turn_started', caseId, action });

        // Apply compression if needed
        if (action === Action.CompressThenContinue) {
          compressSession(session);
        }

        // Build the CLAUDE.md context
        const context = buildContext(session, action);

        // Determine the agent work directory
        const workDir = getAgentWorkDir(this.workspacePath, caseId);

        // Run the CLI agent
        const result = await runCliAgent({
          cliPath: this.cliPath,
          workDir,
          taskPrompt: context,
          timeoutMs: this.cliTimeoutMs,
        });

        // Process the result
        if (result.exitCode === 0 && !result.timedOut) {
          // Success — add assistant response to messages
          const assistantContent = result.stdout.trim() || '*(no output)*';
          this.sessionManager.appendMessage(caseId, 'assistant', assistantContent);

          // Check if the agent is asking for user input
          const asksForInput = result.stdout.toLowerCase().includes('ask_user')
            || result.stdout.toLowerCase().includes('please provide')
            || result.stdout.toLowerCase().includes('i need your input');

          if (asksForInput) {
            session.awaitingUserInput = true;
            session.hasNewUserInput = false;
            this.waitQueue.push(caseId);
          } else {
            // Agent is still working — re-queue for next cycle
            session.hasNewUserInput = false;
            this.pendingQueue.push(caseId);
          }

          this.onEvent?.({ type: 'turn_completed', caseId, result });
        } else if (result.timedOut) {
          // Timeout — still record the partial output
          const partialContent = result.stdout.trim() || `*(timed out after ${this.cliTimeoutMs}ms)*`;
          this.sessionManager.appendMessage(caseId, 'assistant', partialContent);
          session.awaitingUserInput = true; // Wait for user to decide what to do
          this.waitQueue.push(caseId);

          this.onEvent?.({ type: 'turn_failed', caseId, error: `Timed out after ${this.cliTimeoutMs}ms` });
        } else {
          // Error
          const errorMsg = `CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`;
          this.sessionManager.appendMessage(caseId, 'assistant', `Error: ${errorMsg}`);
          session.awaitingUserInput = true; // Wait for user intervention
          this.waitQueue.push(caseId);

          this.onEvent?.({ type: 'turn_failed', caseId, error: errorMsg });
        }

        // Evict stale sessions periodically
        this.evictStale();
      } catch (err: any) {
        console.error(`[Scheduler] Error processing case ${caseId}:`, err);
        this.onEvent?.({ type: 'turn_failed', caseId, error: err.message });

        // Put it back in queue for retry
        this.pendingQueue.push(caseId);
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
    }
  }

  /**
   * Remove a case from all queues.
   */
  dequeue(caseId: CaseId): void {
    this.pendingQueue = this.pendingQueue.filter(id => id !== caseId);
    this.waitQueue = this.waitQueue.filter(id => id !== caseId);
  }

  /**
   * Evict stale sessions.
   */
  private evictStale(): void {
    const evicted = this.sessionManager.evictStale();
    for (const session of evicted) {
      this.dequeue(session.caseId);
      this.onEvent?.({ type: 'session_evicted', caseId: session.caseId });
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
