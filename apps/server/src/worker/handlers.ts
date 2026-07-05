import { getDb, schema } from '@pkws/storage';
import { eq, and, like, inArray } from 'drizzle-orm';
import { generateProposal, getAiConfig } from '@pkws/ai';
import { readMarkdown, computeHash, writePkwsId, scanMarkdownFiles } from '@pkws/vault';
import {
  genAnchorId, genArtifactId, genCaseId, genEventId, genAiRunId,
  type Job,
} from '@pkws/shared/utils.js';
import type { Settings, KnowledgeAnchor, AiRunKind, AiRunTrigger } from '@pkws/shared';
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

    // Check if there's already a pending case for this anchor.
    // PatchPreview is no longer written under the unified ai_turn model
    // (task #9), but Approved / Applying remain here so legacy rows in
    // those patch-orchestration states still count as "occupied" and
    // block re-capture. They will be removed in task #16 once the
    // agent-runtime writers retire for good.
    const pendingStatuses: any = ['Captured', 'Analyzing', 'ReviewRequired', 'NeedDiscussion', 'Approved', 'Applying'];
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

  const rulesSnapshotJson = JSON.stringify(
    rules.map(r => ({ title: r.title, content: r.content, priority: r.priority })),
  );

  // ---- ai_runs: open a per-node AI processing row (line 2) ----
  // This row persists what the AI was fed this turn (rulesSnapshot +
  // inputContextJson) plus the result. kind/trigger are inferred from the
  // enqueue reason that scan_inbox / /analyze / /comment / /regenerate /
  // /invoke-next set on the job payload:
  //   undefined                 → auto_analyze (scan_inbox auto-schedule)
  //   'user_requested_analysis' → user_explicit (manual Analyze on Captured)
  //   'user_requested_regenerate' / 'user_comment' (with existing proposal)
  //                            → user_regenerate
  //   'user_invoke_next'        → user_invoke_next (invoke-next fallback path)
  const reason = (payload as Record<string, unknown>).reason as
    | 'user_requested_analysis' | 'user_requested_regenerate'
    | 'user_comment' | 'user_invoke_next' | undefined;
  const hasExistingProposal = !!caseRow.currentProposalId;
  let trigger: AiRunTrigger;
  if (reason === 'user_invoke_next') trigger = 'user_invoke_next';
  else if (reason === 'user_requested_analysis') trigger = 'user_explicit';
  else if (reason === 'user_requested_regenerate') trigger = 'user_regenerate';
  else if (reason === 'user_comment') trigger = hasExistingProposal ? 'user_regenerate' : 'user_explicit';
  else trigger = 'auto_analyze'; // scan_inbox auto-schedule carries no reason
  // invoke-next route falls back to generate_proposal handler; tag those
  // iterations as 'turn' so the case-detail AI nodes list can distinguish
  // proposal passes from invoke-next turns. proposalId stays null on turns.
  const kind: AiRunKind = reason === 'user_invoke_next' ? 'turn' : 'proposal';

  const frontmatterStr = md.data && Object.keys(md.data).length > 0
    ? JSON.stringify(md.data, null, 2)
    : undefined;

  // Build the input-context snapshot we will both feed the AI and persist
  // to ai_runs so each node's "raw materials" are transparent.
  const pickedActionEcho = reason === 'user_invoke_next' && payload.message
    ? (payload.message as string)
    : undefined;
  const inputContext = {
    artifact: {
      id: artifact.id,
      vaultPath: artifact.vaultPath,
      title: artifact.title,
      sourceUrl: artifact.sourceUrl,
    },
    frontmatter: md.data && Object.keys(md.data).length > 0 ? md.data : undefined,
    contentBody: md.body,
    instructionSummary: instructionSummary?.summary,
    conversationHistory: undefined as string | undefined, // filled after ctx build below
    userComment,
    pickedActionEcho,
  };

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

  const conversationHistory = ctx.messages.length > 0
    ? buildContextPrompt(ctx, '')
    : undefined;
  inputContext.conversationHistory = conversationHistory;

  const inputContextJson = JSON.stringify(inputContext);

  // Open the ai_runs row now (running). startedAt is recorded before the AI
  // call so durationMs reflects real AI latency, not queue wait.
  const aiRunId = genAiRunId();
  const startedAtIso = new Date().toISOString();
  const startedAtMs = Date.now();
  db.insert(schema.aiRuns).values({
    id: aiRunId,
    caseId,
    kind,
    trigger,
    model: sRow?.aiDefaultModel ?? 'unknown',
    status: 'running',
    rulesSnapshotJson,
    inputContextJson,
    startedAt: startedAtIso,
    createdAt: startedAtIso,
  }).run();

  let proposal;
  try {
    proposal = await generateProposal(
      {
        title: artifact.title || 'Untitled',
        contentBody: md.body,
        sourceUrl: artifact.sourceUrl,
        frontmatterContext: frontmatterStr,
        instructionSummary: instructionSummary?.summary,
        workspaceRules: rules.map(r => `[${r.title}] ${r.content}`).join('\n'),
        conversationHistory,
      },
      caseId,
    );
  } catch (err: any) {
    const finishedAtIso = new Date().toISOString();
    db.update(schema.aiRuns)
      .set({
        status: 'failed',
        error: err?.message ?? String(err),
        finishedAt: finishedAtIso,
        durationMs: Date.now() - startedAtMs,
      })
      .where(eq(schema.aiRuns.id, aiRunId))
      .run();
    throw err;
  }

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
    proposedNextActions: JSON.stringify(proposal.proposedNextActions),
    reasoningSummary: proposal.reasoningSummary,
    risks: proposal.risks ? JSON.stringify(proposal.risks) : null,
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

  // ---- ai_runs: close the per-node row as succeeded (line 2) ----
  // kind='proposal' rows link to the produced proposal; kind='turn' rows
  // (invoke-next) intentionally leave proposalId null even though the
  // fallback path also produced a proposal — the turn's "result" is the
  // next-action menu, not the proposal record itself.
  const finishedAtIso = new Date().toISOString();
  db.update(schema.aiRuns)
    .set({
      status: 'succeeded',
      outputSummary:
        kind === 'turn'
          ? (proposal.reasoningSummary ?? proposal.summary)?.slice(0, 1000)
          : proposal.summary,
      proposedNextActionsJson: JSON.stringify(proposal.proposedNextActions ?? []),
      proposalId: kind === 'proposal' ? proposal.id : null,
      finishedAt: finishedAtIso,
      durationMs: Date.now() - startedAtMs,
    })
    .where(eq(schema.aiRuns.id, aiRunId))
    .run();

  db.insert(schema.timelineEvents).values({
    id: genEventId(),
    caseId,
    type: 'ai_proposal_generated',
    actor: 'ai',
    summary: `Proposal: ${proposal.title} — ${proposal.reasoningSummary.slice(0, 100)}`,
    dataJson: JSON.stringify({ proposalId: proposal.id, aiRunId }),
    createdAt: new Date().toISOString(),
  }).run();
}

