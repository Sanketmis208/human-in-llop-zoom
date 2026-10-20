/**
 * Server-Sent Events fan-out for live meeting events.
 *
 * Parallel to websocket-service.js, but uses plain HTTP — which proxies cleanly
 * through Next.js rewrites and a single ngrok tunnel without needing the
 * WebSocket upgrade handshake.
 *
 * Lifecycle:
 *   subscribeSse(meetingId, req, res) attaches a client and returns a detach
 *   function. publishToSse(meetingId, message) writes to every attached client
 *   for that meeting. Clients are dropped automatically on res "close".
 */

// meetingId → Set<{ res, write }>
const subscribers = new Map();

const HEARTBEAT_MS = 15_000; // SSE comment ping to keep proxies from idling

/**
 * Register a Server-Sent Events client for the given meeting.
 * Writes initial headers and a connected event, then returns a detach fn.
 *
 * @returns {() => void} call to detach (no-op if already closed)
 */
export function subscribeSse(meetingId, req, res) {
  const id = String(meetingId);

  res.set({
    'Content-Type':                'text/event-stream',
    'Cache-Control':               'no-cache, no-transform',
    'Connection':                  'keep-alive',
    'X-Accel-Buffering':           'no',  // hint to nginx not to buffer
  });
  res.flushHeaders?.();

  function write(event, data) {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  write('connected', { meetingId: id, ts: Date.now() });

  const client = { res, write };
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id).add(client);

  // Send periodic comments so corporate proxies / load balancers don't kill
  // an "idle" connection between transcript segments.
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* connection closed */ }
  }, HEARTBEAT_MS);

  const detach = () => {
    clearInterval(heartbeat);
    subscribers.get(id)?.delete(client);
  };

  req.on('close', detach);
  req.on('aborted', detach);
  return detach;
}

/**
 * Push an event to every SSE client subscribed to the meeting.
 * Returns the number of clients delivered to.
 */
export function publishToSse(meetingId, message) {
  const clients = subscribers.get(String(meetingId));
  if (!clients || clients.size === 0) return 0;
  let count = 0;
  for (const c of clients) {
    try {
      // Use the message.type as the SSE event name when present so the
      // browser-side EventSource can dispatch via addEventListener('type').
      c.write(message?.type, message);
      count++;
    } catch {
      clients.delete(c);
    }
  }
  return count;
}

export function getSseConnectionCount(meetingId) {
  return subscribers.get(String(meetingId))?.size ?? 0;
}
