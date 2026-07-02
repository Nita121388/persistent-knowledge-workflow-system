import {
  sqliteTable, text, integer, index
} from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey().notNull(),
  vaultPath: text('vault_path').notNull(),
  inboxPath: text('inbox_path').notNull(),
  workspacePath: text('workspace_path').notNull(),
  aiProvider: text('ai_provider').notNull(),
  aiBaseUrl: text('ai_base_url').notNull(),
  aiApiKeyEncrypted: text('ai_api_key_encrypted'),
  aiDefaultModel: text('ai_default_model').notNull(),
  aiMaxTokens: integer('ai_max_tokens'),
  autoAnalyze: integer('auto_analyze', { mode: 'boolean' }).notNull().default(true),
  // Agent Runtime settings
  agentRuntimeEnabled: integer('agent_runtime_enabled', { mode: 'boolean' }).notNull().default(false),
  agentCliPath: text('agent_cli_path').notNull().default(''),
  autoDetectAgents: integer('auto_detect_agents', { mode: 'boolean' }).notNull().default(true),
  maxActiveSessions: integer('max_active_sessions').notNull().default(10),
  sessionTimeoutMinutes: integer('session_timeout_minutes').notNull().default(360),
  contextCompressThreshold: integer('context_compress_threshold').notNull().default(20),
  contextKeepRecentCount: integer('context_keep_recent_count').notNull().default(12),
  maxTokensPerSession: integer('max_tokens_per_session').notNull().default(32000),
  sandboxMode: text('sandbox_mode', { enum: ['workspace-only', 'vault-readonly', 'full'] }).notNull().default('workspace-only'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const knowledgeAnchors = sqliteTable('knowledge_anchors', {
  id: text('id').primaryKey().notNull(),
  currentVaultPath: text('current_vault_path').notNull(),
  originalVaultPath: text('original_vault_path').notNull(),
  title: text('title'),
  sourceUrl: text('source_url'),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  status: text('status', { enum: ['active', 'missing', 'archived'] }).notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey().notNull(),
  anchorId: text('anchor_id').notNull().references(() => knowledgeAnchors.id),
  type: text('type', { enum: ['vault_markdown', 'web_clip'] }).notNull(),
  vaultPath: text('vault_path').notNull(),
  title: text('title'),
  sourceUrl: text('source_url'),
  contentHash: text('content_hash').notNull(),
  frontmatterJson: text('frontmatter_json'),
  capturedAt: text('captured_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const cases = sqliteTable('cases', {
  id: text('id').primaryKey().notNull(),
  anchorId: text('anchor_id').notNull().references(() => knowledgeAnchors.id),
  primaryArtifactId: text('primary_artifact_id').notNull().references(() => artifacts.id),
  title: text('title').notNull(),
  status: text('status', {
    enum: [
      'Captured', 'Analyzing', 'ReviewRequired', 'NeedDiscussion',
      'PatchPreview', 'Approved', 'Applying', 'Done', 'Dropped',
      'Rejected', 'Error', 'RolledBack',
    ],
  }).notNull(),
  source: text('source', { enum: ['clipper', 'manual', 'obsidian_shortcut', 'system'] }).notNull(),
  currentProposalId: text('current_proposal_id'),
  currentPatchId: text('current_patch_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  closedAt: text('closed_at'),
}, (table) => [
  index('idx_cases_status').on(table.status),
  index('idx_cases_anchor').on(table.anchorId),
]);

export const timelineEvents = sqliteTable('timeline_events', {
  id: text('id').primaryKey().notNull(),
  caseId: text('case_id').notNull().references(() => cases.id),
  type: text('type').notNull(),
  actor: text('actor', { enum: ['user', 'ai', 'system'] }).notNull(),
  summary: text('summary').notNull(),
  dataJson: text('data_json'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_events_case').on(table.caseId),
  index('idx_events_created').on(table.createdAt),
]);

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey().notNull(),
  caseId: text('case_id').notNull().references(() => cases.id),
  model: text('model').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  valueJudgement: text('value_judgement', { enum: ['high', 'medium', 'low', 'drop'] }).notNull(),
  suggestedActions: text('suggested_actions').notNull(), // JSON array
  suggestedTargetPath: text('suggested_target_path'),
  reasoningSummary: text('reasoning_summary').notNull(),
  risks: text('risks'), // JSON array
  requiresPatch: integer('requires_patch', { mode: 'boolean' }).notNull(),
  rawJson: text('raw_json'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_proposals_case').on(table.caseId),
]);

export const patchIntents = sqliteTable('patch_intents', {
  id: text('id').primaryKey().notNull(),
  caseId: text('case_id').notNull().references(() => cases.id),
  proposalId: text('proposal_id'),
  action: text('action', {
    enum: ['move', 'update_frontmatter', 'append_summary', 'generate_formal_note', 'create_index_link'],
  }).notNull(),
  instruction: text('instruction'),
  targetPath: text('target_path'),
  status: text('status', { enum: ['pending', 'generating', 'generated', 'cancelled', 'error'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_pi_case').on(table.caseId),
]);

export const patchManifests = sqliteTable('patch_manifests', {
  id: text('id').primaryKey().notNull(),
  caseId: text('case_id').notNull().references(() => cases.id),
  patchIntentId: text('patch_intent_id').notNull().references(() => patchIntents.id),
  status: text('status', {
    enum: ['draft', 'preview', 'approved', 'applied', 'rejected', 'error'],
  }).notNull().default('draft'),
  operationsJson: text('operations_json').notNull(),
  baseFileHashesJson: text('base_file_hashes_json').notNull(),
  previewJson: text('preview_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_pm_case').on(table.caseId),
]);

export const applyManifests = sqliteTable('apply_manifests', {
  id: text('id').primaryKey().notNull(),
  caseId: text('case_id').notNull().references(() => cases.id),
  patchManifestId: text('patch_manifest_id').notNull().references(() => patchManifests.id),
  status: text('status', { enum: ['applied', 'rolled_back', 'rollback_blocked'] }).notNull(),
  appliedOperationsJson: text('applied_operations_json').notNull(),
  backupRefsJson: text('backup_refs_json').notNull(),
  appliedAt: text('applied_at').notNull(),
  rolledBackAt: text('rolled_back_at'),
});

export const caseInstructionSummaries = sqliteTable('case_instruction_summaries', {
  id: text('id').primaryKey().notNull(),
  caseId: text('case_id').notNull().unique().references(() => cases.id),
  summary: text('summary').notNull(),
  invalidatedItemsJson: text('invalidated_items_json'),
  updatedBy: text('updated_by', { enum: ['user', 'system'] }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const workspaceRules = sqliteTable('workspace_rules', {
  id: text('id').primaryKey().notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(100),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey().notNull(),
  type: text('type', {
    enum: ['scan_inbox', 'write_pkws_id', 'generate_proposal', 'generate_patch', 'apply_patch', 'rollback_apply'],
  }).notNull(),
  status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] }).notNull().default('queued'),
  payloadJson: text('payload_json').notNull(),
  resultJson: text('result_json'),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').notNull().default(0),
  idempotencyKey: text('idempotency_key'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
}, (table) => [
  index('idx_jobs_status').on(table.status),
  index('idx_jobs_type').on(table.type),
]);

export const agentSessions = sqliteTable('agent_sessions', {
  caseId: text('case_id').primaryKey().notNull().references(() => cases.id),
  messagesJson: text('messages_json').notNull(),
  compressedSummary: text('compressed_summary'),
  turnCount: integer('turn_count').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  compressionEpoch: integer('compression_epoch').notNull().default(0),
  awaitingUserInput: integer('awaiting_user_input', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_agent_sessions_updated').on(table.updatedAt),
]);

export const logEntries = sqliteTable('log_entries', {
  id: text('id').primaryKey().notNull(),
  timestamp: text('timestamp').notNull(),
  level: text('level', { enum: ['debug', 'info', 'warn', 'error'] }).notNull(),
  category: text('category', { enum: ['system', 'api', 'agent', 'worker', 'ai', 'db', 'ws', 'user'] }).notNull(),
  message: text('message').notNull(),
  dataJson: text('data_json'),
  caseId: text('case_id'),
  jobId: text('job_id'),
}, (table) => [
  index('idx_log_timestamp').on(table.timestamp),
  index('idx_log_level').on(table.level),
  index('idx_log_category').on(table.category),
  index('idx_log_case').on(table.caseId),
]);
