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
  // Agent Runtime settings. Default to enabled: the agent runtime is the
  // primary execution path (Phase 2+); the legacy job-queue is the fallback.
  // SetupWizard also sends agentRuntimeEnabled:true, but we keep the column
  // default aligned so any path that omits the field lands on "enabled".
  agentRuntimeEnabled: integer('agent_runtime_enabled', { mode: 'boolean' }).notNull().default(true),
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
  // AI-decided per-turn next-step menu; JSON of ProposedNextAction[] (see @pkws/shared).
  // Each entry: {id,label,description,intent,sideEffect,payload?}. Free-form intent/sideEffect.
  proposedNextActions: text('proposed_next_actions').notNull().default('[]'), // JSON array
  reasoningSummary: text('reasoning_summary').notNull(),
  risks: text('risks'), // JSON array
  rawJson: text('raw_json'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_proposals_case').on(table.caseId),
]);

// One row per AI turn on a case. See AiRun in @pkws/shared for the contract.
// rulesSnapshot / inputContext are stored as JSON strings so each turn's
// "raw materials" can be displayed transparently at the per-node level in
// the case detail UI.
export const aiRuns = sqliteTable('ai_runs', {
  id: text('id').primaryKey().notNull(),
  caseId: text('case_id').notNull().references(() => cases.id),
  kind: text('kind', { enum: ['proposal', 'turn'] }).notNull(),
  trigger: text('trigger', {
    enum: ['auto_analyze', 'user_explicit', 'user_invoke_next', 'user_regenerate'],
  }).notNull(),
  model: text('model').notNull(),
  status: text('status', {
    enum: ['running', 'succeeded', 'failed', 'aborted'],
  }).notNull().default('running'),
  error: text('error'),
  rulesSnapshotJson: text('rules_snapshot_json').notNull(),
  inputContextJson: text('input_context_json').notNull(),
  outputSummary: text('output_summary'),
  proposedNextActionsJson: text('proposed_next_actions_json'),
  proposalId: text('proposal_id').references(() => proposals.id),
  // Session/transcript telemetry — written by the CLI runner so each AI run
  // can be reopened in its native session file. Both Claude Code and Codex
  // support --session-id and write a jsonl transcript; the runtime learns
  // the path after the run finishes (or finds it by walking the projects/
  // sessions dirs first time the row is read).
  agentId: text('agent_id'), // 'claude' | 'codex' | null
  sessionId: text('session_id'),
  transcriptPath: text('transcript_path'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  durationMs: integer('duration_ms'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_ai_runs_case').on(table.caseId),
  index('idx_ai_runs_kind').on(table.kind),
  index('idx_ai_runs_status').on(table.status),
]);

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
    enum: ['scan_inbox', 'write_pkws_id', 'generate_proposal'],
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
  /** @deprecated 不再写入，仅用于旧数据兼容 */
  messagesJson: text('messages_json'),
  /** 最近 N 条消息（JSON 字符串），保留最近交互上下文 */
  recentMessagesJson: text('recent_messages_json'),
  /** AI 生成的语义摘要，替代旧的粗暴截取方式 */
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
