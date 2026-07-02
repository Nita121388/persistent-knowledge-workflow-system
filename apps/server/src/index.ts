import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { initStorage, getDb, schema } from '@pkws/storage';
import { eq } from 'drizzle-orm';
import { logRoutes } from './routes/logs.js';
import { settingsRoutes } from './routes/settings.js';
import { caseRoutes } from './routes/cases.js';
import { inboxRoutes } from './routes/inbox.js';
import { anchorRoutes } from './routes/anchors.js';
import { workspaceRuleRoutes } from './routes/workspace-rules.js';
import { jobRoutes } from './routes/jobs.js';
import { healthRoutes } from './routes/health.js';
import { agentRuntimeRoutes } from './routes/agent-runtime.js';
import { agentRuntimeWsRoutes } from './routes/agent-runtime-ws.js';
import { startWorker } from './worker/index.js';
import { initFileWatcher } from './watcher.js';
import { startAgentRuntime, type AgentRuntime, type WsEvent, logger } from '@pkws/agent-runtime';
import { broadcastWsEvent, broadcastLogEntry } from './ws-broadcast.js';
import type { Settings } from '@pkws/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Global reference so route handlers can call onUserInput
export let agentRuntime: AgentRuntime | null = null;

/**
 * Load settings from the database (if initialized).
 */
async function loadSettings(): Promise<Settings | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(schema.settings).all();
    if (rows.length === 0) return null;
    const s = rows[0];
    return {
      vaultPath: s.vaultPath,
      inboxPath: s.inboxPath,
      workspacePath: s.workspacePath,
      aiProvider: s.aiProvider as any,
      aiBaseUrl: s.aiBaseUrl,
      aiApiKeyConfigured: !!s.aiApiKeyEncrypted,
      aiDefaultModel: s.aiDefaultModel,
      aiMaxTokens: s.aiMaxTokens ?? undefined,
      autoAnalyze: s.autoAnalyze,
      agentRuntimeEnabled: !!s.agentRuntimeEnabled,
      agentCliPath: s.agentCliPath || '',
      autoDetectAgents: !!s.autoDetectAgents,
      maxActiveSessions: s.maxActiveSessions,
      sessionTimeoutMinutes: s.sessionTimeoutMinutes,
      contextCompressThreshold: s.contextCompressThreshold,
      contextKeepRecentCount: s.contextKeepRecentCount,
      maxTokensPerSession: s.maxTokensPerSession,
      sandboxMode: (s.sandboxMode || 'workspace-only') as any,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  } catch {
    return null;
  }
}

async function main() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(fastifyWebsocket);

  // Check if settings exist to know if we need setup
  const configPath = path.join(__dirname, '..', 'config.json');
  let needsSetup = true;
  let workspacePath = '';

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      workspacePath = config.workspacePath || '';
      if (workspacePath && fs.existsSync(workspacePath)) {
        needsSetup = false;
      }
    } catch {
      // config corrupt, needs setup
    }
  }

  if (!needsSetup) {
    initStorage(workspacePath);
    // Initialize logger after storage
    logger.init(getDb(), schema);
    logger.setWsBroadcast(broadcastLogEntry);
    logger.info('system', 'Logger initialized with SQLite + WebSocket');

    startWorker();
    initFileWatcher();

    // Agent Runtime: start if enabled in settings
    const settings = await loadSettings();
    if (settings?.agentRuntimeEnabled) {
      try {
        const { createPersistence } = await import('@pkws/agent-runtime');
        const persistence = createPersistence(getDb(), schema);

        agentRuntime = await startAgentRuntime({
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
        agentRuntime.setWsBroadcast((event: WsEvent) => {
          broadcastWsEvent(event);
        });

        console.log('[AgentRuntime] Started successfully via settings');
      } catch (err) {
        console.error('[AgentRuntime] Failed to start:', err);
      }
    } else {
      console.log('[AgentRuntime] Disabled (not configured or not enabled)');
    }
  } else {
    // Delete stale config.json so fresh setup creates proper DB
    try { fs.unlinkSync(configPath); } catch {}
  }

  // Register routes
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api' });
  await app.register(caseRoutes, { prefix: '/api' });
  await app.register(inboxRoutes, { prefix: '/api' });
  await app.register(anchorRoutes, { prefix: '/api' });
  await app.register(workspaceRuleRoutes, { prefix: '/api' });
  await app.register(jobRoutes, { prefix: '/api' });
  await app.register(agentRuntimeRoutes, { prefix: '/api' });
  await app.register(agentRuntimeWsRoutes, { prefix: '/api' });
  await app.register(logRoutes, { prefix: '/api' });

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3731;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    logger.info('system', `PKWS Server running at http://localhost:${port}`);
    console.log(`Status: ${needsSetup ? 'SETUP REQUIRED' : 'READY'}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
