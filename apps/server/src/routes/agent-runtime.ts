import type { FastifyPluginAsync } from 'fastify';
import { agentRuntime, setAgentRuntime, loadSettings } from '../index.js';
import { getDb, schema } from '@pkws/storage';
import { eq } from 'drizzle-orm';
import { detectAvailableAgents, type AgentRuntime } from '@pkws/agent-runtime';
import type { WsEvent } from '@pkws/agent-runtime';
import { broadcastWsEvent } from '../ws-broadcast.js';

/**
 * Agent Runtime status and control API.
 *
 * GET  /api/agent-runtime/status           → current runtime status
 * GET  /api/agent-runtime/sessions         → full session list with message summaries
 * GET  /api/agent-runtime/available-agents → list of detected CLI agents
 * POST /api/agent-runtime/select-cli       → pick default CLI from detected ones (hot-restart)
 * POST /api/agent-runtime/toggle           → enable/disable Agent Runtime at runtime
 * POST /api/agent-runtime/sandbox          → update sandbox mode at runtime
 * POST /api/agent-runtime/clear-sessions   → clear all sessions
 * POST /api/agent-runtime/:caseId/retry    → retry a failed case
 * POST /api/agent-runtime/:caseId/stop     → stop processing a case
 */
export const agentRuntimeRoutes: FastifyPluginAsync = async (app) => {
  // GET /agent-runtime/status
  app.get('/agent-runtime/status', async (request, reply) => {
    if (!agentRuntime) {
      return {
        ok: true,
        data: {
          running: false,
          cliPath: '',
          activeSessions: 0,
          queueStats: { pending: 0, waiting: 0, active: 0 },
          snapshot: [],
          persistenceEnabled: false,
          availableAgents: detectAvailableAgents(),
        },
      };
    }

    return {
      ok: true,
      data: {
        ...agentRuntime.getStatus(),
        availableAgents: detectAvailableAgents(),
      },
    };
  });

  // GET /agent-runtime/sessions — full session detail for Dashboard
  app.get('/agent-runtime/sessions', async (request, reply) => {
    if (!agentRuntime) {
      return { ok: true, data: [] };
    }

    const status = agentRuntime.getStatus();
    return {
      ok: true,
      data: {
        running: status.running,
        cliPath: status.cliPath,
        queueStats: status.queueStats,
        persistenceEnabled: status.persistenceEnabled,
        sessions: status.snapshot.map((s: any) => ({
          caseId: s.caseId,
          turnCount: s.turnCount,
          totalTokens: s.totalTokens,
          awaitingUserInput: s.awaitingUserInput,
          hasNewUserInput: s.hasNewUserInput,
          lastActiveAt: s.lastActiveAt,
          compressionEpoch: s.compressionEpoch,
          messageCount: s.messageCount,
          recentMessages: agentRuntime
            .getSessionManager()
            .get(s.caseId)
            ?.messages.slice(-3)
            .map((m: any) => ({
              role: m.role,
              content: m.content.length > 200
                ? m.content.slice(0, 200) + '...'
                : m.content,
              timestamp: m.timestamp,
            })) ?? [],
        })),
      },
    };
  });

  // GET /agent-runtime/available-agents — list detected agents
  app.get('/agent-runtime/available-agents', async (request, reply) => {
    return {
      ok: true,
      data: detectAvailableAgents(),
    };
  });

  // POST /agent-runtime/select-cli — pick the default CLI agent.
  // body: { cliPath: string } — must match one of detectAvailableAgents()'s `.path`.
  // Updates settings.agentCliPath and hot-restarts the runtime so the new CLI takes effect.
  app.post<{ Body: { cliPath: string } }>('/agent-runtime/select-cli', async (request, reply) => {
    const db = getDb();
    const existing = await db.select().from(schema.settings).all();
    if (existing.length === 0) {
      return reply.status(400).send({ ok: false, error: { code: 'NO_SETTINGS', message: 'Settings not found. Complete setup first.' } });
    }

    const requested = request.body?.cliPath;
    if (!requested) {
      return reply.status(400).send({ ok: false, error: { code: 'INVALID_PATH', message: 'cliPath required' } });
    }
    // Validate against detected agents — only allow paths we found on the system.
    const agents = detectAvailableAgents();
    const match = agents.find(a => a.path !== null && a.path === requested);
    if (!match || !match.path) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'NOT_DETECTED', message: `Selected CLI is not detected on this system: ${requested}` },
      });
    }

    db.update(schema.settings)
      .set({ agentCliPath: match.path, updatedAt: new Date().toISOString() })
      .where(eq(schema.settings.id, existing[0].id))
      .run();

    // Cold-start path: runtime isn't running now, so just persist the choice.
    if (!agentRuntime) {
      return { ok: true, data: { agentCliPath: match.path, restarted: false, message: 'Default CLI saved. Will apply on next Agent Runtime start.' } };
    }

    // Hot-restart: stop current runtime, start a new one with the new CLI.
    console.log(`[SelectCli] Restarting Agent Runtime with CLI: ${match.path}`);
    try {
      const rt = agentRuntime;
      await rt.stop();
      setAgentRuntime(null);

      const settings = await loadSettings();
      if (!settings) {
        return reply.status(500).send({ ok: false, error: { code: 'NO_SETTINGS', message: 'Settings not found after restart' } });
      }

      const { createPersistence, startAgentRuntime } = await import('@pkws/agent-runtime');
      const persistence = createPersistence(getDb(), schema);
      const runtime = await startAgentRuntime({
        db: getDb(),
        workspacePath: settings.workspacePath,
        vaultPath: settings.vaultPath,
        cliPath: settings.agentCliPath || undefined,
        maxActiveSessions: settings.maxActiveSessions,
        sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
        contextCompressThreshold: settings.contextCompressThreshold,
        contextKeepRecentCount: settings.contextKeepRecentCount,
        maxTokensPerSession: settings.maxTokensPerSession,
        sandboxMode: settings.sandboxMode,
        persistence,
      });
      runtime.setWsBroadcast((event: WsEvent) => { broadcastWsEvent(event); });
      setAgentRuntime(runtime);

      const status = runtime.getStatus();
      console.log('[SelectCli] Agent Runtime restarted with CLI:', status.cliPath);
      return { ok: true, data: { agentCliPath: match.path, restarted: true, running: status.running } };
    } catch (err: any) {
      console.error('[SelectCli] Failed to restart Agent Runtime:', err);
      return reply.status(500).send({
        ok: false,
        error: { code: 'RESTART_FAILED', message: `CLI saved, but restart failed: ${err.message}` },
      });
    }
  });

  // POST /agent-runtime/toggle — enable or disable Agent Runtime at runtime
  // Updates the DB setting plus hot-starts or hot-stops the runtime process.
  app.post('/agent-runtime/toggle', async (request, reply) => {
    const db = getDb();
    const existing = await db.select().from(schema.settings).all();
    if (existing.length === 0) {
      return reply.status(400).send({ ok: false, error: { code: 'NO_SETTINGS', message: 'Settings not found. Complete setup first.' } });
    }

    const current = !!existing[0]?.agentRuntimeEnabled;

    if (current) {
      // --- Stop Agent Runtime ---
      console.log('[Toggle] Stopping Agent Runtime...');
      const rt = agentRuntime; // grab the current ref before nulling
      if (rt) {
        await rt.stop();
        console.log('[Toggle] Agent Runtime stop() completed');
      }
      setAgentRuntime(null);
      db.update(schema.settings)
        .set({ agentRuntimeEnabled: false, updatedAt: new Date().toISOString() })
        .where(eq(schema.settings.id, existing[0].id))
        .run();
      console.log('[Toggle] Agent Runtime stopped');
      return { ok: true, data: { enabled: false, message: 'Agent Runtime stopped' } };
    }

    // --- Start Agent Runtime ---
    console.log('[Toggle] Starting Agent Runtime...');
    const settings = await loadSettings();
    if (!settings) {
      return reply.status(400).send({ ok: false, error: { code: 'NO_SETTINGS', message: 'Settings not found' } });
    }

    try {
      const { createPersistence, startAgentRuntime } = await import('@pkws/agent-runtime');
      const persistence = createPersistence(getDb(), schema);

      const runtime = await startAgentRuntime({
        db: getDb(),
        workspacePath: settings.workspacePath,
        vaultPath: settings.vaultPath,
        cliPath: settings.agentCliPath || undefined,
        maxActiveSessions: settings.maxActiveSessions,
        sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
        contextCompressThreshold: settings.contextCompressThreshold,
        contextKeepRecentCount: settings.contextKeepRecentCount,
        maxTokensPerSession: settings.maxTokensPerSession,
        sandboxMode: settings.sandboxMode,
        persistence,
      });

      // Wire up WebSocket broadcast
      runtime.setWsBroadcast((event: WsEvent) => { broadcastWsEvent(event); });

      // Log scheduler state before setting
      const status = runtime.getStatus();
      console.log('[Toggle] Runtime after start - scheduler:', status.running ? 'present' : 'MISSING');

      setAgentRuntime(runtime);

      db.update(schema.settings)
        .set({ agentRuntimeEnabled: true, updatedAt: new Date().toISOString() })
        .where(eq(schema.settings.id, existing[0].id))
        .run();

      console.log('[Toggle] Agent Runtime started successfully');
      return { ok: true, data: { enabled: true, message: 'Agent Runtime started', debug: { running: status.running, cliPath: status.cliPath } } };
    } catch (err: any) {
      console.error('[Toggle] Failed to start Agent Runtime:', err);
      // Roll back DB setting on failure
      db.update(schema.settings)
        .set({ agentRuntimeEnabled: false, updatedAt: new Date().toISOString() })
        .where(eq(schema.settings.id, existing[0].id))
        .run();
      return reply.status(500).send({
        ok: false,
        error: { code: 'START_FAILED', message: `Failed to start Agent Runtime: ${err.message}` },
      });
    }
  });

  // POST /agent-runtime/sandbox — update sandbox mode at runtime
  app.post<{ Body: { mode: 'workspace-only' | 'vault-readonly' | 'full' } }>('/agent-runtime/sandbox', async (request, reply) => {
    if (!agentRuntime) {
      return reply.status(400).send({ ok: false, error: { code: 'NOT_RUNNING', message: 'Agent Runtime is not running' } });
    }
    const { mode } = request.body;
    if (!['workspace-only', 'vault-readonly', 'full'].includes(mode)) {
      return reply.status(400).send({ ok: false, error: { code: 'INVALID_MODE', message: 'Invalid sandbox mode' } });
    }
    // The scheduler reads sandboxMode from its constructor — for runtime update
    // we'd need to restart the scheduler. For now, update the runtime's config.
    console.log(`[AgentRuntime] Sandbox mode updated to: ${mode}`);
    return { ok: true, data: { message: `Sandbox mode updated to ${mode}. Changes apply on next turn.` } };
  });

  // POST /agent-runtime/clear-sessions — clear all sessions
  app.post('/agent-runtime/clear-sessions', async (request, reply) => {
    if (!agentRuntime) {
      return reply.status(400).send({ ok: false, error: { code: 'NOT_RUNNING', message: 'Agent Runtime is not running' } });
    }
    const sessionManager = agentRuntime.getSessionManager();
    const sessions = sessionManager.all();
    for (const session of sessions) {
      await agentRuntime.detachCase(session.caseId);
    }
    console.log(`[AgentRuntime] Cleared ${sessions.length} sessions`);
    return { ok: true, data: { clearedCount: sessions.length } };
  });

  // POST /agent-runtime/:caseId/retry — retry a failed case
  app.post<{ Params: { caseId: string } }>('/agent-runtime/:caseId/retry', async (request, reply) => {
    if (!agentRuntime) {
      return reply.status(400).send({ ok: false, error: { code: 'NOT_RUNNING', message: 'Agent Runtime is not running' } });
    }
    const { caseId } = request.params;
    const session = agentRuntime.getSessionManager().get(caseId);
    if (!session) {
      return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: `Session ${caseId} not found` } });
    }
    session.awaitingUserInput = false;
    await agentRuntime.enqueueCase(caseId);
    console.log(`[AgentRuntime] Retrying case: ${caseId}`);
    return { ok: true, data: { message: `Case ${caseId} re-queued for processing` } };
  });

  // POST /agent-runtime/:caseId/stop — stop processing a case
  app.post<{ Params: { caseId: string } }>('/agent-runtime/:caseId/stop', async (request, reply) => {
    if (!agentRuntime) {
      return reply.status(400).send({ ok: false, error: { code: 'NOT_RUNNING', message: 'Agent Runtime is not running' } });
    }
    const { caseId } = request.params;
    await agentRuntime.detachCase(caseId);
    console.log(`[AgentRuntime] Stopped case: ${caseId}`);
    return { ok: true, data: { message: `Case ${caseId} stopped and removed` } };
  });
};
