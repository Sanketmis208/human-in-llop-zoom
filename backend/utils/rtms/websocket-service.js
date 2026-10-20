import { WebSocketServer, WebSocket } from 'ws';
import { publishToSse } from './sse-service.js';
import { logger } from '../logger.js';

const log = logger('ws');
let wss = null;

// meetingId → Set<WebSocket>  (subscribed frontend clients)
const subscriptions = new Map();

/**
 * Attach a WebSocket server to an existing HTTP server.
 * Must be called after the HTTP server is created (after app.listen).
 * @param {import('http').Server} httpServer
 */
export function initWebSocketServer(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    const subscribedMeetings = new Set();

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore malformed frames
      }

      if (msg.type === 'subscribe' && msg.meetingId) {
        const id = String(msg.meetingId);
        subscribedMeetings.add(id);
        if (!subscriptions.has(id)) subscriptions.set(id, new Set());
        subscriptions.get(id).add(ws);
        safeSend(ws, { type: 'subscribed', meetingId: id });
        log.info('client subscribed', { meeting: id });
      }

      if (msg.type === 'unsubscribe' && msg.meetingId) {
        const id = String(msg.meetingId);
        subscribedMeetings.delete(id);
        subscriptions.get(id)?.delete(ws);
      }
    });

    ws.on('close', () => {
      for (const id of subscribedMeetings) {
        subscriptions.get(id)?.delete(ws);
      }
      subscribedMeetings.clear();
    });

    ws.on('error', (err) => log.error('client error', { error: err.message }));
  });

  log.info('server ready at /ws');
  return wss;
}

/**
 * Broadcast a message to every client subscribed to a meeting — both
 * WebSocket subscribers and Server-Sent Events subscribers. One publish
 * point, two transports. Returns total clients delivered to.
 */
export function broadcastToMeeting(meetingId, message) {
  // SSE fan-out (works through the single ngrok tunnel without WS upgrade)
  const sseCount = publishToSse(meetingId, message);

  // Legacy WebSocket fan-out (still used by anything connecting to /ws)
  const clients = subscriptions.get(String(meetingId));
  let wsCount = 0;
  if (clients && clients.size > 0) {
    const payload = JSON.stringify(message);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        wsCount++;
      }
    }
  }
  return sseCount + wsCount;
}

/** Total connected clients across all meetings. */
export function getTotalConnections() {
  return wss?.clients.size ?? 0;
}

function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
