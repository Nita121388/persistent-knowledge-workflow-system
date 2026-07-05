import { z } from 'zod';
import { ProposalOutputSchema } from '@pkws/shared/utils.js';

/**
 * Zod schemas for parsing structured output from CLI agents.
 *
 * CLI agents (Codex / Claude Code) write their output as JSON files
 * in the workDir/output/ directory. The scheduler parses these and
 * integrates them into the PKWS data model.
 *
 * Note: CLI agent proposal output must conform to the same
 * ProposalOutputSchema as the direct-LLM path so both AI paths stay
 * in lockstep. Re-export it here as CliProposalSchema for naming
 * continuity with downstream callers; CLI path is forbidden from
 * redefining this schema independently.
 */

// ---- Proposal JSON ----
// Written by CLI agent to output/proposal.json
// Schema is shared with the direct-LLM path via @pkws/shared.
export const CliProposalSchema = ProposalOutputSchema;

export type CliProposal = z.infer<typeof CliProposalSchema>;

// ---- Patch Operations JSON ----
// Written by CLI agent to output/patch-operations.json

export const CliPatchOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_file'),
    path: z.string(),
    content: z.string(),
  }),
  z.object({
    type: z.literal('update_file'),
    path: z.string(),
    newContent: z.string(),
  }),
  z.object({
    type: z.literal('move_file'),
    fromPath: z.string(),
    toPath: z.string(),
  }),
]);

export const CliPatchSchema = z.object({
  operations: z.array(CliPatchOperationSchema),
});

export type CliPatchOperation = z.infer<typeof CliPatchOperationSchema>;
export type CliPatch = z.infer<typeof CliPatchSchema>;

// ---- Context Summary JSON ----
// Written by CLI agent to output/context-summary.json
// Used to store AI-generated semantic summary instead of raw message truncation

export const ContextSummarySchema = z.object({
  summary: z.string().describe('语义摘要：之前的对话中最重要的结论、决策和上下文'),
  keyPoints: z.array(z.string()).optional().describe('关键要点列表'),
  openQuestions: z.array(z.string()).optional().describe('仍然未解决的问题'),
});

export type CliContextSummary = z.infer<typeof ContextSummarySchema>;

// ---- Output Parser ----

export interface ParsedCliOutput {
  proposal: CliProposal | null;
  patch: CliPatch | null;
  contextSummary: CliContextSummary | null;
  rawText: string;
  errors: string[];
}

/**
 * Parse CLI agent output files from the output directory.
 * Looks for proposal.json and/or patch-operations.json.
 */
export function parseCliOutput(
  outputFiles: Array<{ path: string; content: string }>,
  stdout: string,
): ParsedCliOutput {
  const errors: string[] = [];
  let proposal: CliProposal | null = null;
  let patch: CliPatch | null = null;
  let contextSummary: CliContextSummary | null = null;

  for (const file of outputFiles) {
    const filename = file.path.split(/[/\\]/).pop() || '';

    if (filename === 'proposal.json') {
      try {
        const json = JSON.parse(file.content);
        proposal = CliProposalSchema.parse(json);
      } catch (e: any) {
        errors.push(`proposal.json parse error: ${e.message}`);
      }
    }

    if (filename === 'patch-operations.json') {
      try {
        const json = JSON.parse(file.content);
        patch = CliPatchSchema.parse(json);
      } catch (e: any) {
        errors.push(`patch-operations.json parse error: ${e.message}`);
      }
    }

    if (filename === 'context-summary.json') {
      try {
        const json = JSON.parse(file.content);
        contextSummary = ContextSummarySchema.parse(json);
      } catch (e: any) {
        errors.push(`context-summary.json parse error: ${e.message}`);
      }
    }
  }

  // Also try to extract proposal from stdout if no file was found
  if (!proposal && stdout) {
    const jsonMatch = stdout.match(/\{[\s\S]*"title"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const json = JSON.parse(jsonMatch[0]);
        proposal = CliProposalSchema.parse(json);
      } catch {
        // Ignore — stdout is text, not structured JSON
      }
    }
  }

  return { proposal, patch, contextSummary, rawText: stdout, errors };
}
