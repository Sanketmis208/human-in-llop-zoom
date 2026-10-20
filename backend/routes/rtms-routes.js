/**
 * RTMS internal API routes
 *
 * POST /api/rtms/status            — reports session status (called internally or by monitoring)
 * POST /api/rtms/broadcast         — receives transcript segments and fans them out to WS clients
 * POST /api/rtms/participant-event — participant join/leave forwarded from RTMS service
 * GET  /api/rtms/debug             — live session state (non-production only)
 *
 * NOTE: The Zoom RTMS event webhook (meeting.rtms_started / meeting.rtms_stopped)
 * is now handled by the unified handler at POST /webhooks — see webhook-routes.js.
 * Point your RTMS Event Subscription at https://<host>/webhooks, the same URL
 * used for Team Chat events.
 */
import express from 'express';
import { isSessionActive } from '../utils/rtms/rtms-service.js';
import { getSession, getActiveSessions } from '../utils/rtms/meeting-session-store.js';
import { getTranscript, addSegment } from '../utils/rtms/transcript-store.js';
import { broadcastToMeeting, getTotalConnections } from '../utils/rtms/websocket-service.js';

const router = express.Router();

// ── POST /api/rtms/status ─────────────────────────────────────────────────────

router.post('/status', (req, res) => {
  const { meetingId } = req.body;
  if (!meetingId) return res.status(400).json({ error: 'meetingId required' });

  const session = getSession(meetingId);
  const active  = isSessionActive(meetingId);

  res.json({
    meetingId,
    active,
    session: session ? {
      status:      session.status,
      startedAt:   session.startedAt,
      participants: [...session.participants.values()],
    } : null,
  });
});

// ── POST /api/rtms/broadcast ──────────────────────────────────────────────────
// Receives a transcript segment and fans it out to subscribed WebSocket clients.
// Exists as an HTTP endpoint so an external RTMS service can also call it.

router.post('/broadcast', (req, res) => {
  const { meetingId, segment } = req.body;
  if (!meetingId || !segment) {
    return res.status(400).json({ error: 'meetingId and segment required' });
  }

  const isNew = addSegment(meetingId, segment);
  if (!isNew) {
    return res.json({ received: true, broadcast: 0, duplicate: true });
  }

  const count = broadcastToMeeting(meetingId, {
    type: 'transcript.segment',
    meetingId,
    segment,
  });

  res.json({ received: true, broadcast: count });
});

// ── POST /api/rtms/participant-event ──────────────────────────────────────────

router.post('/participant-event', (req, res) => {
  const { meetingId, eventType, participants } = req.body;
  if (!meetingId) return res.status(400).json({ error: 'meetingId required' });

  const count = broadcastToMeeting(meetingId, {
    type: 'participant.event',
    meetingId,
    eventType,
    participants: participants ?? [],
  });

  res.json({ received: true, broadcast: count });
});

// ── GET /api/rtms/debug ───────────────────────────────────────────────────────
// Exposes live state for development inspection — disable in production.

router.get('/debug', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoint disabled in production' });
  }

  const sessions = getActiveSessions().map(s => ({
    meetingUuid:  s.meetingUuid,
    status:       s.status,
    startedAt:    s.startedAt,
    participants: [...s.participants.values()],
    transcriptSegments: getTranscript(s.meetingUuid).length,
  }));

  res.json({
    activeSessions: sessions.length,
    totalWsConnections: getTotalConnections(),
    sessions,
  });
});

export default router;
