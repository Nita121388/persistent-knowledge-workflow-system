import type { CaseId } from '@pkws/shared';
import type { CaseSession, Message, SessionSnapshot } from './types.js';
import { DEFAULTS } from './types.js';

/**
 * SessionManager maintains the in-memory Map<caseId, CaseSession>.
 * Handles creation, eviction, and lifecycle.
 */
export class SessionManager {
  private activeCases = new Map<string, CaseSession>();
  private readonly maxSessions: number;
  private readonly timeoutMs: number;

  constructor(opts?: { maxActiveSessions?: number; sessionTimeoutMinutes?: number }) {
    this.maxSessions = opts?.maxActiveSessions ?? DEFAULTS.maxActiveSessions;
    this.timeoutMs = (opts?.sessionTimeoutMinutes ?? DEFAULTS.sessionTimeoutMinutes) * 60 * 1000;
  }

  /**
   * Get an existing session or create a new one.
   */
  getOrCreate(
    caseId: CaseId,
    init?: Partial<Omit<CaseSession, 'caseId' | 'messages' | 'turnCount' | 'totalTokens' | 'awaitingUserInput' | 'hasNewUserInput' | 'lastActiveAt' | 'compressionEpoch'>>,
  ): CaseSession {
    const existing = this.activeCases.get(caseId);
    if (existing) {
      existing.lastActiveAt = new Date();
      return existing;
    }

    const session: CaseSession = {
      caseId,
      messages: [],
      turnCount: 0,
      totalTokens: 0,
      systemPrompt: init?.systemPrompt ?? '',
      workspaceRules: init?.workspaceRules ?? [],
      caseInstructions: init?.caseInstructions ?? '',
      awaitingUserInput: false,
      hasNewUserInput: false,
      lastActiveAt: new Date(),
      compressionEpoch: 0,
      compressedSummary: init?.compressedSummary,
    };

    this.activeCases.set(caseId, session);
    return session;
  }

  /**
   * Remove a session from memory (e.g., after eviction persistence).
   */
  remove(caseId: string): void {
    this.activeCases.delete(caseId);
  }

  /**
   * Get an existing session without creating.
   */
  get(caseId: string): CaseSession | undefined {
    return this.activeCases.get(caseId);
  }

  /**
   * Evict sessions that have been inactive beyond the timeout.
   * Also evicts the least recently used if we exceed maxSessions.
   * Returns the list of evicted caseIds so caller can persist them.
   */
  evictStale(): CaseSession[] {
    const now = Date.now();
    const evicted: CaseSession[] = [];

    // 1. Evict stale sessions
    if (this.activeCases.size > this.maxSessions) {
      const entries = [...this.activeCases.entries()]
        .filter(([_, s]) => now - s.lastActiveAt.getTime() > this.timeoutMs)
        .sort((a, b) => a[1].lastActiveAt.getTime() - b[1].lastActiveAt.getTime());

      const excess = this.activeCases.size - this.maxSessions;
      const toEvict = entries.slice(0, Math.max(excess, entries.length));

      for (const [caseId, session] of toEvict) {
        this.activeCases.delete(caseId);
        evicted.push(session);
      }
    }

    // 2. If still over maxSessions (no stale sessions), evict LRU
    if (this.activeCases.size > this.maxSessions) {
      const entries = [...this.activeCases.entries()]
        .sort((a, b) => a[1].lastActiveAt.getTime() - b[1].lastActiveAt.getTime());

      const excess = this.activeCases.size - this.maxSessions;
      for (let i = 0; i < excess && i < entries.length; i++) {
        const [caseId, session] = entries[i];
        this.activeCases.delete(caseId);
        evicted.push(session);
      }
    }

    return evicted;
  }

  /**
   * Take a snapshot of all active sessions (for persistence / debug).
   */
  snapshot(): SessionSnapshot[] {
    return [...this.activeCases.values()].map(s => ({
      caseId: s.caseId,
      turnCount: s.turnCount,
      totalTokens: s.totalTokens,
      awaitingUserInput: s.awaitingUserInput,
      hasNewUserInput: s.hasNewUserInput,
      lastActiveAt: s.lastActiveAt,
      compressionEpoch: s.compressionEpoch,
      messageCount: s.messages.length,
    }));
  }

  /**
   * Count of active sessions.
   */
  get size(): number {
    return this.activeCases.size;
  }

  /**
   * Iterate all active sessions.
   */
  *[Symbol.iterator](): Iterator<CaseSession> {
    for (const session of this.activeCases.values()) {
      yield session;
    }
  }

  /**
   * Get all sessions as an array.
   */
  all(): CaseSession[] {
    return [...this.activeCases.values()];
  }

  /**
   * Append a message to a session's history.
   */
  appendMessage(caseId: string, role: Message['role'], content: string): void {
    const session = this.activeCases.get(caseId);
    if (!session) return;

    session.messages.push({ role, content, timestamp: new Date().toISOString() });
    session.turnCount++;
    session.lastActiveAt = new Date();
    // Rough token estimate: ~4 chars per token
    session.totalTokens += Math.ceil(content.length / 4);
  }
}
