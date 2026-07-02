import { describe, it, expect } from 'vitest';
import { buildContext, compressSession, estimateTokens } from './context-builder.js';
import { Action, DEFAULTS } from './types.js';
import type { CaseSession, Message } from './types.js';

function createTestSession(overrides: Partial<CaseSession> = {}): CaseSession {
  return {
    caseId: 'case_test_001',
    messages: [],
    turnCount: 0,
    totalTokens: 0,
    systemPrompt: '',
    workspaceRules: [],
    caseInstructions: '',
    awaitingUserInput: false,
    hasNewUserInput: false,
    lastActiveAt: new Date(),
    compressionEpoch: 0,
    ...overrides,
  };
}

function createMessages(count: number, role: Message['role'] = 'user'): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role,
    content: `Test message ${i + 1}. This is sample content for testing purposes.`,
    timestamp: new Date().toISOString(),
  }));
}

describe('context-builder', () => {
  describe('buildContext', () => {
    it('should build fresh context for NewTurn action', () => {
      const session = createTestSession({
        caseInstructions: 'Test instructions',
        workspaceRules: [{ id: '1', title: 'Test Rule', content: 'Do something', enabled: true, priority: 100, createdAt: '', updatedAt: '' }],
      });
      const ctx = buildContext(session, Action.NewTurn);

      expect(ctx).toContain('CLAUDE.md');
      expect(ctx).toContain(session.caseId);
      expect(ctx).toContain('Test instructions');
      expect(ctx).toContain('Test Rule');
      expect(ctx).toContain('Output Requirements');
    });

    it('should include conversation history for Continue action', () => {
      const messages = createMessages(3);
      const session = createTestSession({ messages, turnCount: 3, totalTokens: 500 });
      const ctx = buildContext(session, Action.Continue);

      expect(ctx).toContain('Conversation History');
      expect(ctx).toContain('Test message 1');
      expect(ctx).toContain('Test message 3');
      expect(ctx).toContain('Output Requirements');
    });

    it('should include compressed summary for CompressThenContinue action', () => {
      const messages = createMessages(5);
      const session = createTestSession({
        messages,
        turnCount: 5,
        totalTokens: 2000,
        compressedSummary: '[Epoch 1] earlier conversation summary',
        compressionEpoch: 1,
      });
      const ctx = buildContext(session, Action.CompressThenContinue);

      expect(ctx).toContain('earlier conversation summary');
      expect(ctx).toContain('Recent Messages');
      expect(ctx).toContain('Output Requirements');
    });

    it('should inject case data when provided', () => {
      const session = createTestSession();
      const ctx = buildContext(session, Action.NewTurn, {
        title: 'Test Article',
        contentBody: 'This is the article body content.',
        sourceUrl: 'https://example.com/article',
        instructionSummary: 'User wants a summary',
      });

      expect(ctx).toContain('Test Article');
      expect(ctx).toContain('article body content');
      expect(ctx).toContain('https://example.com/article');
    });
  });

  describe('compressSession', () => {
    it('should compress messages when count exceeds threshold', () => {
      const threshold = DEFAULTS.contextCompressThreshold; // 20
      const messages = createMessages(threshold + 5); // 25 messages
      const session = createTestSession({ messages, turnCount: 25, totalTokens: 5000 });

      compressSession(session);

      // Should have compressed summary
      expect(session.compressedSummary).toBeTruthy();
      expect(session.compressedSummary).toContain('Epoch');
      expect(session.compressionEpoch).toBe(1);

      // Should keep only recent messages
      expect(session.messages.length).toBeLessThanOrEqual(DEFAULTS.contextKeepRecentCount);
    });

    it('should not compress when under threshold', () => {
      const messages = createMessages(5);
      const session = createTestSession({ messages });
      const originalLength = session.messages.length;

      compressSession(session);

      expect(session.messages.length).toBe(originalLength);
      expect(session.compressionEpoch).toBe(0);
      expect(session.compressedSummary).toBeUndefined();
    });

    it('should merge with existing compressed summary', () => {
      const messages = createMessages(DEFAULTS.contextCompressThreshold + 10);
      const session = createTestSession({
        messages,
        compressedSummary: '[Epoch 1] first batch',
        compressionEpoch: 1,
      });

      compressSession(session);

      expect(session.compressedSummary).toContain('Epoch 1');
      expect(session.compressedSummary).toContain('Epoch 2');
      expect(session.compressionEpoch).toBe(2);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens as ceil(length / 4)', () => {
      expect(estimateTokens('hello')).toBe(2);  // "hello" = 5 chars, 5/4 = 1.25 → 2
      expect(estimateTokens('a')).toBe(1);       // 1/4 = 0.25 → 1
      expect(estimateTokens('')).toBe(0);        // 0
    });
  });
});

describe('scheduler — decideAction', () => {
  // We import from the SAME module
  // Use dynamic import to get the function
  it('should return NewTurn for first turn', async () => {
    const { decideAction } = await import('./scheduler.js');
    const session = createTestSession({ turnCount: 0 });
    expect(decideAction(session)).toBe(Action.NewTurn);
  });

  it('should return Continue for normal state', async () => {
    const { decideAction } = await import('./scheduler.js');
    const session = createTestSession({ turnCount: 5, totalTokens: 5000 });
    expect(decideAction(session)).toBe(Action.Continue);
  });

  it('should return CompressThenContinue when tokens exceed threshold', async () => {
    const { decideAction } = await import('./scheduler.js');
    const session = createTestSession({ turnCount: 10, totalTokens: 100_000 });
    expect(decideAction(session)).toBe(Action.CompressThenContinue);
  });

  it('should return CompressThenContinue when messages exceed threshold', async () => {
    const { decideAction } = await import('./scheduler.js');
    const messages = createMessages(DEFAULTS.contextCompressThreshold + 1);
    const session = createTestSession({ turnCount: 25, totalTokens: 5000, messages });
    expect(decideAction(session)).toBe(Action.CompressThenContinue);
  });
});

describe('output-parser', () => {
  it('should parse valid proposal.json', async () => {
    const { parseCliOutput, CliProposalSchema } = await import('./output-parser.js');

    const validProposal = {
      title: 'Test Proposal',
      summary: 'A test summary',
      valueJudgement: 'high',
      suggestedActions: ['mark_done'],
      reasoningSummary: 'Because it is good',
      requiresPatch: false,
    };

    // Validate schema directly
    const parsed = CliProposalSchema.parse(validProposal);
    expect(parsed.title).toBe('Test Proposal');
    expect(parsed.valueJudgement).toBe('high');
  });

  it('should reject invalid proposal', async () => {
    const { CliProposalSchema } = await import('./output-parser.js');

    expect(() => CliProposalSchema.parse({
      title: 'Missing fields',
      // missing summary, valueJudgement, etc.
    })).toThrow();
  });

  it('should parse valid patch-operations.json', async () => {
    const { CliPatchSchema } = await import('./output-parser.js');

    const validPatch = {
      operations: [
        { type: 'create_file', path: '/test/note.md', content: '# Hello' },
        { type: 'update_file', path: '/test/old.md', newContent: '# Updated' },
        { type: 'move_file', fromPath: '/test/a.md', toPath: '/test/b.md' },
      ],
    };

    const parsed = CliPatchSchema.parse(validPatch);
    expect(parsed.operations).toHaveLength(3);
    expect(parsed.operations[0].type).toBe('create_file');
    expect(parsed.operations[1].type).toBe('update_file');
    expect(parsed.operations[2].type).toBe('move_file');
  });

  it('should reject invalid patch operation type', async () => {
    const { CliPatchSchema } = await import('./output-parser.js');

    expect(() => CliPatchSchema.parse({
      operations: [
        { type: 'delete_file', path: '/test/nope.md' }, // not allowed
      ],
    })).toThrow();
  });

  it('should extract proposal from stdout when no file found', async () => {
    const { parseCliOutput } = await import('./output-parser.js');
    const stdout = `Some analysis text...
{"title":"From Stdout","summary":"Extracted","valueJudgement":"medium","suggestedActions":["drop"],"reasoningSummary":"Test","requiresPatch":false}
More text...`;

    const result = parseCliOutput([], stdout);
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.title).toBe('From Stdout');
  });
});
