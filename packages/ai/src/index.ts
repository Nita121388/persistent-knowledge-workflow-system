import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { ProposalOutputSchema, type Proposal, type Settings } from '@pkws/shared';
import { genProposalId } from '@pkws/shared/utils.js';

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  maxTokens?: number;
}

interface ProposalInput {
  title: string;
  contentBody: string;
  sourceUrl?: string;
  frontmatterContext?: string;
  frontmatterTags?: string;
  instructionSummary?: string;
  workspaceRules?: string;
  conversationHistory?: string;
}

const SYSTEM_PROMPT = `You are a knowledge curation assistant. Your job is to analyze a web clip or note and provide a structured proposal for how to handle it.

IMPORTANT: You are NOT writing the final formatted note. You are only making suggestions. The user will decide what to do with them.

For each piece of content, analyze:
1. What is this content about? (summary)
2. How valuable is it? (high/medium/low/drop)
3. What should the user do with it?
4. Where should it go in their knowledge vault?
5. Why do you recommend this?

Workspace Rules are the user's long-term preferences. Follow them unless the Case Instructions say otherwise.
Case Instructions are specific to this single case and override Workspace Rules if they conflict.

PROPOSED NEXT ACTIONS:
You decide yourself what next-step options to offer the user; do NOT pick from a fixed menu. Provide 1-4 options in proposedNextActions.
Each option has:
- label: short button text (e.g. "Let me add tags directly", "Not worth it, mark done", "Ask me which daily-note template to use").
- description: 1-2 sentences on what happens if the user picks it. For modify_vault, describe the planned change in plain language (you will draft the actual change next turn after the user agrees).
- intent: free-form category tag the UI uses for grouping (e.g. "modify_vault", "quick_close", "ask_user", "clarify", "regenerate"). Coin a new intent when the existing ones don't fit.
- sideEffect: what happens if picked — "modify_vault" (you'll edit Vault after user agrees your plan), "quick_close" (case closes, no Vault change), "ask_user" (you ask a clarifying question), "clarify" (you restate/refine), "regenerate" (you re-analyze from scratch).
- payload (optional): an opaque JSON string you can stash anything in; the system returns it verbatim on the next turn. Use it to remember planned edits, target paths, etc.
You MAY include quick_close actions suggesting the case be closed (e.g. drop, not worth processing). The user still decides whether to click — you are only proposing options.`;

function buildUserPrompt(input: ProposalInput): string {
  const parts: string[] = [];

  parts.push(`## Content Title\n${input.title}`);
  parts.push(`\n## Content Body\n${input.contentBody.slice(0, 8000)}`);

  if (input.sourceUrl) {
    parts.push(`\n## Source URL\n${input.sourceUrl}`);
  }
  if (input.frontmatterContext) {
    parts.push(`\n## Note Metadata (frontmatter)\n${input.frontmatterContext}

The data above is the note's complete metadata. It may contain custom fields like "想法|描述", "description", "意图", or other user-written notes about what to do with this content. The user's Workspace Rules may reference specific fields — follow those instructions.`);
  }
  if (input.instructionSummary) {
    parts.push(`\n## User Feedback from Previous Analysis\n${input.instructionSummary}

NOTE: The above is **your previous analysis** plus feedback the user provided after reading it. This represents corrections, refinements, or instructions that override your earlier suggestions. Pay special attention to specific requests — the user is telling you what they want changed.`);
  }
  if (input.workspaceRules) {
    parts.push(`\n## Workspace Rules (user's long-term preferences)\n${input.workspaceRules}`);
  }
  if (input.conversationHistory) {
    parts.push(`\n## Conversation History (previous analysis and feedback)\n${input.conversationHistory}`);
  }

  parts.push(`\n## Output
Generate a structured proposal for how to handle this content. Be specific about what action(s) to take and why.`);

  return parts.join('\n');
}

export async function testModel(config: AiConfig): Promise<{ model: string; latencyMs: number }> {
  const provider = createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });

  const model = provider.languageModel(config.defaultModel);
  const start = Date.now();

  // Use generateText with a JSON prompt instead of generateObject,
  // because some OpenAI-compatible APIs don't support structured output / json_schema mode.
  const { generateText } = await import('ai');
  const result = await generateText({
    model,
    prompt: 'Respond with JSON: { "ok": true }. Output ONLY the JSON.',
    maxTokens: 100,
  });

  // Try to parse the result to verify it's valid JSON
  try {
    JSON.parse(result.text);
  } catch {
    throw new Error(`Model returned invalid JSON response: ${result.text.slice(0, 100)}`);
  }

  return {
    model: config.defaultModel,
    latencyMs: Date.now() - start,
  };
}

let _aiConfig: AiConfig | null = null;

export function setAiConfig(config: AiConfig) {
  _aiConfig = config;
}

export function getAiConfig(): AiConfig {
  if (!_aiConfig) throw new Error('AI not configured');
  return _aiConfig;
}

export async function generateProposal(
  input: ProposalInput,
  caseId: string,
): Promise<Proposal> {
  const config = getAiConfig();
  const provider = createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });

  const model = provider.languageModel(config.defaultModel);

  const result = await generateObject({
    model,
    schema: ProposalOutputSchema,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(input),
    maxTokens: config.maxTokens ?? 4096,
  });

  const output = result.object;

  return {
    id: genProposalId(),
    caseId,
    model: config.defaultModel,
    title: output.title,
    summary: output.summary,
    valueJudgement: output.valueJudgement,
    proposedNextActions: output.proposedNextActions,
    reasoningSummary: output.reasoningSummary,
    risks: output.risks,
    rawJson: JSON.stringify(output),
    createdAt: new Date().toISOString(),
  };
}

export async function generatePatchContent(
  action: string,
  instruction: string | undefined,
  targetPath: string | undefined,
  originalTitle: string,
  originalContent: string,
  instructionSummary: string | undefined,
  workspaceRules: string | undefined,
  caseId: string,
): Promise<string> {
  const config = getAiConfig();
  const provider = createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });

  const model = provider.languageModel(config.defaultModel);

  const actionDescriptions: Record<string, string> = {
    move: 'Move the file to a new directory without changing content',
    update_frontmatter: 'Update the frontmatter metadata of the file',
    append_summary: 'Append a summary section to the note',
    generate_formal_note: 'Generate a well-formatted formal note based on the original clip',
    create_index_link: 'Create an index note with links to this content',
  };

  const systemMsg = `You generate structured file operations for a knowledge vault patch.
Output a JSON array of operations. Each operation has a "type" field: "create_file", "update_file", or "move_file".
- create_file: requires "path" and "content" fields
- update_file: requires "path" and "newContent" fields
- move_file: requires "fromPath" and "toPath" fields`;

  const userMsg = `
Action: ${action} — ${actionDescriptions[action] || action}
Instruction: ${instruction || 'No specific instruction'}
Target Path: ${targetPath || 'Not specified'}
Original Title: ${originalTitle}
Original Content (first 8000 chars):
${originalContent.slice(0, 8000)}

${instructionSummary ? `Case Instructions: ${instructionSummary}` : ''}
${workspaceRules ? `Workspace Rules: ${workspaceRules}` : ''}

Generate a JSON array of patch operations.`;

  const result = await generateObject({
    model,
    schema: (z: any) => z.object({
      operations: z.array(z.object({
        type: z.enum(['create_file', 'update_file', 'move_file']),
        path: z.string().optional(),
        fromPath: z.string().optional(),
        toPath: z.string().optional(),
        newContent: z.string().optional(),
        content: z.string().optional(),
      })),
    }),
    system: systemMsg,
    prompt: userMsg,
    maxTokens: config.maxTokens ?? 4096,
  });

  return JSON.stringify(result.object.operations);
}
