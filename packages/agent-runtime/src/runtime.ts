import type { AgentRuntimeOptions, CaseId } from './types.js';
import { DEFAULTS } from './types.js';
import { resolveCliPath, detectAvailableAgents } from './agent-detect.js';
import { SessionManager } from './session.js';
import { Scheduler, type SchedulerEvent } from './scheduler.js';
import { verifyCli } from './cli-runner.js';

export type { AgentRuntimeOptions } from './types.js';

/**
 * AgentRuntime — the top-level orchestrator for PKWS's AI agent system.
 *
 * Lifecycle:
 * 1. constructor() — creates SessionManager, Scheduler
 * 2. start() — resolves CLI path, verifies CLI, starts scheduler loop
 * 3. onUserInput(caseId, input) — called when user provides new input
 * 4. stop() — gracefully stops the scheduler loop
 */
export class AgentRuntime {
  private sessionManager: SessionManager;
  private scheduler: Scheduler | null = null;
  private readonly options: Required<AgentRuntimeOptions>;
  private cliPath: string = '';
  private schedulerPromise: Promise<void> | null = null;

  constructor(options: AgentRuntimeOptions) {
    this.options = {
      db: options.db,
      workspacePath: options.workspacePath,
      cliPath: options.cliPath ?? '',
      maxActiveSessions: options.maxActiveSessions ?? DEFAULTS.maxActiveSessions,
      sessionTimeoutMinutes: options.sessionTimeoutMinutes ?? DEFAULTS.sessionTimeoutMinutes,
      contextCompressThreshold: options.contextCompressThreshold ?? DEFAULTS.contextCompressThreshold,
      contextKeepRecentCount: options.contextKeepRecentCount ?? DEFAULTS.contextKeepRecentCount,
      maxTokensPerSession: options.maxTokensPerSession ?? DEFAULTS.maxTokensPerSession,
      sandboxMode: options.sandboxMode ?? DEFAULTS.sandboxMode,
    };

    this.sessionManager = new SessionManager({
      maxActiveSessions: this.options.maxActiveSessions,
      sessionTimeoutMinutes: this.options.sessionTimeoutMinutes,
    });
  }

  /**
   * Start the Agent Runtime.
   * 1. Auto-detect CLI if not specified
   * 2. Verify CLI is executable
   * 3. Start the scheduler loop
   */
  async start(): Promise<void> {
    // Resolve CLI path
    this.cliPath = resolveCliPath(this.options.cliPath);
    console.log(`[AgentRuntime] Resolved CLI: ${this.cliPath}`);

    // Verify CLI is executable
    const isValid = await verifyCli(this.cliPath);
    if (!isValid) {
      console.error(`[AgentRuntime] CLI '${this.cliPath}' is not working. Agent Runtime will not start.`);
      console.log('[AgentRuntime] Available agents:', detectAvailableAgents().map(a => `${a.name} (${a.path})`).join(', '));
      return;
    }

    console.log('[AgentRuntime] CLI verified successfully');

    // Create and start scheduler
    this.scheduler = new Scheduler({
      sessionManager: this.sessionManager,
      workspacePath: this.options.workspacePath,
      cliPath: this.cliPath,
      compressThreshold: this.options.contextCompressThreshold,
      keepRecentCount: this.options.contextKeepRecentCount,
      maxTokensPerSession: this.options.maxTokensPerSession,
    });

    this.scheduler.setEventHandler((event: SchedulerEvent) => {
      this.handleEvent(event);
    });

    // Start the scheduler loop (non-blocking)
    this.schedulerPromise = this.scheduler.runLoop().catch(err => {
      console.error('[AgentRuntime] Scheduler loop crashed:', err);
    });

    console.log('[AgentRuntime] Started successfully');
    console.log(`[AgentRuntime] Config: maxSessions=${this.options.maxActiveSessions}, timeout=${this.options.sessionTimeoutMinutes}min`);
  }

  /**
   * Handle user input for a specific case.
   * This is called by the server when the user comments on a case.
   */
  onUserInput(caseId: CaseId, input: string): void {
    if (!this.scheduler) {
      console.warn('[AgentRuntime] Scheduler not started');
      return;
    }

    this.scheduler.onUserInput(caseId, input);
  }

  /**
   * Enqueue a case for the scheduler to process.
   */
  enqueueCase(caseId: CaseId, init?: {
    systemPrompt?: string;
    workspaceRules?: any[];
    caseInstructions?: string;
  }): void {
    if (!this.scheduler) {
      console.warn('[AgentRuntime] Scheduler not started');
      return;
    }

    // Create or get session
    this.sessionManager.getOrCreate(caseId, init as any);

    // Enqueue
    this.scheduler.enqueue(caseId);
  }

  /**
   * Detach a case from the scheduler (e.g., when case is closed).
   */
  detachCase(caseId: CaseId): void {
    if (this.scheduler) {
      this.scheduler.dequeue(caseId);
    }
    this.sessionManager.remove(caseId);
  }

  /**
   * Gracefully stop the Agent Runtime.
   */
  async stop(): Promise<void> {
    console.log('[AgentRuntime] Stopping...');

    if (this.scheduler) {
      this.scheduler.stop();
    }

    if (this.schedulerPromise) {
      await this.schedulerPromise;
    }

    console.log('[AgentRuntime] Stopped');
  }

  /**
   * Get current status snapshot.
   */
  getStatus() {
    return {
      running: this.scheduler !== null && this.scheduler !== undefined,
      cliPath: this.cliPath,
      activeSessions: this.sessionManager.size,
      queueStats: this.scheduler?.queueStats ?? { pending: 0, waiting: 0, active: 0 },
      snapshot: this.sessionManager.snapshot(),
    };
  }

  /**
   * Get the session manager (for integration with existing code).
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Handle scheduler events for logging/debugging.
   */
  private handleEvent(event: SchedulerEvent): void {
    switch (event.type) {
      case 'turn_started':
        console.log(`[AgentRuntime] Turn started: ${event.caseId} (${event.action})`);
        break;
      case 'turn_completed':
        console.log(`[AgentRuntime] Turn completed: ${event.caseId} (${event.result.durationMs}ms)`);
        break;
      case 'turn_failed':
        console.error(`[AgentRuntime] Turn failed: ${event.caseId} — ${event.error}`);
        break;
      case 'session_evicted':
        console.log(`[AgentRuntime] Session evicted: ${event.caseId}`);
        break;
      case 'idle':
        // Too noisy to log every idle cycle
        break;
    }
  }
}
