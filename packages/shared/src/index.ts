// Re-export everything from utils so packages can import from @pkws/shared
export * from './utils.js';

// ID types
export type AnchorId = `kw_${string}`;
export type CaseId = `case_${string}`;
export type ArtifactId = `art_${string}`;
export type EventId = `evt_${string}`;
export type ProposalId = `prop_${string}`;
export type AiRunId = `air_${string}`;
export type JobId = `job_${string}`;

// ---- Settings ----
export interface Settings {
  vaultPath: string;
  inboxPath: string;
  workspacePath: string;
  aiProvider: 'openai-compatible';
  aiBaseUrl: string;
  aiApiKeyConfigured: boolean;
  aiDefaultModel: string;
  aiMaxTokens?: number;
  autoAnalyze: boolean;
  // Agent Runtime settings
  agentRuntimeEnabled: boolean;
  agentCliPath: string;
  autoDetectAgents: boolean;
  maxActiveSessions: number;
  sessionTimeoutMinutes: number;
  contextCompressThreshold: number;
  contextKeepRecentCount: number;
  maxTokensPerSession: number;
  sandboxMode: 'workspace-only' | 'vault-readonly' | 'full';
  createdAt: string;
  updatedAt: string;
}

export interface SettingsUpdate {
  vaultPath: string;
  inboxPath: string;
  workspacePath: string;
  aiProvider: string;
  aiBaseUrl: string;
  aiApiKey?: string;
  aiDefaultModel: string;
  aiMaxTokens?: number;
  autoAnalyze: boolean;
  // Agent Runtime settings
  agentRuntimeEnabled?: boolean;
  agentCliPath?: string;
  autoDetectAgents?: boolean;
  maxActiveSessions?: number;
  sessionTimeoutMinutes?: number;
  contextCompressThreshold?: number;
  contextKeepRecentCount?: number;
  maxTokensPerSession?: number;
  sandboxMode?: 'workspace-only' | 'vault-readonly' | 'full';
}

export interface TestModelRequest {
  aiProvider: string;
  aiBaseUrl: string;
  aiApiKey: string;
  aiDefaultModel: string;
}

export interface TestModelResult {
  model: string;
  latencyMs: number;
}

// ---- Knowledge Anchor ----
export interface KnowledgeAnchor {
  id: AnchorId;
  currentVaultPath: string;
  originalVaultPath: string;
  title?: string;
  sourceUrl?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'active' | 'missing' | 'archived';
  createdAt: string;
  updatedAt: string;
}

// ---- Artifact ----
export interface Artifact {
  id: ArtifactId;
  anchorId: AnchorId;
  type: 'vault_markdown' | 'web_clip';
  vaultPath: string;
  title?: string;
  sourceUrl?: string;
  contentHash: string;
  frontmatterJson?: string;
  capturedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Case ----
export type CaseStatus =
  | 'Captured'
  | 'Analyzing'
  | 'ReviewRequired'
  | 'NeedDiscussion'
  | 'PatchPreview'
  | 'Approved'
  | 'Applying'
  | 'Done'
  | 'Dropped'
  | 'Rejected'
  | 'Error'
  | 'RolledBack';

export const CASE_STATUS_QUEUE: Record<string, CaseStatus[]> = {
  inbox: ['Captured', 'Analyzing'],
  review: ['ReviewRequired', 'NeedDiscussion', 'PatchPreview'],
  active: ['Approved', 'Applying'],
  closed: ['Done', 'Dropped', 'Rejected', 'Error', 'RolledBack'],
};

export interface CaseRecord {
  id: CaseId;
  anchorId: AnchorId;
  primaryArtifactId: ArtifactId;
  title: string;
  status: CaseStatus;
  source: 'clipper' | 'manual' | 'obsidian_shortcut' | 'system';
  currentProposalId?: ProposalId;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface CaseListItem {
  id: CaseId;
  title: string;
  status: CaseStatus;
  anchorId: AnchorId;
  sourceUrl?: string;
  currentVaultPath: string;
  updatedAt: string;
}

export interface CaseDetail {
  case: CaseRecord;
  anchor: KnowledgeAnchor;
  artifact: Artifact;
  vaultPath?: string;  // PKWS settings vault path for Obsidian jump
  currentProposal?: Proposal;
  instructionSummary?: CaseInstructionSummary;
  timeline: TimelineEvent[];
  /**
   * Per-node AI run records for this case (line 2 / task #13). Newest first.
   * Each row represents one AI invocation — kind='proposal' for an analyze
   * pass that produces a Proposal, kind='turn' for an invoke-next round
   * executed via the agent runtime. The frontend renders one AiRunCard per
   * entry, surfacing rulesSnapshot/inputContext for transparency.
   */
  aiRuns: AiRun[];
}

// ---- Timeline ----
export type TimelineEventType =
  | 'case_created'
  | 'anchor_created'
  | 'artifact_detected'
  | 'pkws_id_written'
  | 'ai_proposal_started'
  | 'ai_proposal_generated'
  | 'user_commented'
  | 'user_marked_done'
  | 'user_dropped'
  | 'patch_intent_created'
  | 'patch_generated'
  | 'patch_approved'
  | 'patch_rejected'
  | 'apply_started'
  | 'apply_completed'
  | 'rollback_requested'
  | 'rollback_completed'
  | 'vault_modified'
  | 'error_occurred';

export interface TimelineEvent {
  id: EventId;
  caseId: CaseId;
  type: TimelineEventType;
  actor: 'user' | 'ai' | 'system';
  summary: string;
  dataJson?: string;
  createdAt: string;
}

// ---- Proposal ----
export type ValueJudgement = 'high' | 'medium' | 'low' | 'drop';

/**
 * One item of the AI-decided per-turn next-step menu. `intent` and
 * `sideEffect` are free-form strings the AI fills itself; the UI groups
 * buttons by them and renders unknown values with a neutral style.
 */
export interface ProposedNextAction {
  id: string;
  label: string;
  description: string;
  intent: string;
  sideEffect: string;
  /** Opaque JSON string the AI may stash anything in; returned verbatim on the next turn. */
  payload?: string;
}

export interface Proposal {
  id: ProposalId;
  caseId: CaseId;
  model: string;
  title: string;
  summary: string;
  valueJudgement: ValueJudgement;
  proposedNextActions: ProposedNextAction[];
  reasoningSummary: string;
  risks?: string[];
  rawJson?: string;
  createdAt: string;
}

// ---- AI Run ----
// One row per AI turn on a case. Replaces the case-level single summary:
// each AI processing node stores its own "raw inputs" snapshot so the user
// can transparently see what was fed to the AI on that turn plus the result.
//
// Two write paths produce ai_runs rows:
//   (a) generate_proposal path (kind='proposal') — the initial AI pass that
//       returns a Proposal. Linked to the produced proposal row by proposalId.
//   (b) invoke-next path (kind='turn') — a subsequent agent-runtime turn run
//       in response to a user-picked ProposedNextAction. proposalId is null.
//
// Each row persists enough context to fully reconstruct what happened on that
// turn without re-derivation: a snapshot of the workspace Rules at that time
// (rulesSnapshotJson), the actual input context fed to the AI (inputContextJson),
// the AI's numpyText output (outputSummary), the AI-decided next-step menu
// (proposedNextActionsJson), and lifecycle bookkeeping (status / error /
// timestamps / duration).
export type AiRunKind = 'proposal' | 'turn';

export type AiRunTrigger =
  | 'auto_analyze'        // auto-analyze fired on capture
  | 'user_explicit'       // user clicked Analyze on a Captured case
  | 'user_invoke_next'    // user picked a ProposedNextAction (kind='turn')
  | 'user_regenerate';    // user rejected the proposal and asked for a new one

export type AiRunStatus = 'running' | 'succeeded' | 'failed' | 'aborted';

export interface AiRun {
  id: AiRunId;
  caseId: CaseId;
  kind: AiRunKind;
  trigger: AiRunTrigger;
  model: string;
  status: AiRunStatus;
  error?: string;
  /** Snapshot of the workspace Rules (concatenated / JSON) fed to the AI this turn. */
  rulesSnapshotJson: string;
  /** The actual input context (note material / prior summary / user comments) fed this turn (JSON or raw text). */
  inputContextJson: string;
  /** Short summary of the AI output (proposal.summary for kind='proposal'; turn summary text otherwise). */
  outputSummary?: string;
  /** JSON of ProposedNextAction[] that the AI surfaced as the next-step menu. */
  proposedNextActionsJson?: string;
  /** Set on kind='proposal' success to link the produced row in `proposals`. */
  proposalId?: ProposalId;
  /** Which CLI produced this run: 'claude' | 'codex' | undefined (Job Queue path that doesn't shell out). */
  agentId?: 'claude' | 'codex';
  /** UUID the CLI was asked to use as --session-id; matches the first record of the transcript jsonl. */
  sessionId?: string;
  /** Absolute path on this machine of the transcript jsonl written by the CLI. Filled by cli-runner after the run. */
  transcriptPath?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  createdAt: string;
}

// ---- Patch Intent (action enum only; record types removed in favor of
//      AI-decided ProposedNextAction[]). The 5 legacy action names are kept
//      because agent-runtime/output-writer.ts still casts AI output ops to
//      one of them when bridging to the old patch-manifest pipeline (which
//      line 5 will retire when it switches agent-runtime to true vault writes).
export type PatchIntentAction =
  | 'move'
  | 'update_frontmatter'
  | 'append_summary'
  | 'generate_formal_note'
  | 'create_index_link';

// ---- Patch Operations ----
export interface CreateFileOperation {
  type: 'create_file';
  path: string;
  content: string;
  ifExists: 'fail';
}

export interface UpdateFileOperation {
  type: 'update_file';
  path: string;
  beforeHash: string;
  newContent: string;
}

export interface MoveFileOperation {
  type: 'move_file';
  fromPath: string;
  toPath: string;
  beforeHash: string;
  ifTargetExists: 'fail';
}

export type PatchOperation = CreateFileOperation | UpdateFileOperation | MoveFileOperation;

// ---- Patch Manifest ----
// NOTE: PatchManifest / PatchOperation / ApplyManifest and their id helpers
// (genPatchManifestId / genApplyManifestId) are kept because packages/vault
// still consumes them via executePatch / rollbackApply. Line 5 (task #16) will
// retire that path (agent-runtime writes the true vault directly), after which
// this whole block can be deleted along with PatchIntentAction above.
export interface PatchManifest {
  id: `patch_${string}`;
  caseId: CaseId;
  patchIntentId: `pi_${string}`;
  status: 'draft' | 'preview' | 'approved' | 'applied' | 'rejected' | 'error';
  operationsJson: string;
  baseFileHashesJson: string;
  previewJson?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplyManifest {
  id: `apply_${string}`;
  caseId: CaseId;
  patchManifestId: `patch_${string}`;
  status: 'applied' | 'rolled_back' | 'rollback_blocked';
  appliedOperationsJson: string;
  backupRefsJson: string;
  appliedAt: string;
  rolledBackAt?: string;
}

// ---- Case Instruction Summary ----
export interface CaseInstructionSummary {
  id: string;  caseId: CaseId;
  summary: string;
  invalidatedItemsJson?: string;
  updatedBy: 'user' | 'system';
  createdAt: string;
  updatedAt: string;
}

// ---- Workspace Rule ----
export interface WorkspaceRule {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Job ----
// generate_patch / apply_patch / rollback_apply were the patch-orchestration
// jobs from line 1; their handlers were removed in task #7 and no caller
// enqueues them anymore. The remaining 3 jobs cover: scanning the inbox,
// writing pkws IDs to artifacts, and generating the AI proposal.
export type JobType =
  | 'scan_inbox'
  | 'write_pkws_id'
  | 'generate_proposal';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Job {
  id: JobId;
  type: JobType;
  status: JobStatus;
  payloadJson: string;
  resultJson?: string;
  errorMessage?: string;
  retryCount: number;
  idempotencyKey?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

// ---- API Response Wrappers ----
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ---- Inbox Scan ----
export interface InboxScanRequest {
  mode: 'incremental' | 'full';
}

// ---- Comment ----
export interface CommentRequest {
  comment: string;
  updateInstructionSummary?: boolean;
}

// ---- Invoke Next Action (AI-decided menu pick) ----
export interface InvokeNextRequest {
  actionId: string;
  feedback?: string;
}

// ---- Reopen ----
export interface ReopenRequest {
  reason?: string;
}

// ---- Workspace Rule CRUD ----
export interface WorkspaceRuleCreate {
  title: string;
  content: string;
  enabled: boolean;
  priority: number;
}

export interface WorkspaceRuleUpdate {
  title?: string;
  content?: string;
  enabled?: boolean;
  priority?: number;
}

// ---- Memory ----
export interface InstructionSummaryUpdate {
  summary: string;
}
