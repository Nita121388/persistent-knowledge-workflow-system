import type { CaseId } from '@pkws/shared';
import type { SessionPersistence, Message } from './types.js';
import { DEFAULTS } from './types.js';
import { eq } from 'drizzle-orm';

/**
 * Keep only the most recent N messages for persistence.
 */
function trimRecent(messages: Message[], keepCount: number = DEFAULTS.contextKeepRecentCount): Message[] {
  return messages.length > keepCount ? messages.slice(-keepCount) : messages;
}

/**
 * Create a SessionPersistence backed by the @pkws/storage agent_sessions table.
 *
 * Storage strategy:
 * - Stores only recent N messages (not full history) in recentMessagesJson
 * - Stores AI-generated semantic summary in compressedSummary
 * - Old messagesJson is kept for backward compatibility (not written anymore)
 */
export function createPersistence(db: any, schema: any): SessionPersistence {
  return {
    async save(caseId: CaseId, data) {
      // Integrity check on recent messages
      if (data.recentMessages && !Array.isArray(data.recentMessages)) {
        console.warn(`[Persistence] Integrity warning for ${caseId}: recentMessages is not an array, skipping save`);
        return;
      }
      if (data.turnCount < 0) {
        console.warn(`[Persistence] Integrity warning for ${caseId}: negative turnCount ${data.turnCount}, clamping to 0`);
        data.turnCount = 0;
      }
      if (data.totalTokens < 0) {
        console.warn(`[Persistence] Integrity warning for ${caseId}: negative totalTokens ${data.totalTokens}, clamping to 0`);
        data.totalTokens = 0;
      }

      const now = new Date().toISOString();
      const recentJson = data.recentMessages ? JSON.stringify(data.recentMessages) : null;
      const row = db.select().from(schema.agentSessions).where(eq(schema.agentSessions.caseId, caseId)).get();

      if (row) {
        db.update(schema.agentSessions).set({
          recentMessagesJson: recentJson,
          compressedSummary: data.compressedSummary,
          turnCount: data.turnCount,
          totalTokens: data.totalTokens,
          compressionEpoch: data.compressionEpoch,
          awaitingUserInput: data.awaitingUserInput,
          updatedAt: now,
        }).where(eq(schema.agentSessions.caseId, caseId)).run();
      } else {
        db.insert(schema.agentSessions).values({
          caseId,
          recentMessagesJson: recentJson,
          compressedSummary: data.compressedSummary,
          turnCount: data.turnCount,
          totalTokens: data.totalTokens,
          compressionEpoch: data.compressionEpoch,
          awaitingUserInput: data.awaitingUserInput,
          updatedAt: now,
        }).run();
      }
    },

    async load(caseId: CaseId) {
      const row = db.select().from(schema.agentSessions).where(eq(schema.agentSessions.caseId, caseId)).get();
      if (!row) return null;

      // Try new recentMessagesJson first, fallback to old messagesJson
      let messages: Message[] = [];
      if (row.recentMessagesJson) {
        try {
          messages = JSON.parse(row.recentMessagesJson);
          if (!Array.isArray(messages)) {
            console.warn(`[Persistence] Integrity check failed for ${caseId}: recentMessagesJson is not an array, returning null`);
            return null;
          }
        } catch (err: any) {
          console.warn(`[Persistence] Integrity check failed for ${caseId}: cannot parse recentMessagesJson — ${err.message}`);
          return null;
        }
      } else if (row.messagesJson) {
        // Backward compatibility: read old full messagesJson
        try {
          const fullMessages: Message[] = JSON.parse(row.messagesJson);
          messages = trimRecent(fullMessages);
          console.log(`[Persistence] Loaded ${fullMessages.length} messages from legacy messagesJson for ${caseId}, trimmed to ${messages.length}`);
        } catch (err: any) {
          console.warn(`[Persistence] Legacy messagesJson parse failed for ${caseId}: ${err.message}`);
        }
      }

      return {
        messages,
        compressedSummary: row.compressedSummary,
        turnCount: Math.max(0, row.turnCount),
        totalTokens: Math.max(0, row.totalTokens),
        compressionEpoch: row.compressionEpoch,
        awaitingUserInput: row.awaitingUserInput,
      };
    },

    async delete(caseId: CaseId) {
      db.delete(schema.agentSessions).where(eq(schema.agentSessions.caseId, caseId)).run();
    },
  };
}
