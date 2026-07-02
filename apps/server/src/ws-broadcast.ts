import type { WsEvent } from '@pkws/agent-runtime';
import type { LogEntry } from '@pkws/agent-runtime';
import type { WebSocket } from 'ws';

/** All connected WebSocket clients */
const clients = new Set<WebSocket>();

/**
 * Register a new WebSocket client for broadcasts.
 */
export function addWsClient(ws: WebSocket): void {
  clients.add(ws);

  // Send initial connected message
  ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));

  // Auto-remove on close
  ws.on('close', () => {
    clients.delete(ws);
  });

  // Handle errors so a broken connection doesn't crash
  ws.on('error', (err) => {
    console.warn('[ws-broadcast] Client error:', err.message);
    clients.delete(ws);
  });
}

/**
 * Broadcast an Agent Runtime event to all connected WebSocket clients.
 */
export function broadcastWsEvent(event: WsEvent): void {
  const message = JSON.stringify(event);

  sendToAll(message);
}

/**
 * Broadcast a log entry to all connected WebSocket clients.
 */
export function broadcastLogEntry(entry: LogEntry): void {
  const message = JSON.stringify({ type: 'log_entry', ...entry });

  sendToAll(message);
}

function sendToAll(message: string): void {
  for (const ws of clients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(message);
      } catch (err: any) {
        console.warn('[ws-broadcast] Failed to send to client:', err.message);
        clients.delete(ws);
      }
    } else {
      clients.delete(ws);
    }
  }
}
