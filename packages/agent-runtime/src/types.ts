import type { WorkspaceRule } from '@pkws/shared';
import type { CaseId } from '@pkws/shared';

// ---- Message ----
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

// ---- Actions (decided by Scheduler) ----
export enum Action {
  /** Append user input and call CLI */
  Continue = 'continue',
  /** Load full context from SQLite (first turn or after eviction recovery) */
  NewTurn = 'new_turn',
  /** Compress old messages into summary, keep recent N, then continue */
  CompressThenContinue = 'compress_then_continue',
}

// ---- CaseSession: in-memory state for one active Case ----
export interface CaseSession {
  caseId: CaseId;

  // Context
  messages: Message[];
  turnCount: number;
  totalTokens: number;

  // System inputs (used to build CLAUDE.md each turn)
  systemPrompt: string;
  workspaceRules: WorkspaceRule[];
  caseInstructions: string;

  // Scheduling state
  awaitingUserInput: boolean;
  hasNewUserInput: boolean;
  lastActiveAt: Date;

  // Compression
  compressedSummary?: string;
  compressionEpoch: number;
}

// ---- CLI Agent info (auto-detection result) ----
export interface AgentInfo {
  id: 'codex' | 'claude' | 'custom';
  name: string;
  path: string | null;        // null = detected by session dirs but not on PATH
  sessionsDir?: string;
  projectDirs?: string[];
}

// ---- CLI runner result ----
export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  outputFiles: Array<{ path: string; content: string }>;
  timedOut: boolean;
  durationMs: number;
}

// ---- Session snapshot (for persistence / debug) ----
export interface SessionSnapshot {
  caseId: CaseId;
  turnCount: number;
  totalTokens: number;
  awaitingUserInput: boolean;
  hasNewUserInput: boolean;
  lastActiveAt: Date;
  compressionEpoch: number;
  messageCount: number;
}

// ---- AgentRuntimeOptions ----
export interface AgentRuntimeOptions {
  db: any;                   // Drizzle db instance
  workspacePath: string;
  vaultPath?: string;        // For vault-readonly sandbox mode
  cliPath?: string;          // Auto-detect if empty
  maxActiveSessions?: number;
  sessionTimeoutMinutes?: number;
  contextCompressThreshold?: number;
  contextKeepRecentCount?: number;
  maxTokensPerSession?: number;
  sandboxMode?: 'workspace-only' | 'vault-readonly' | 'full';
  persistence?: SessionPersistence;  // For eviction persistence / restore
}

// ---- Persistence interface (injected by server) ----
export interface SessionPersistence {
  /** Save a session's state to persistent storage */
  save(caseId: CaseId, data: {
    messages: Message[];
    compressedSummary: string | null;
    turnCount: number;
    totalTokens: number;
    compressionEpoch: number;
    awaitingUserInput: boolean;
  }): Promise<void>;
  /** Load a session's state from persistent storage */
  load(caseId: CaseId): Promise<{
    messages: Message[];
    compressedSummary: string | null;
    turnCount: number;
    totalTokens: number;
    compressionEpoch: number;
    awaitingUserInput: boolean;
  } | null>;
  /** Delete a session's persisted state */
  delete(caseId: CaseId): Promise<void>;
}

// ---- Default values ----
export const DEFAULTS = {
  maxActiveSessions: 10,
  sessionTimeoutMinutes: 360,
  contextCompressThreshold: 20,
  contextKeepRecentCount: 12,
  maxTokensPerSession: 32_000,
  sandboxMode: 'workspace-only' as const,
  sleepMs: 5000,
  cliTimeoutMs: 120_000,
};
