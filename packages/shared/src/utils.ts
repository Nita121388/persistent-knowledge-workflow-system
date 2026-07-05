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

export function genAiRunId(): `air_${string}` {
  return `air_${idDate()}_${randSuffix(4)}` as const;
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

/**
 * Body for POST /cases/:caseId/invoke-next — user picked one of the AI-proposed
 * next-step buttons. `actionId` matches `ProposedNextAction.id` on the case's
 * current proposal. Optional `feedback` lets the user add a free-text note
 * alongside the picked action (e.g. clarifying concerns before AI executes).
 */
export const InvokeNextRequestSchema = z.object({
  actionId: z.string().min(1),
  feedback: z.string().optional(),
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

// ---- Proposed Next Action (AI-decided per-turn menu item) ----
export const ProposedNextActionSchema = z.object({
  id: z.string().describe('Stable id for this action; the user flow returns this id to invoke the action.'),
  label: z.string().describe('Short button label, e.g. "Let me add tags directly" or "Mark as done".'),
  description: z.string().describe('One or two sentences: what will happen if the user picks this. For modify_vault, describe the planned change in plain language.'),
  intent: z.string().describe('Free-form category tag for UI grouping (e.g. "modify_vault", "quick_close", "ask_user", "clarify", "regenerate"). The UI renders unknown intents with a neutral style, so you may coin new intents when the existing ones do not fit.'),
  sideEffect: z.string().describe('What happens if the user picks this: one of "modify_vault" (you will edit Vault after the user agrees your plan), "quick_close" (case closes, no Vault change), "ask_user" (you ask the user a clarifying question), "clarify" (you restate or refine your proposal), "regenerate" (you re-analyze from scratch). Coin a new value only if none of these fit.'),
  payload: z.string().optional().describe('Opaque JSON string you can fill with anything you need carried back to you when the user picks this action. The system returns it to you verbatim on the next turn. Use it to stash planned edit details, target paths, or context.'),
});

// ---- Proposal AI Output Schema ----
// Used by BOTH the direct-LLM path (generateObject) and the Agent Runtime CLI
// path (proposal.json). Do not redefine this schema elsewhere.
export const ProposalOutputSchema = z.object({
  title: z.string().describe('A clear title for the content'),
  summary: z.string().describe('A short summary of what this content is about'),
  valueJudgement: z.enum(['high', 'medium', 'low', 'drop']).describe('How valuable is this content'),
  proposedNextActions: z.array(ProposedNextActionSchema).describe('The next-step menu you propose for this case. Decide the contents yourself per-turn — do NOT pick from a fixed enum. You may include quick_close actions that suggest closing the case (e.g. "not worth processing, mark done"). Aim for 1-4 actions the user can pick from, or an empty array if no actionable next step exists yet.'),
  reasoningSummary: z.string().describe('Why you made this suggestion'),
  risks: z.array(z.string()).optional().describe('Potential risks or uncertainties'),
});
