/**
 * PKWS Agent Runtime
 *
 * A persistent Node.js process that maintains in-memory context for multiple Cases,
 * schedules which Case to process next, and spawns CLI agents (Codex / Claude Code)
 * to execute tasks.
 *
 * See docs/agent/agent-runtime.md for design details.
 */

export { AgentRuntime } from './runtime.js';
export type { AgentRuntimeOptions } from './types.js';

export { SessionManager } from './session.js';
export type { CaseSession, Message, AgentInfo, CliResult, SessionSnapshot } from './types.js';
export { Action, DEFAULTS } from './types.js';

export { Scheduler, decideAction } from './scheduler.js';
export type { SchedulerOptions, SchedulerEvent } from './scheduler.js';

export { buildContext, compressSession, estimateTokens } from './context-builder.js';

export { runCliAgent, verifyCli, getAgentWorkDir } from './cli-runner.js';
export type { CliRunnerOptions } from './cli-runner.js';

export { detectAvailableAgents, resolveCliPath, isAnyAgentAvailable } from './agent-detect.js';

/**
 * Convenience factory: create and start an AgentRuntime in one call.
 */
import { AgentRuntime } from './runtime.js';
import type { AgentRuntimeOptions } from './types.js';

export async function startAgentRuntime(options: AgentRuntimeOptions): Promise<AgentRuntime> {
  const runtime = new AgentRuntime(options);
  await runtime.start();
  return runtime;
}
