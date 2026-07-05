import type { CaseId } from '@pkws/shared';
import type { CliProposal, CliPatchOperation } from './output-parser.js';
import { genProposalId, genEventId } from '@pkws/shared/utils.js';
import { applyOperations, type VaultSafetyConfig } from '@pkws/vault';
import type { PatchOperation } from '@pkws/shared';

/**
 * Write CLI output (proposal / patch operations) back to PKWS database tables.
 *
 * This bridges the Agent Runtime with the existing PKWS data model,
 * so that proposals and patches appear in the UI and follow the same
 * lifecycle as those generated via the direct LLM API path.
 */

interface WriterDb {
  select(): any;
  insert(table: any): any;
  update(table: any): any;
  run(sql: string, params: any[]): any;
}

export interface OutputWriterOptions {
  db: WriterDb;
  schema: any;
}

/**
 * Save a parsed CLI proposal to the proposals table and update the case.
 * Returns the proposal ID.
 */
export async function writeProposal(
  opts: OutputWriterOptions,
  caseId: CaseId,
  proposal: CliProposal,
  model: string,
): Promise<string> {
  const { db, schema } = opts;
  const proposalId = genProposalId();
  const now = new Date().toISOString();

  db.insert(schema.proposals).values({
    id: proposalId,
    caseId,
    model,
    title: proposal.title,
    summary: proposal.summary,
    valueJudgement: proposal.valueJudgement,
    proposedNextActions: JSON.stringify(proposal.proposedNextActions),
    reasoningSummary: proposal.reasoningSummary,
    risks: proposal.risks ? JSON.stringify(proposal.risks) : null,
    rawJson: JSON.stringify(proposal),
    createdAt: now,
  }).run();

  db.update(schema.cases).set({
    status: 'ReviewRequired',
    currentProposalId: proposalId,
    updatedAt: now,
  }).where(schema.cases.id.eq(caseId)).run();

  db.insert(schema.timelineEvents).values({
    id: genEventId(),
    caseId,
    type: 'ai_proposal_generated',
    actor: 'ai',
    summary: `Agent Runtime proposal: ${proposal.title}`,
    dataJson: JSON.stringify({ proposalId, model, source: 'agent-runtime' }),
    createdAt: now,
  }).run();

  console.log(`[OutputWriter] Saved proposal ${proposalId} for ${caseId}`);
  return proposalId;
}

/**
 * Apply CLI-agent-emitted patch operations directly to the real vault
 * (line 5 / task #16). The previous implementation staged operations as a
 * `patch_manifests` DB row (the old `writePatch`); line 1 retired that
 * table and the patch-orchestration UI in favor of "AI decides, user
 * approves via proposedNextActions, AI writes vault directly".
 *
 * This function:
 *   1. Maps `CliPatchOperation` (the parser's loose shape: create/update/
 *      move without `beforeHash`/`ifExists`) to the strict `PatchOperation`
 *      shape that `applyOperations` requires.
 *   2. Calls `applyOperations` from `@pkws/vault`, which reuses
 *      `executePatch`'s safety layer (path validation, hash check,
 *      on-disk backups under `backupsPath/apply_<id>/`).
 *   3. Records a `vault_modified` timeline event summarizing the write
 *      so the case detail view can show what the AI actually changed
 *      without exposing the user to a diff.
 *
 * Rollback is left to Obsidian's native version history / file backup,
 * per the user's design decision to stop over-engineering patch undo.
 *
 * Returns the synthesized `ApplyManifest` id (or null when there were no
 * operations, in which case nothing happens).
 */
export async function applyVaultOps(
  opts: OutputWriterOptions,
  caseId: CaseId,
  operations: CliPatchOperation[],
  vaultConfig: VaultSafetyConfig,
): Promise<string | null> {
  if (operations.length === 0) return null;

  const { db, schema } = opts;
  const now = new Date().toISOString();

  // Map parser's loose op shape → strict PatchOperation (filling the
  // required `beforeHash` / `ifExists` fields applyOperations will check).
  const patchOps: PatchOperation[] = operations.map(op => {
    if (op.type === 'create_file') {
      return { type: 'create_file', path: op.path, content: op.content, ifExists: 'fail' as const };
    }
    if (op.type === 'update_file') {
      return { type: 'update_file', path: op.path, newContent: op.newContent, beforeHash: '' /* computed inside applyOperations */ };
    }
    return { type: 'move_file', fromPath: op.fromPath, toPath: op.toPath, beforeHash: '', ifTargetExists: 'fail' as const };
  });

  let applyManifestId = 'unknown';
  let appliedCount = patchOps.length;
  let applyError: string | undefined;
  try {
    const applyManifest = await applyOperations(patchOps, caseId, vaultConfig);
    applyManifestId = applyManifest.id;
  } catch (err: any) {
    applyError = err?.message ?? String(err);
    appliedCount = 0;
    console.error(`[OutputWriter] Vault apply failed for ${caseId}:`, applyError);
  }

  // Record timeline event regardless of success; failures are surfaced
  // in the summary so the case detail view (and the AI on its next turn)
  // can see the vault-write didn't land.
  const summaryParts = [
    `Agent Runtime ${applyError ? 'failed to apply' : 'applied'} ${operations.length} vault op(s)`,
    applyError ? `error: ${applyError}` : `applyManifestId: ${applyManifestId}`,
  ];
  db.insert(schema.timelineEvents).values({
    id: genEventId(),
    caseId,
    type: 'vault_modified',
    actor: 'ai',
    summary: summaryParts.join(' — '),
    dataJson: JSON.stringify({
      source: 'agent-runtime',
      applyManifestId,
      operations: operations.map(op => op.type === 'move_file' ? { type: 'move_file', fromPath: op.fromPath, toPath: op.toPath } : { type: op.type, path: op.path }),
      error: applyError ?? null,
    }),
    createdAt: now,
  }).run();

  // Update case updated-at; intentionally do NOT flip the case status —
  // the case is already in NeedDiscussion (invoke-next set it) or
  // ReviewRequired (proposal pass). Vault writes are a side effect of
  // executing a user-approved modify_vault next-step, not a state change.
  db.update(schema.cases).set({
    updatedAt: now,
  }).where(schema.cases.id.eq(caseId)).run();

  if (!applyError) {
    console.log(`[OutputWriter] Applied ${operations.length} vault op(s) for ${caseId} (apply=${applyManifestId})`);
  }
  return applyError ? null : applyManifestId;
}

/**
 * Record an AI turn event in the timeline (for audit trail).
 */
export function recordAiTurn(
  opts: OutputWriterOptions,
  caseId: CaseId,
  summary: string,
  durationMs: number,
): void {
  const { db, schema } = opts;
  const now = new Date().toISOString();

  db.insert(schema.timelineEvents).values({
    id: genEventId(),
    caseId,
    type: 'ai_proposal_started',
    actor: 'ai',
    summary: `Agent Runtime turn: ${summary} (${durationMs}ms)`,
    dataJson: JSON.stringify({ source: 'agent-runtime', durationMs }),
    createdAt: now,
  }).run();
}
