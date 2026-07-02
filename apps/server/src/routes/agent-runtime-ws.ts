import type { FastifyPluginAsync } from 'fastify';
import { addWsClient } from '../ws-broadcast.js';

/**
 * WebSocket endpoint for Agent Runtime real-time events.
 *
 * ws://localhost:3731/api/agent-runtime/ws
 *
 * Clients connect via WebSocket and receive JSON-encoded WsEvent messages:
 *   { type: 'turn_started', caseId: '...', action: 'continue' }
 *   { type: 'turn_completed', caseId: '...', durationMs: 1234 }
 *   { type: 'turn_failed', caseId: '...', error: '...' }
 *   { type: 'session_created', caseId: '...' }
 *   { type: 'session_evicted', caseId: '...' }
 *   { type: 'queue_update', pending: 2, waiting: 1 }
 *   { type: 'runtime_status', running: true }
 */
export const agentRuntimeWsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/agent-runtime/ws', { websocket: true }, (socket, req) => {
    addWsClient(socket);
  });
};
