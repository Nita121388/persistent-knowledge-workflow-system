import { getDb, schema } from '@pkws/storage';
import { eq, and, like } from 'drizzle-orm';
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
  const row = db.select().from(schema.settings).get();
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function handleScanInbox(job: Job) {
  const settings = await getSettings();
  const db = getDb();

  // Configure AI if available
  if (settings.aiApiKeyConfigured && settings.aiBaseUrl) {
    const settingRow = db.select().from(schema.settings).get();
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

  for (const filePath of files) {
    // Check if already processed
    const content = await readMarkdown(filePath);
    if (!content) continue;

    const existingPkwsId = content.data.pkws_id as string | undefined;

    let anchorId: string;
    if (existingPkwsId) {
      anchorId = existingPkwsId;
    } else {
      anchorId = genAnchorId();

      // Write pkws_id to file
      const written = await writePkwsId(filePath, anchorId);
      if (written) {
        db.insert(schema.timelineEvents).values({
          id: genEventId(),
          caseId: '',  // Will be set after case creation
          type: 'pkws_id_written',
          actor: 'system',
          summary: `Written pkws_id: ${anchorId}`,
          dataJson: JSON.stringify({ filePath }),
          createdAt: new Date().toISOString(),
        }).run();
      }
    }

    // Create anchor if not exists
    const existingAnchor = db.select()
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
    const pendingStatuses = ['Captured', 'Analyzing', 'ReviewRequired', 'NeedDiscussion', 'PatchPreview', 'Approved', 'Applying'];
    const existingCase = db.select()
      .from(schema.cases)
      .where(
        and(
          eq(schema.cases.anchorId, anchorId),
          inArray(schema.cases.status, pendingStatuses)
        )
      )
      .get();

    if (existingCase) continue; // Skip if already has pending case

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
}

async function handleWritePkwsId(job: Job) {
  // This is handled inline in scan_inbox
  // Reserved for future standalone use
}

async function handleGenerateProposal(job: Job) {
  const payload = JSON.parse(job.payloadJson);
  const { caseId } = payload;
  const db = getDb();

  const caseRow = db.select()
    .from(schema.cases)
    .where(eq(schema.cases.id, caseId))
    .get();
  if (!caseRow) throw new Error(`Case not found: ${caseId}`);

  const artifact = db.select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.id, caseRow.primaryArtifactId))
    .get();
  if (!artifact) throw new Error(`Artifact not found: ${caseRow.primaryArtifactId}`);

  const anchor = db.select()
    .from(schema.knowledgeAnchors)
    .where(eq(schema.knowledgeAnchors.id, caseRow.anchorId))
    .get();

  // Read the actual content
  const md = await readMarkdown(artifact.vaultPath);
  if (!md) throw new Error(`Cannot read file: ${artifact.vaultPath}`);

  // Check instruction summary
  const instructionSummary = db.select()
    .from(schema.caseInstructionSummaries)
    .where(eq(schema.caseInstructionSummaries.caseId, caseId))
    .get();

  // Check workspace rules
  const rules = db.select()
    .from(schema.workspaceRules)
    .where(eq(schema.workspaceRules.enabled, true))
    .orderBy(schema.workspaceRules.priority)
    .all();

  const tagsStr = md.data.tags ? JSON.stringify(md.data.tags) : undefined;

  // Call AI
  db.insert(schema.timelineEvents).values({
    id: genEventId(),
    caseId,
    type: 'ai_proposal_started',
    actor: 'ai',
    summary: 'AI analysis started',
    createdAt: new Date().toISOString(),
  }).run();

  const proposal = await generateProposal(
    {
      title: artifact.title || 'Untitled',
      contentBody: md.body,
      sourceUrl: artifact.sourceUrl,
      frontmatterTags: tagsStr,
      instructionSummary: instructionSummary?.summary,
      workspaceRules: rules.map(r => `[${r.title}] ${r.content}`).join('\n'),
    },
    caseId,
  );

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

  const caseRow = db.select()
    .from(schema.cases)
    .where(eq(schema.cases.id, caseId))
    .get();
  if (!caseRow) throw new Error(`Case not found: ${caseId}`);

  const artifact = db.select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.id, caseRow.primaryArtifactId))
    .get();
  if (!artifact) throw new Error('Artifact not found');

  const md = await readMarkdown(artifact.vaultPath);
  if (!md) throw new Error('Cannot read artifact file');

  const instructionSummary = db.select()
    .from(schema.caseInstructionSummaries)
    .where(eq(schema.caseInstructionSummaries.caseId, caseId))
    .get();

  const rules = db.select()
    .from(schema.workspaceRules)
    .where(eq(schema.workspaceRules.enabled, true))
    .orderBy(schema.workspaceRules.priority)
    .all();

  const pi = db.select()
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

  const patch = db.select()
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

  const applyManifest = db.select()
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

    const caseRow = db.select()
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

function inArray(col: any, vals: any[]) {
  const { inArray: drizzleInArray } = require('drizzle-orm');
  return drizzleInArray(col, vals);
}
