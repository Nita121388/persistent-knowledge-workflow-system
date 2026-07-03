import { getDb, schema } from '@pkws/storage';
import { eq, and, like, inArray } from 'drizzle-orm';
import { generateProposal, generatePatchContent, getAiConfig } from '@pkws/ai';
import { readMarkdown, computeHash, writePkwsId, executePatch, rollbackApply, scanMarkdownFiles } from '@pkws/vault';
import {
  genAnchorId, genArtifactId, genCaseId, genEventId,
  genPatchManifestId,
  type Job,
} from '@pkws/shared/utils.js';
import type { Settings, KnowledgeAnchor } from '@pkws/shared';
import fs from 'node:fs';
import path from 'node:path';

// 短期优化：Worker 常驻 + 内存 Case 上下文
// 在进程内存中维护 Case 的对话历史，避免每次从零重建
// 参考 docs/agent/agent-runtime.md §2.1 / §10 短期优化
interface ConversationContext {
  caseId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: string }>;
  turnCount: number;
  compressedSummary: string | null;
  lastActiveAt: number;
}

const MAX_CONTEXTS = 20;
const EVICT_AFTER_MS = 6 * 60 * 60 * 1000; // 6 小时
const COMPRESS_THRESHOLD = 20; // 消息数超过此值触发压缩
const KEEP_RECENT = 12; // 压缩后保留最近的消息数

const caseContexts = new Map<string, ConversationContext>();

function getOrCreateContext(caseId: string): ConversationContext {
  let ctx = caseContexts.get(caseId);
  if (!ctx) {
    ctx = {
      caseId,
      messages: [],
      turnCount: 0,
      compressedSummary: null,
      lastActiveAt: Date.now(),
    };
    caseContexts.set(caseId, ctx);
  }
  ctx.lastActiveAt = Date.now();
  return ctx;
}

function evictStaleContexts() {
  if (caseContexts.size <= MAX_CONTEXTS) return;
  const entries = [...caseContexts.entries()]
    .filter(([_, ctx]) => Date.now() - ctx.lastActiveAt > EVICT_AFTER_MS)
    .sort((a, b) => a[1].lastActiveAt - b[1].lastActiveAt);
  const toEvict = entries.slice(0, caseContexts.size - MAX_CONTEXTS);
  for (const [caseId] of toEvict) {
    caseContexts.delete(caseId);
  }
}

function appendToContext(ctx: ConversationContext, role: 'user' | 'assistant' | 'system', content: string) {
  ctx.messages.push({ role, content, timestamp: new Date().toISOString() });
  ctx.turnCount++;
  ctx.lastActiveAt = Date.now();

  // 超过阈值时压缩
  if (ctx.messages.length > COMPRESS_THRESHOLD) {
    const oldMessages = ctx.messages.slice(0, -KEEP_RECENT);
    ctx.compressedSummary = `Previous ${oldMessages.length} messages compressed. Summary: ${oldMessages.map(m => `[${m.role}]: ${m.content.slice(0, 100)}`).join('; ')}`;
    ctx.messages = ctx.messages.slice(-KEEP_RECENT);
  }
}

function buildContextPrompt(ctx: ConversationContext, currentInput: string): string {
  const parts: string[] = [];
  if (ctx.compressedSummary) {
    parts.push(`## Conversation History Summary\n${ctx.compressedSummary}\n`);
  }
  if (ctx.messages.length > 0) {
    parts.push('## Recent Conversation\n');
    for (const msg of ctx.messages) {
      parts.push(`${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`);
    }
  }
  parts.push(`\n## Current Input\n${currentInput}`);
  return parts.join('\n');
}

export async function handleJob(job: Job) {
  switch (job.type) {
    case 'scan_inbox':
      await handleScanInbox(job);
      break;
    case 'write_pkws_id':
      await handleWritePkwsId(job);
      break;
    case 'generate_proposal':
      await handleGenerateProposal(job);
      break;
    case 'generate_patch':
      await handleGeneratePatch(job);
      break;
    case 'apply_patch':
      await handleApplyPatch(job);
      break;
    case 'rollback_apply':
      await handleRollbackApply(job);
      break;
  }
}

async function getSettings(): Promise<Settings> {
  const db = getDb();
  const row = await db.select().from(schema.settings).get();
  if (!row) throw new Error('Settings not configured');
  return {
    vaultPath: row.vaultPath,
    inboxPath: row.inboxPath,
    workspacePath: row.workspacePath,
    aiProvider: row.aiProvider as any,
    aiBaseUrl: row.aiBaseUrl,
    aiApiKeyConfigured: !!row.aiApiKeyEncrypted,
    aiDefaultModel: row.aiDefaultModel,
    aiMaxTokens: row.aiMaxTokens ?? undefined,
    autoAnalyze: row.autoAnalyze,
    agentRuntimeEnabled: !!row.agentRuntimeEnabled,
    agentCliPath: row.agentCliPath || '',
    autoDetectAgents: !!row.autoDetectAgents,
    maxActiveSessions: row.maxActiveSessions,
    sessionTimeoutMinutes: row.sessionTimeoutMinutes,
    contextCompressThreshold: row.contextCompressThreshold,
    contextKeepRecentCount: row.contextKeepRecentCount,
    maxTokensPerSession: row.maxTokensPerSession,
    sandboxMode: (row.sandboxMode || 'workspace-only') as any,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function handleScanInbox(job: Job) {
  const settings = await getSettings();
  const db = getDb();

  // Configure AI if available
  if (settings.aiApiKeyConfigured && settings.aiBaseUrl) {
    const settingRow = await db.select().from(schema.settings).get();
    if (settingRow?.aiApiKeyEncrypted) {
      const { setAiConfig } = await import('@pkws/ai');
      setAiConfig({
        baseUrl: settings.aiBaseUrl,
        apiKey: settingRow.aiApiKeyEncrypted,
        defaultModel: settings.aiDefaultModel,
        maxTokens: settings.aiMaxTokens,
      });
    }
  }

  const files = await scanMarkdownFiles(settings.inboxPath);

  // Track scan statistics
  let scannedCount = 0;
  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const newCases: string[] = [];

  for (const filePath of files) {
    scannedCount++;

    // Check if already processed
    const content = await readMarkdown(filePath);
    if (!content) {
      errorCount++;
      continue;
    }

    const existingPkwsId = content.data.pkws_id as string | undefined;

    let anchorId: string;
    if (existingPkwsId) {
      anchorId = existingPkwsId;
    } else {
      anchorId = genAnchorId();

      // Write pkws_id to file
      const written = await writePkwsId(filePath, anchorId);
      if (written) {
        // Skip timeline event for pkws_id write since we don't have a case yet
        console.log(`  ✓ pkws_id written to ${path.basename(filePath)}`);
      }
    }

    // Create anchor if not exists
    const existingAnchor = await db.select()
      .from(schema.knowledgeAnchors)
      .where(eq(schema.knowledgeAnchors.id, anchorId))
      .get();

    if (!existingAnchor) {
      const now = new Date().toISOString();
      db.insert(schema.knowledgeAnchors).values({
        id: anchorId,
        currentVaultPath: filePath,
        originalVaultPath: filePath,
        title: content.data.title as string || path.basename(filePath, '.md'),
        sourceUrl: content.data.source_url as string || content.data.url as string,
        firstSeenAt: now,
        lastSeenAt: now,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }).run();
    } else {
      // Update last seen
      db.update(schema.knowledgeAnchors)
        .set({ lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .where(eq(schema.knowledgeAnchors.id, anchorId))
        .run();
    }

    // Check if there's already a pending case for this anchor
    const pendingStatuses: any = ['Captured', 'Analyzing', 'ReviewRequired', 'NeedDiscussion', 'PatchPreview', 'Approved', 'Applying'];
    const existingCase = await db.select()
      .from(schema.cases)
      .where(
        and(
          eq(schema.cases.anchorId, anchorId),
          inArray(schema.cases.status, pendingStatuses)
        )
      )
      .get();

    if (existingCase) {
      skippedCount++;
      continue; // Skip if already has pending case
    }

    // Create artifact
    const artifactId = genArtifactId();
    const now = new Date().toISOString();
    const contentHash = await computeHash(filePath);

    db.insert(schema.artifacts).values({
      id: artifactId,
      anchorId,
      type: 'vault_markdown',
      vaultPath: filePath,
      title: content.data.title as string || path.basename(filePath, '.md'),
      sourceUrl: content.data.source_url as string || content.data.url as string,
      contentHash,
      frontmatterJson: JSON.stringify(content.data),
      capturedAt: content.data.captured_at as string || now,
      createdAt: now,
      updatedAt: now,
    }).run();

    // Create case
    const caseId = genCaseId();
    newCases.push(caseId);
    db.insert(schema.cases).values({
      id: caseId,
      anchorId,
      primaryArtifactId: artifactId,
      title: content.data.title as string || path.basename(filePath, '.md'),
      status: 'Captured',
      source: 'clipper',
      createdAt: now,
      updatedAt: now,
    }).run();
    createdCount++;

    // Create case_created event
    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'case_created',
      actor: 'system',
      summary: `Case created from ${path.basename(filePath)}`,
      dataJson: JSON.stringify({ filePath, anchorId, artifactId }),
      createdAt: now,
    }).run();

    // If auto-analyze is enabled, create proposal job
    if (settings.autoAnalyze) {
      db.update(schema.cases)
        .set({ status: 'Analyzing', updatedAt: new Date().toISOString() })
        .where(eq(schema.cases.id, caseId))
        .run();

      const { createJob } = await import('./job-queue.js');
      await createJob({
        type: 'generate_proposal',
        payload: { caseId },
      });
    }
  }

  // Record scan summary
  const summaryMessage = `Scan inbox: ${createdCount} created, ${skippedCount} skipped (already pending), ${errorCount} errors, out of ${scannedCount} files`;
  console.log(`  ${summaryMessage}`);

  // Store result on the job for frontend polling
  const summaryPayload = JSON.stringify({
    scannedCount,
    createdCount,
    skippedCount,
    errorCount,
    newCaseIds: newCases,
  });
  db.update(schema.jobs)
    .set({ resultJson: summaryPayload })
    .where(eq(schema.jobs.id, job.id))
    .run();

  // Create a scan_completed timeline event (system-level, not per-case)
  try {
    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId: '',
      type: 'scan_completed',
      actor: 'system',
      summary: summaryMessage,
      dataJson: summaryPayload,
      createdAt: new Date().toISOString(),
    }).run();
  } catch {
    // Some DB schemas require a valid caseId — this is best-effort
  }
}

async function handleWritePkwsId(job: Job) {
  // This is handled inline in scan_inbox
  // Reserved for future standalone use
}

async function handleGenerateProposal(job: Job) {
  const payload = JSON.parse(job.payloadJson);
  const { caseId } = payload;
  const userComment = payload.comment as string | undefined;
  const db = getDb();

  // Ensure AI is configured
  const sRow = await db.select().from(schema.settings).get();
  if (sRow?.aiApiKeyEncrypted && sRow.aiBaseUrl) {
    const { setAiConfig } = await import('@pkws/ai');
    setAiConfig({
      baseUrl: sRow.aiBaseUrl,
      apiKey: sRow.aiApiKeyEncrypted,
      defaultModel: sRow.aiDefaultModel,
      maxTokens: sRow.aiMaxTokens ?? undefined,
    });
  }

  const caseRow = await db.select()
    .from(schema.cases)
    .where(eq(schema.cases.id, caseId))
    .get();
  if (!caseRow) throw new Error(`Case not found: ${caseId}`);

  // If case is in Analyzing or Captured, proceed; if already has a proposal, it's a regenerate
  const isAnalyzing = caseRow.status === 'Analyzing';
  const isCaptured = caseRow.status === 'Captured';

  const artifact = await db.select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.id, caseRow.primaryArtifactId))
    .get();
  if (!artifact) throw new Error(`Artifact not found: ${caseRow.primaryArtifactId}`);

  const anchor = await db.select()
    .from(schema.knowledgeAnchors)
    .where(eq(schema.knowledgeAnchors.id, caseRow.anchorId))
    .get();

  // Read the actual content
  const md = await readMarkdown(artifact.vaultPath);
  if (!md) throw new Error(`Cannot read file: ${artifact.vaultPath}`);

  // Check instruction summary
  const instructionSummary = await db.select()
    .from(schema.caseInstructionSummaries)
    .where(eq(schema.caseInstructionSummaries.caseId, caseId))
    .get();

  // Check workspace rules
  const rules = await db.select()
    .from(schema.workspaceRules)
    .where(eq(schema.workspaceRules.enabled, true))
    .orderBy(schema.workspaceRules.priority)
    .all();

  const frontmatterStr = md.data && Object.keys(md.data).length > 0
    ? JSON.stringify(md.data, null, 2)
    : undefined;

  // Call AI — with memory context
  db.insert(schema.timelineEvents).values({
    id: genEventId(),
    caseId,
    type: 'ai_proposal_started',
    actor: 'ai',
    summary: 'AI analysis started',
    createdAt: new Date().toISOString(),
  }).run();

  // 短期优化：从内存上下文读取历史，构建带历史的 prompt
  const ctx = getOrCreateContext(caseId);

  // 如果有用户的 comment，记录到上下文
  if (userComment) {
    appendToContext(ctx, 'user', userComment);
  }

  const proposal = await generateProposal(
    {
      title: artifact.title || 'Untitled',
      contentBody: md.body,
      sourceUrl: artifact.sourceUrl,
      frontmatterContext: frontmatterStr,
      instructionSummary: instructionSummary?.summary,
      workspaceRules: rules.map(r => `[${r.title}] ${r.content}`).join('\n'),
      conversationHistory: ctx.messages.length > 0
        ? buildContextPrompt(ctx, '')
        : undefined,
    },
    caseId,
  );

  // 记录到内存上下文
  appendToContext(ctx, 'user', `Generate proposal for: ${artifact.title}`);
  appendToContext(ctx, 'assistant', `Proposal generated: ${proposal.title} — ${proposal.reasoningSummary?.slice(0, 200)}`);

  // Save proposal
  db.insert(schema.proposals).values({
    id: proposal.id,
    caseId: proposal.caseId,
    model: proposal.model,
    title: proposal.title,
    summary: proposal.summary,
    valueJudgement: proposal.valueJudgement,
    suggestedActions: JSON.stringify(proposal.suggestedActions),
    suggestedTargetPath: proposal.suggestedTargetPath,
    reasoningSummary: proposal.reasoningSummary,
    risks: proposal.risks ? JSON.stringify(proposal.risks) : null,
    requiresPatch: proposal.requiresPatch ? 1 : 0,
    rawJson: proposal.rawJson,
    createdAt: proposal.createdAt,
  }).run();

  // Update case
  db.update(schema.cases)
    .set({
      status: 'ReviewRequired',
      currentProposalId: proposal.id,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.cases.id, caseId))
    .run();

  db.insert(schema.timelineEvents).values({
    id: genEventId(),
    caseId,
    type: 'ai_proposal_generated',
    actor: 'ai',
    summary: `Proposal: ${proposal.title} — ${proposal.reasoningSummary.slice(0, 100)}`,
    dataJson: JSON.stringify({ proposalId: proposal.id }),
    createdAt: new Date().toISOString(),
  }).run();
}

async function handleGeneratePatch(job: Job) {
  const payload = JSON.parse(job.payloadJson);
  const { caseId, patchIntentId, action } = payload;
  const db = getDb();

  // Ensure AI is configured
  const sRow = await db.select().from(schema.settings).get();
  if (sRow?.aiApiKeyEncrypted && sRow.aiBaseUrl) {
    const { setAiConfig } = await import('@pkws/ai');
    setAiConfig({
      baseUrl: sRow.aiBaseUrl,
      apiKey: sRow.aiApiKeyEncrypted,
      defaultModel: sRow.aiDefaultModel,
      maxTokens: sRow.aiMaxTokens ?? undefined,
    });
  }

  const caseRow = await db.select()
    .from(schema.cases)
    .where(eq(schema.cases.id, caseId))
    .get();
  if (!caseRow) throw new Error(`Case not found: ${caseId}`);

  const artifact = await db.select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.id, caseRow.primaryArtifactId))
    .get();
  if (!artifact) throw new Error('Artifact not found');

  const md = await readMarkdown(artifact.vaultPath);
  if (!md) throw new Error('Cannot read artifact file');

  const instructionSummary = await db.select()
    .from(schema.caseInstructionSummaries)
    .where(eq(schema.caseInstructionSummaries.caseId, caseId))
    .get();

  const rules = await db.select()
    .from(schema.workspaceRules)
    .where(eq(schema.workspaceRules.enabled, true))
    .orderBy(schema.workspaceRules.priority)
    .all();

  const pi = await db.select()
    .from(schema.patchIntents)
    .where(eq(schema.patchIntents.id, patchIntentId))
    .get();

  // Generate patch content
  const operationsJson = await generatePatchContent(
    action,
    pi?.instruction || undefined,
    pi?.targetPath || undefined,
    artifact.title || 'Untitled',
    md.content,
    instructionSummary?.summary,
    rules.map(r => `[${r.title}] ${r.content}`).join('\n'),
    caseId,
  );

  // Compute base hashes
  const operations = JSON.parse(operationsJson);
  const baseHashes: Record<string, string> = {};
  for (const op of operations) {
    if (op.type === 'update_file') {
      baseHashes[op.path] = await computeHash(op.path);
    } else if (op.type === 'move_file') {
      baseHashes[op.fromPath] = await computeHash(op.fromPath);
    }
  }

  // Save patch manifest
  const patchId = genPatchManifestId();
  const now = new Date().toISOString();

  db.insert(schema.patchManifests).values({
    id: patchId,
    caseId,
    patchIntentId,
    status: 'preview',
    operationsJson,
    baseFileHashesJson: JSON.stringify(baseHashes),
    createdAt: now,
    updatedAt: now,
  }).run();

  // Update patch intent status
  db.update(schema.patchIntents)
    .set({ status: 'generated', updatedAt: now })
    .where(eq(schema.patchIntents.id, patchIntentId))
    .run();

  // Update case
  db.update(schema.cases)
    .set({ status: 'PatchPreview', currentPatchId: patchId, updatedAt: now })
    .where(eq(schema.cases.id, caseId))
    .run();

  db.insert(schema.timelineEvents).values({
    id: genEventId(),
    caseId,
    type: 'patch_generated',
    actor: 'ai',
    summary: `Patch generated: ${operations.length} operation(s)`,
    dataJson: JSON.stringify({ patchId }),
    createdAt: now,
  }).run();
}

async function handleApplyPatch(job: Job) {
  const payload = JSON.parse(job.payloadJson);
  const { caseId, patchManifestId } = payload;
  const db = getDb();
  const settings = await getSettings();

  const patch = await db.select()
    .from(schema.patchManifests)
    .where(eq(schema.patchManifests.id, patchManifestId))
    .get();
  if (!patch) throw new Error(`Patch not found: ${patchManifestId}`);

  const backupDir = path.join(settings.workspacePath, 'backups', caseId);

  db.update(schema.cases)
    .set({ status: 'Applying', updatedAt: new Date().toISOString() })
    .where(eq(schema.cases.id, caseId))
    .run();

  db.insert(schema.timelineEvents).values({
    id: genEventId(),
    caseId,
    type: 'apply_started',
    actor: 'system',
    summary: 'Applying patch to vault',
    createdAt: new Date().toISOString(),
  }).run();

  try {
    const applyManifest = await executePatch(patch as any, {
      vaultPath: settings.vaultPath,
      backupsPath: backupDir,
    });

    // Save apply manifest
    db.insert(schema.applyManifests).values({
      id: applyManifest.id,
      caseId: applyManifest.caseId,
      patchManifestId: applyManifest.patchManifestId,
      status: applyManifest.status,
      appliedOperationsJson: applyManifest.appliedOperationsJson,
      backupRefsJson: applyManifest.backupRefsJson,
      appliedAt: applyManifest.appliedAt,
    }).run();

    // Update patch status
    db.update(schema.patchManifests)
      .set({ status: 'applied', updatedAt: new Date().toISOString() })
      .where(eq(schema.patchManifests.id, patchManifestId))
      .run();

    // Update case status
    db.update(schema.cases)
      .set({ status: 'Done', closedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schema.cases.id, caseId))
      .run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'apply_completed',
      actor: 'system',
      summary: `Patch applied successfully — ${applyManifest.id}`,
      dataJson: JSON.stringify({ applyManifestId: applyManifest.id }),
      createdAt: new Date().toISOString(),
    }).run();
  } catch (err: any) {
    // Rollback in case of error
    db.update(schema.cases)
      .set({ status: 'Error', updatedAt: new Date().toISOString() })
      .where(eq(schema.cases.id, caseId))
      .run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'error_occurred',
      actor: 'system',
      summary: `Apply failed: ${err.message}`,
      createdAt: new Date().toISOString(),
    }).run();

    throw err;
  }
}

async function handleRollbackApply(job: Job) {
  const payload = JSON.parse(job.payloadJson);
  const { caseId, applyManifestId } = payload;
  const db = getDb();
  const settings = await getSettings();

  const applyManifest = await db.select()
    .from(schema.applyManifests)
    .where(eq(schema.applyManifests.id, applyManifestId))
    .get();
  if (!applyManifest) throw new Error(`Apply manifest not found: ${applyManifestId}`);

  const backupDir = path.join(settings.workspacePath, 'backups', caseId);

  try {
    await rollbackApply(applyManifest as any, backupDir, {
      vaultPath: settings.vaultPath,
      backupsPath: backupDir,
    });

    // Update statuses
    db.update(schema.applyManifests)
      .set({ status: 'rolled_back', rolledBackAt: new Date().toISOString() })
      .where(eq(schema.applyManifests.id, applyManifestId))
      .run();

    const patchId = applyManifest.patchManifestId;
    if (patchId) {
      db.update(schema.patchManifests)
        .set({ status: 'draft', updatedAt: new Date().toISOString() })
        .where(eq(schema.patchManifests.id, patchId))
        .run();
    }

    const caseRow = await db.select()
      .from(schema.cases)
      .where(eq(schema.cases.id, caseId))
      .get();

    if (caseRow) {
      db.update(schema.cases)
        .set({ status: 'RolledBack', closedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .where(eq(schema.cases.id, caseId))
        .run();
    }

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'rollback_completed',
      actor: 'system',
      summary: `Rollback completed for apply ${applyManifestId}`,
      createdAt: new Date().toISOString(),
    }).run();
  } catch (err: any) {
    db.update(schema.applyManifests)
      .set({ status: 'rollback_blocked' })
      .where(eq(schema.applyManifests.id, applyManifestId))
      .run();

    db.insert(schema.timelineEvents).values({
      id: genEventId(),
      caseId,
      type: 'error_occurred',
      actor: 'system',
      summary: `Rollback blocked: ${err.message}`,
      createdAt: new Date().toISOString(),
    }).run();

    throw err;
  }
}


