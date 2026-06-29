import { createOpenAICompatible } from '@ai-sdk/openai';
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
  frontmatterTags?: string;
  instructionSummary?: string;
  workspaceRules?: string;
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
Case Instructions are specific to this single case and override Workspace Rules if they conflict.`;

function buildUserPrompt(input: ProposalInput): string {
  const parts: string[] = [];

  parts.push(`## Content Title\n${input.title}`);
  parts.push(`\n## Content Body\n${input.contentBody.slice(0, 8000)}`);

  if (input.sourceUrl) {
    parts.push(`\n## Source URL\n${input.sourceUrl}`);
  }
  if (input.frontmatterTags) {
    parts.push(`\n## Existing Tags\n${input.frontmatterTags}`);
  }
  if (input.instructionSummary) {
    parts.push(`\n## Case Instructions (override workspace rules)\n${input.instructionSummary}`);
  }
  if (input.workspaceRules) {
    parts.push(`\n## Workspace Rules (user's long-term preferences)\n${input.workspaceRules}`);
  }

  parts.push(`\n## Output
Generate a structured proposal for how to handle this content. Be specific about what action(s) to take and why.`);

  return parts.join('\n');
}

export async function testModel(config: AiConfig): Promise<{ model: string; latencyMs: number }> {
  const provider = createOpenAICompatible({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    name: 'test-provider',
  });

  const model = provider.languageModel(config.defaultModel);
  const start = Date.now();

  await generateObject({
    model,
    schema: z => z.object({ ok: z.boolean() }),
    prompt: 'Respond with { "ok": true }',
    maxTokens: 50,
  });

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
  const provider = createOpenAICompatible({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    name: 'pkws-provider',
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
    suggestedActions: output.suggestedActions,
    suggestedTargetPath: output.suggestedTargetPath,
    reasoningSummary: output.reasoningSummary,
    risks: output.risks,
    requiresPatch: output.requiresPatch,
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
): Promise<{ operations: string }> {
  const config = getAiConfig();
  const provider = createOpenAICompatible({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    name: 'pkws-provider',
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
    schema: z => z.object({
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
