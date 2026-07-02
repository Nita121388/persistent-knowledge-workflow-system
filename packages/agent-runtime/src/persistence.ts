import type { CaseId } from '@pkws/shared';
import type { SessionPersistence, Message } from './types.js';

/**
 * Create a SessionPersistence backed by the @pkws/storage agent_sessions table.
 */
export function createPersistence(db: any, schema: any): SessionPersistence {
  return {
    async save(caseId: CaseId, data) {
      // Integrity check: validate messages are well-formed
      if (!Array.isArray(data.messages)) {
        console.warn(`[Persistence] Integrity warning for ${caseId}: messages is not an array, skipping save`);
        return;
      }
      for (const msg of data.messages) {
        if (!msg.role || !msg.content) {
          console.warn(`[Persistence] Integrity warning for ${caseId}: message missing role or content`);
        }
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
      const row = db.select().from(schema.agentSessions).where(schema.agentSessions.caseId.eq(caseId)).get();

      if (row) {
        db.update(schema.agentSessions).set({
          messagesJson: JSON.stringify(data.messages),
          compressedSummary: data.compressedSummary,
          turnCount: data.turnCount,
          totalTokens: data.totalTokens,
          compressionEpoch: data.compressionEpoch,
          awaitingUserInput: data.awaitingUserInput,
          updatedAt: now,
        }).where(schema.agentSessions.caseId.eq(caseId)).run();
      } else {
        db.insert(schema.agentSessions).values({
          caseId,
          messagesJson: JSON.stringify(data.messages),
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
      const row = db.select().from(schema.agentSessions).where(schema.agentSessions.caseId.eq(caseId)).get();
      if (!row) return null;

      // Integrity check on load
      let messages: Message[];
      try {
        messages = JSON.parse(row.messagesJson);
        if (!Array.isArray(messages)) {
          console.warn(`[Persistence] Integrity check failed for ${caseId}: messagesJson is not an array, returning null`);
          return null;
        }
      } catch (err: any) {
        console.warn(`[Persistence] Integrity check failed for ${caseId}: cannot parse messagesJson — ${err.message}`);
        return null;
      }

      if (row.turnCount < 0 || row.totalTokens < 0) {
        console.warn(`[Persistence] Integrity check fixed negative values for ${caseId}`);
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
      db.delete(schema.agentSessions).where(schema.agentSessions.caseId.eq(caseId)).run();
    },
  };
}
