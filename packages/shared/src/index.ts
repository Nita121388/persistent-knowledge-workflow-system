// ID types
export type AnchorId = `kw_${string}`;
export type CaseId = `case_${string}`;
export type ArtifactId = `art_${string}`;
export type EventId = `evt_${string}`;
export type ProposalId = `prop_${string}`;
export type PatchIntentId = `pi_${string}`;
export type PatchManifestId = `patch_${string}`;
export type ApplyManifestId = `apply_${string}`;
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
  currentPatchId?: PatchManifestId;
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
  currentProposal?: Proposal;
  currentPatch?: PatchManifest;
  instructionSummary?: CaseInstructionSummary;
  timeline: TimelineEvent[];
  patchIntents: PatchIntent[];
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
export type ProposalAction =
  | 'mark_done'
  | 'drop'
  | 'move'
  | 'append_summary'
  | 'update_frontmatter'
  | 'generate_formal_note'
  | 'merge_later'
  | 'need_more_research';

export interface Proposal {
  id: ProposalId;
  caseId: CaseId;
  model: string;
  title: string;
  summary: string;
  valueJudgement: ValueJudgement;
  suggestedActions: ProposalAction[];
  suggestedTargetPath?: string;
  reasoningSummary: string;
  risks?: string[];
  requiresPatch: boolean;
  rawJson?: string;
  createdAt: string;
}

// ---- Patch Intent ----
export type PatchIntentAction =
  | 'move'
  | 'update_frontmatter'
  | 'append_summary'
  | 'generate_formal_note'
  | 'create_index_link';

export interface PatchIntent {
  id: PatchIntentId;
  caseId: CaseId;
  proposalId?: ProposalId;
  action: PatchIntentAction;
  instruction?: string;
  targetPath?: string;
  status: 'pending' | 'generating' | 'generated' | 'cancelled' | 'error';
  createdAt: string;
  updatedAt: string;
}

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
export interface PatchManifest {
  id: PatchManifestId;
  caseId: CaseId;
  patchIntentId: PatchIntentId;
  status: 'draft' | 'preview' | 'approved' | 'applied' | 'rejected' | 'error';
  operationsJson: string;
  baseFileHashesJson: string;
  previewJson?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PatchPreview {
  id: PatchManifestId;
  status: PatchManifest['status'];
  operations: PatchOperation[];
  affectedFiles: string[];
}

// ---- Apply Manifest ----
export interface ApplyManifest {
  id: ApplyManifestId;
  caseId: CaseId;
  patchManifestId: PatchManifestId;
  status: 'applied' | 'rolled_back' | 'rollback_blocked';
  appliedOperationsJson: string;
  backupRefsJson: string;
  appliedAt: string;
  rolledBackAt?: string;
}

// ---- Case Instruction Summary ----
export interface CaseInstructionSummary {
  id: string;
  caseId: CaseId;
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
export type JobType =
  | 'scan_inbox'
  | 'write_pkws_id'
  | 'generate_proposal'
  | 'generate_patch'
  | 'apply_patch'
  | 'rollback_apply';

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

// ---- Patch Intent Request ----
export interface PatchIntentRequest {
  action: PatchIntentAction;
  instruction?: string;
  targetPath?: string;
}

// ---- Approval ----
export interface ApproveApplyRequest {
  approvalNote?: string;
}

// ---- Rollback ----
export interface RollbackRequest {
  applyManifestId: ApplyManifestId;
  reason?: string;
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
