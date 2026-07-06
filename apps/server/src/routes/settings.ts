import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@pkws/storage';
import { eq } from 'drizzle-orm';
import { SettingsUpdateSchema, TestModelRequestSchema } from '@pkws/shared/utils.js';
import { testModel, setAiConfig } from '@pkws/ai';
import fs from 'node:fs';
import path from 'node:path';
import { initStorage } from '@pkws/storage';
import { startWorker } from '../worker/index.js';
import { initFileWatcher } from '../watcher.js';
import { setAgentRuntime, loadSettings } from '../index.js';
import { broadcastWsEvent } from '../ws-broadcast.js';

const CONFIG_PATH = path.join(import.meta.dirname, '..', '..', 'config.json');

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/settings', async (request, reply) => {
    try {
      const db = getDb();
      const rows = await db.select().from(schema.settings).all();
      if (rows.length === 0) {
        return reply.status(404).send({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'No settings configured yet' },
        });
      }
      const s = rows[0];
      return {
        ok: true,
        data: {
          vaultPath: s.vaultPath,
          inboxPath: s.inboxPath,
          workspacePath: s.workspacePath,
          aiProvider: s.aiProvider,
          aiBaseUrl: s.aiBaseUrl,
          aiApiKeyConfigured: !!s.aiApiKeyEncrypted,
          aiDefaultModel: s.aiDefaultModel,
          aiMaxTokens: s.aiMaxTokens,
          autoAnalyze: s.autoAnalyze,
          // Agent Runtime
          agentRuntimeEnabled: !!s.agentRuntimeEnabled,
          agentCliPath: s.agentCliPath || '',
          autoDetectAgents: !!s.autoDetectAgents,
          maxActiveSessions: s.maxActiveSessions,
          sessionTimeoutMinutes: s.sessionTimeoutMinutes,
          contextCompressThreshold: s.contextCompressThreshold,
          contextKeepRecentCount: s.contextKeepRecentCount,
          maxTokensPerSession: s.maxTokensPerSession,
          sandboxMode: s.sandboxMode || 'workspace-only',
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        },
      };
    } catch (err: any) {
      if (err.message?.includes('not initialized')) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'NOT_INITIALIZED', message: 'System not initialized. Please run setup.' },
        });
      }
      throw err;
    }
  });

  app.put('/settings', async (request, reply) => {
    const parsed = SettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid settings',
          details: parsed.error.flatten(),
        },
      });
    }

    const data = parsed.data;

    // Validate vault path
    if (!fs.existsSync(data.vaultPath)) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: `Vault path does not exist: ${data.vaultPath}` },
      });
    }

    // Validate inbox is inside vault
    const resolvedInbox = path.resolve(data.inboxPath);
    const resolvedVault = path.resolve(data.vaultPath);
    const inboxIsInside = resolvedInbox === resolvedVault ||
      resolvedInbox.startsWith(resolvedVault + path.sep) ||
      resolvedInbox.startsWith(resolvedVault + '/');
    if (!inboxIsInside) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Inbox path must be inside vault path' },
      });
    }

    // Validate workspace is NOT inside vault
    const resolvedWs = path.resolve(data.workspacePath);
    const wsIsParent = resolvedVault === resolvedWs ||
      resolvedWs.startsWith(resolvedVault + path.sep) ||
      resolvedWs.startsWith(resolvedVault + '/');
    if (wsIsParent) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Workspace path should not be inside vault path' },
      });
    }

    // Ensure inbox and workspace directories exist
    fs.mkdirSync(data.inboxPath, { recursive: true });
    fs.mkdirSync(data.workspacePath, { recursive: true });

    const now = new Date().toISOString();

    try {
      const db = getDb();
      const existing = await db.select().from(schema.settings).all();

      if (existing.length > 0) {
        db.update(schema.settings)
          .set({
            vaultPath: data.vaultPath,
            inboxPath: data.inboxPath,
            workspacePath: data.workspacePath,
            aiProvider: data.aiProvider,
            aiBaseUrl: data.aiBaseUrl,
            aiApiKeyEncrypted: data.aiApiKey ? data.aiApiKey : existing[0].aiApiKeyEncrypted,
            aiDefaultModel: data.aiDefaultModel,
            aiMaxTokens: data.aiMaxTokens ?? null,
            autoAnalyze: data.autoAnalyze,
            // Agent Runtime settings
            agentRuntimeEnabled: data.agentRuntimeEnabled ?? existing[0].agentRuntimeEnabled,
            agentCliPath: data.agentCliPath ?? existing[0].agentCliPath,
            autoDetectAgents: data.autoDetectAgents ?? existing[0].autoDetectAgents,
            maxActiveSessions: data.maxActiveSessions ?? existing[0].maxActiveSessions,
            sessionTimeoutMinutes: data.sessionTimeoutMinutes ?? existing[0].sessionTimeoutMinutes,
            contextCompressThreshold: data.contextCompressThreshold ?? existing[0].contextCompressThreshold,
            contextKeepRecentCount: data.contextKeepRecentCount ?? existing[0].contextKeepRecentCount,
            maxTokensPerSession: data.maxTokensPerSession ?? existing[0].maxTokensPerSession,
            sandboxMode: data.sandboxMode ?? existing[0].sandboxMode,
            updatedAt: now,
          })
          .where(eq(schema.settings.id, existing[0].id))
          .run();
      } else {
        db.insert(schema.settings).values({
          id: 'default',
          vaultPath: data.vaultPath,
          inboxPath: data.inboxPath,
          workspacePath: data.workspacePath,
          aiProvider: data.aiProvider,
          aiBaseUrl: data.aiBaseUrl,
          aiApiKeyEncrypted: data.aiApiKey || '',
          aiDefaultModel: data.aiDefaultModel,
          aiMaxTokens: data.aiMaxTokens ?? null,
          autoAnalyze: data.autoAnalyze,
          // Agent Runtime settings (defaults). Default to enabled unless the
          // caller explicitly opts out — the agent runtime is the primary path.
          agentRuntimeEnabled: data.agentRuntimeEnabled ?? true,
          agentCliPath: data.agentCliPath ?? '',
          autoDetectAgents: data.autoDetectAgents ?? true,
          maxActiveSessions: data.maxActiveSessions ?? 10,
          sessionTimeoutMinutes: data.sessionTimeoutMinutes ?? 360,
          contextCompressThreshold: data.contextCompressThreshold ?? 20,
          contextKeepRecentCount: data.contextKeepRecentCount ?? 12,
          maxTokensPerSession: data.maxTokensPerSession ?? 32000,
          sandboxMode: data.sandboxMode ?? 'workspace-only',
          createdAt: now,
          updatedAt: now,
        }).run();
      }
    } catch (err: any) {
      // DB not initialized yet — first-time setup
      if (err.message?.includes('not initialized')) {
        initStorage(data.workspacePath);
        const db = getDb();
        db.insert(schema.settings).values({
          id: 'default',
          vaultPath: data.vaultPath,
          inboxPath: data.inboxPath,
          workspacePath: data.workspacePath,
          aiProvider: data.aiProvider,
          aiBaseUrl: data.aiBaseUrl,
          aiApiKeyEncrypted: data.aiApiKey || '',
          aiDefaultModel: data.aiDefaultModel,
          aiMaxTokens: data.aiMaxTokens ?? null,
          autoAnalyze: data.autoAnalyze,
          createdAt: now,
          updatedAt: now,
        }).run();
      } else {
        throw err;
      }
    }

    // Save config for next restart
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      workspacePath: data.workspacePath,
      updatedAt: now,
    }, null, 2));

    // Configure AI
    if (data.aiApiKey || data.aiBaseUrl || data.aiDefaultModel) {
      setAiConfig({
        baseUrl: data.aiBaseUrl,
        apiKey: data.aiApiKey || '',
        defaultModel: data.aiDefaultModel,
        maxTokens: data.aiMaxTokens,
      });
    }

    // Start worker and watcher if not already running
    startWorker();
    initFileWatcher(data.inboxPath);

    // Hot-start the Agent Runtime if the user wants it on. The server-startup
    // path in index.ts only runs once per process; once a process is already
    // running (the common case for first-time setup via SetupWizard, or any
    // subsequent settings change), we have to start the runtime here too —
    // otherwise the runtime stays null until the next server restart, and
    // every /regenerate / /analyze / /comment falls back to the legacy
    // job-queue path. Mirrors the Start branch of /agent-runtime/toggle.
    if (data.agentRuntimeEnabled !== false) {
      try {
        const loaded = await loadSettings();
        if (loaded) {
          const { createPersistence, startAgentRuntime } = await import('@pkws/agent-runtime');
          const persistence = createPersistence(getDb(), schema);
          const runtime = await startAgentRuntime({
            db: getDb(),
            workspacePath: loaded.workspacePath,
            vaultPath: loaded.vaultPath,
            cliPath: loaded.agentCliPath || undefined,
            maxActiveSessions: loaded.maxActiveSessions,
            sessionTimeoutMinutes: loaded.sessionTimeoutMinutes,
            contextCompressThreshold: loaded.contextCompressThreshold,
            contextKeepRecentCount: loaded.contextKeepRecentCount,
            maxTokensPerSession: loaded.maxTokensPerSession,
            sandboxMode: loaded.sandboxMode,
            persistence,
          });
          runtime.setWsBroadcast((event: any) => { broadcastWsEvent(event); });
          setAgentRuntime(runtime);
          console.log('[Setup] Agent Runtime started after settings save');
        }
      } catch (err: any) {
        // The settings save itself already succeeded; don't fail the request
        // if the runtime fails to start. The user can retry from the
        // Agent Runtime Dashboard's toggle.
        console.error('[Setup] Failed to start Agent Runtime after settings save:', err);
      }
    }

    return {
      ok: true,
      data: { success: true },
    };
  });

  app.post('/settings/test-model', async (request, reply) => {
    const parsed = TestModelRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid test request',
          details: parsed.error.flatten(),
        },
      });
    }

    const data = parsed.data;

    try {
      const result = await testModel({
        baseUrl: data.aiBaseUrl,
        apiKey: data.aiApiKey,
        defaultModel: data.aiDefaultModel,
      });
      return { ok: true, data: result };
    } catch (err: any) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: 'AI_ERROR',
          message: `Model test failed: ${err.message}`,
        },
      });
    }
  });
};
