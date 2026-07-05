import type { AgentRuntimeOptions, SessionPersistence, CaseSession } from './types.js';
import { type CaseId } from '@pkws/shared';
import { DEFAULTS } from './types.js';
import { resolveCliPath, detectAvailableAgents, detectAgentIdFromPath } from './agent-detect.js';
import { SessionManager } from './session.js';
import { Scheduler, type SchedulerEvent } from './scheduler.js';
import { verifyCli } from './cli-runner.js';

export type { AgentRuntimeOptions } from './types.js';

/**
 * WebSocket event types for real-time UI updates.
 */
export type WsEvent =
  | { type: 'turn_started'; caseId: string; action: string }
  | { type: 'turn_completed'; caseId: string; durationMs: number }
  | { type: 'turn_failed'; caseId: string; error: string }
  | { type: 'session_created'; caseId: string }
  | { type: 'session_evicted'; caseId: string }
  | { type: 'queue_update'; pending: number; waiting: number }
  | { type: 'runtime_status'; running: boolean };

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
  private readonly options: Required<AgentRuntimeOptions> & { persistence: SessionPersistence | null };
  private cliPath: string = '';
  private schedulerPromise: Promise<void> | null = null;
  /** WebSocket broadcast callback — set by server integration */
  private fsBroadcast: ((event: WsEvent) => void) | null = null;

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
      persistence: options.persistence ?? null,
    } as Required<AgentRuntimeOptions> & { persistence: SessionPersistence | null };

    this.sessionManager = new SessionManager({
      maxActiveSessions: this.options.maxActiveSessions,
      sessionTimeoutMinutes: this.options.sessionTimeoutMinutes,
    });

    // Wire up persistence if provided
    if (this.options.persistence) {
      this.sessionManager.enablePersistence(this.options.persistence);
      console.log('[AgentRuntime] Persistence enabled (evicted sessions will be saved to SQLite)');
    }
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

    // Detect which CLI family the resolved path refers to (used by the runner
    // to pick --session-id scheme + transcript-path lookup). May be null for
    // a custom binary.
    const detectedAgentId = detectAgentIdFromPath(this.cliPath);
    if (detectedAgentId) {
      console.log(`[AgentRuntime] Detected agent: ${detectedAgentId}`);
    } else {
      console.log('[AgentRuntime] Agent CLI name unrecognized — session/transcript recording disabled.');
    }

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
      agentId: detectedAgentId ?? undefined,
      compressThreshold: this.options.contextCompressThreshold,
      keepRecentCount: this.options.contextKeepRecentCount,
      maxTokensPerSession: this.options.maxTokensPerSession,
      sandboxMode: this.options.sandboxMode,
      vaultPath: this.options.vaultPath ?? undefined,
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
   * If the session was evicted to SQLite, it will be restored automatically.
   */
  async onUserInput(caseId: CaseId, input: string, init?: {
    systemPrompt?: string;
    workspaceRules?: any[];
    caseInstructions?: string;
  }): Promise<void> {
    if (!this.scheduler) {
      console.warn('[AgentRuntime] Scheduler not started');
      return;
    }

    // If session doesn't exist in memory, try to restore from persistence
    let session: CaseSession | undefined = this.sessionManager.get(caseId);
    if (!session) {
      const restored = await this.sessionManager.restoreSession(caseId, init);
      session = restored ?? undefined;
      if (session) {
        console.log(`[AgentRuntime] Restored session ${caseId} from persistence`);
      }
    }

    // If still no session, create a fresh one
    if (!session) {
      session = this.sessionManager.getOrCreate(caseId, init as any);
      console.log(`[AgentRuntime] Created fresh session for ${caseId}`);
    }

    this.scheduler.onUserInput(caseId, input);
  }

  /**
   * Enqueue a case for the scheduler to process.
   * Will attempt to restore from persistence first if session not in memory.
   */
  async enqueueCase(caseId: CaseId, init?: {
    systemPrompt?: string;
    workspaceRules?: any[];
    caseInstructions?: string;
  }): Promise<void> {
    if (!this.scheduler) {
      console.warn('[AgentRuntime] Scheduler not started');
      return;
    }

    // Try to restore from persistence first
    let session: CaseSession | undefined = this.sessionManager.get(caseId);
    if (!session) {
      const restored = await this.sessionManager.restoreSession(caseId, init);
      session = restored ?? undefined;
    }

    // Create if still not found
    if (!session) {
      this.sessionManager.getOrCreate(caseId, init as any);
    }

    // Enqueue
    this.scheduler.enqueue(caseId);
  }

  /**
   * Detach a case from the scheduler (e.g., when case is closed).
   */
  async detachCase(caseId: CaseId): Promise<void> {
    if (this.scheduler) {
      this.scheduler.dequeue(caseId);
    }
    this.sessionManager.remove(caseId);

    // Also remove from persistence
    if (this.options.persistence) {
      await this.options.persistence.delete(caseId);
    }
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

    // Persist all active sessions before stopping
    if (this.options.persistence) {
      const sessions = this.sessionManager.all();
      for (const session of sessions) {
        await this.options.persistence.save(session.caseId, {
          recentMessages: session.messages,
          compressedSummary: session.compressedSummary ?? null,
          turnCount: session.turnCount,
          totalTokens: session.totalTokens,
          compressionEpoch: session.compressionEpoch,
          awaitingUserInput: session.awaitingUserInput,
        });
        console.log(`[AgentRuntime] Persisted session ${session.caseId} on shutdown`);
      }
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
      persistenceEnabled: this.options.persistence !== null,
    };
  }

  /**
   * Get the session manager (for integration with existing code).
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Set the WebSocket broadcast callback for real-time UI updates.
   */
  setWsBroadcast(broadcast: (event: WsEvent) => void): void {
    this.fsBroadcast = broadcast;
  }

  /**
   * Handle scheduler events for logging/debugging and WebSocket broadcast.
   */
  private handleEvent(event: SchedulerEvent): void {
    switch (event.type) {
      case 'turn_started': {
        const wsEvent: WsEvent = { type: 'turn_started', caseId: event.caseId, action: String(event.action) };
        this.fsBroadcast?.(wsEvent);
        console.log(`[AgentRuntime] Turn started: ${event.caseId} (${event.action})`);
        break;
      }
      case 'turn_completed': {
        const wsEvent: WsEvent = { type: 'turn_completed', caseId: event.caseId, durationMs: event.result.durationMs };
        this.fsBroadcast?.(wsEvent);
        console.log(`[AgentRuntime] Turn completed: ${event.caseId} (${event.result.durationMs}ms)`);
        break;
      }
      case 'turn_failed': {
        const wsEvent: WsEvent = { type: 'turn_failed', caseId: event.caseId, error: event.error };
        this.fsBroadcast?.(wsEvent);
        console.error(`[AgentRuntime] Turn failed: ${event.caseId} — ${event.error}`);
        break;
      }
      case 'session_evicted': {
        const wsEvent: WsEvent = { type: 'session_evicted', caseId: event.caseId };
        this.fsBroadcast?.(wsEvent);
        console.log(`[AgentRuntime] Session evicted: ${event.caseId}`);
        break;
      }
      case 'session_created': {
        const wsEvent: WsEvent = { type: 'session_created', caseId: event.caseId };
        this.fsBroadcast?.(wsEvent);
        console.log(`[AgentRuntime] Session created: ${event.caseId}`);
        break;
      }
      case 'idle':
        // Too noisy to log every idle cycle
        break;
    }
  }
}
