import { z } from 'zod';

// ---- ID Helpers ----
const idDate = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

const randSuffix = (len = 4) =>
  Math.random().toString(36).substring(2, 2 + len);

export function genAnchorId(): `kw_${string}` {
  return `kw_${idDate()}_${randSuffix(6)}` as const;
}

export function genCaseId(): `case_${string}` {
  return `case_${idDate()}_${randSuffix(4)}` as const;
}

export function genArtifactId(): `art_${string}` {
  return `art_${idDate()}_${randSuffix(4)}` as const;
}

export function genEventId(): `evt_${string}` {
  return `evt_${idDate()}_${randSuffix(4)}` as const;
}

export function genProposalId(): `prop_${string}` {
  return `prop_${idDate()}_${randSuffix(4)}` as const;
}

export function genPatchIntentId(): `pi_${string}` {
  return `pi_${idDate()}_${randSuffix(4)}` as const;
}

export function genPatchManifestId(): `patch_${string}` {
  return `patch_${idDate()}_${randSuffix(4)}` as const;
}

export function genApplyManifestId(): `apply_${string}` {
  return `apply_${idDate()}_${randSuffix(4)}` as const;
}

export function genJobId(): `job_${string}` {
  return `job_${idDate()}_${randSuffix(4)}` as const;
}

// ---- Zod Schemas ----
export const SettingsUpdateSchema = z.object({
  vaultPath: z.string().min(1),
  inboxPath: z.string().min(1),
  workspacePath: z.string().min(1),
  aiProvider: z.string(),
  aiBaseUrl: z.string(),
  aiApiKey: z.string().optional(),
  aiDefaultModel: z.string(),
  aiMaxTokens: z.number().int().positive().optional(),
  autoAnalyze: z.boolean(),
  // Agent Runtime settings
  agentRuntimeEnabled: z.boolean().optional(),
  agentCliPath: z.string().optional(),
  autoDetectAgents: z.boolean().optional(),
  maxActiveSessions: z.number().int().positive().optional(),
  sessionTimeoutMinutes: z.number().int().positive().optional(),
  contextCompressThreshold: z.number().int().positive().optional(),
  contextKeepRecentCount: z.number().int().positive().optional(),
  maxTokensPerSession: z.number().int().positive().optional(),
  sandboxMode: z.enum(['workspace-only', 'vault-readonly', 'full']).optional(),
});

export const TestModelRequestSchema = z.object({
  aiProvider: z.string(),
  aiBaseUrl: z.string(),
  aiApiKey: z.string(),
  aiDefaultModel: z.string(),
});

export const InboxScanRequestSchema = z.object({
  mode: z.enum(['incremental', 'full']),
});

export const CommentRequestSchema = z.object({
  comment: z.string().min(1),
  updateInstructionSummary: z.boolean().optional(),
});

export const PatchIntentRequestSchema = z.object({
  action: z.enum(['move', 'update_frontmatter', 'append_summary', 'generate_formal_note', 'create_index_link']),
  instruction: z.string().optional(),
  targetPath: z.string().optional(),
});

export const ApproveApplyRequestSchema = z.object({
  approvalNote: z.string().optional(),
});

export const RollbackRequestSchema = z.object({
  applyManifestId: z.string(),
  reason: z.string().optional(),
});

export const ReopenRequestSchema = z.object({
  reason: z.string().optional(),
});

export const WorkspaceRuleCreateSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  enabled: z.boolean(),
  priority: z.number().int(),
});

export const WorkspaceRuleUpdateSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
});

export const InstructionSummaryUpdateSchema = z.object({
  summary: z.string().min(1),
});

// ---- Proposal AI Output Schema ----
export const ProposalOutputSchema = z.object({
  title: z.string().describe('A clear title for the content'),
  summary: z.string().describe('A short summary of what this content is about'),
  valueJudgement: z.enum(['high', 'medium', 'low', 'drop']).describe('How valuable is this content'),
  suggestedActions: z.array(z.enum([
    'mark_done', 'drop', 'move', 'append_summary',
    'update_frontmatter', 'generate_formal_note', 'merge_later', 'need_more_research',
  ])).describe('What actions the system suggests'),
  suggestedTargetPath: z.string().optional().describe('If moving, where should it go'),
  reasoningSummary: z.string().describe('Why you made this suggestion'),
  risks: z.array(z.string()).optional().describe('Potential risks or uncertainties'),
  requiresPatch: z.boolean().describe('True if any action needs Vault modification'),
});
