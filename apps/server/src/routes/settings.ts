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
          // Agent Runtime settings (defaults)
          agentRuntimeEnabled: data.agentRuntimeEnabled ?? false,
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
