/**
 * Live RTMS session endpoints — discovery, synthetic test stream, and the
 * SSE transcript stream the Next.js live page consumes.
 *
 *   GET  /api/rtms/active                            list active sessions
 *   POST /api/rtms/test-stream                       inject a scripted demo (no Zoom needed)
 *   GET  /api/meetings/:meetingId/transcript-stream  SSE stream of segments + status events
 *
 * The transcript-stream endpoint lives here (not under meetings.js) because
 * everything in this module is about real-time RTMS state.
 */

import express from 'express';
import { randomUUID } from 'node:crypto';
import { subscribeSse } from '../../utils/rtms/sse-service.js';
import {
  getActiveSessions,
  createSession,
  updateSessionStatus,
  upsertParticipant,
  removeSession,
} from '../../utils/rtms/meeting-session-store.js';
import { getTranscript as getRtmsTranscript, addSegment } from '../../utils/rtms/transcript-store.js';
import { broadcastToMeeting } from '../../utils/rtms/websocket-service.js';
import { unwrapMeetingId } from '../../utils/http-helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('api');
const router = express.Router();

// ── GET /api/rtms/active ────────────────────────────────────────────────────

router.get('/rtms/active', (_req, res) => {
  const sessions = getActiveSessions().map(s => ({
    meetingUuid:        s.meetingUuid,
    status:             s.status,
    startedAt:          s.startedAt,
    participants:       [...(s.participants?.values?.() ?? [])],
    transcriptSegments: getRtmsTranscript(s.meetingUuid).length,
  }));
  res.json({ success: true, sessions });
});

// ── POST /api/rtms/test-stream ──────────────────────────────────────────────
// A scripted demo conversation pushed through the same broadcast bus that
// real RTMS uses. Useful for verifying the live UI without a real meeting.

const TEST_TRANSCRIPT = [
  { speaker: 'Alice', text: 'Quick check — where are we on the press release? Legal flagged it last week and I haven\'t seen a follow-up.' },
  { speaker: 'Carol', text: "I'll grab it today. I'll send the draft back to legal by tomorrow morning at the latest." },
  { speaker: 'Bob',   text: 'Demo environment update — staging is stable as of this morning. I\'ll do a full dry run on Friday and report back.' },
  { speaker: 'Alice', text: 'Great. I still owe the all-hands invite. I\'ll send that out by end of day today, promise.' },
  { speaker: 'Carol', text: 'Also, Dave on engineering wants to know if we need a hotfix slot reserved during launch week.' },
  { speaker: 'Bob',   text: 'Yes, reserve it. We should not be shipping anything non-critical during launch week.' },
  { speaker: 'Alice', text: 'Action items: Carol — press release back to legal. I send the all-hands invite. Bob does the demo dry run Friday.' },
];

const TEST_INTERVAL_MS    = 2_000;   // pacing between scripted segments
const TEST_CLEANUP_MS     = 30_000;  // how long the synthetic session lingers in /active after it ends

router.post('/rtms/test-stream', (req, res) => {
  const meetingId = req.body?.meetingId ?? `test-stream-${randomUUID().slice(0, 8)}`;
  const segments  = TEST_TRANSCRIPT;

  createSession(meetingId, 'synthetic', 'synthetic');
  updateSessionStatus(meetingId, 'active');
  upsertParticipant(meetingId, { userId: 'demo-alice', userName: 'Alice (demo)' });
  upsertParticipant(meetingId, { userId: 'demo-carol', userName: 'Carol (demo)' });
  upsertParticipant(meetingId, { userId: 'demo-bob',   userName: 'Bob (demo)'   });

  broadcastToMeeting(meetingId, { type: 'meeting.status', meetingId, status: 'active' });

  segments.forEach((seg, i) => {
    setTimeout(() => {
      const segment = {
        speakerLabel: seg.speaker,
        text:         seg.text,
        seqNo:        Date.now() + i,
        tStartMs:     Date.now(),
      };
      addSegment(meetingId, segment);
      broadcastToMeeting(meetingId, { type: 'transcript.segment', meetingId, segment });
    }, i * TEST_INTERVAL_MS);
  });

  const totalMs = segments.length * TEST_INTERVAL_MS;
  setTimeout(() => {
    updateSessionStatus(meetingId, 'stopped');
    broadcastToMeeting(meetingId, { type: 'meeting.status', meetingId, status: 'stopped' });
    setTimeout(() => removeSession(meetingId), TEST_CLEANUP_MS);
  }, totalMs + 500);

  res.json({
    success: true,
    meetingId,
    segmentCount: segments.length,
    durationMs:   totalMs,
    viewUrl:      `/meetings/${encodeURIComponent(meetingId)}/live`,
  });
});

// ── GET /api/meetings/:meetingId/transcript-stream (SSE) ────────────────────
// Browser opens this with EventSource. On connect we send any buffered
// segments as a "transcript.snapshot" event, then stream live events.

router.get('/meetings/:meetingId/transcript-stream', (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  log.info('sse subscribe', { meeting: meetingId });
  const detach = subscribeSse(meetingId, req, res);

  const buffered = getRtmsTranscript(meetingId);
  if (buffered.length > 0) {
    res.write(`event: transcript.snapshot\ndata: ${JSON.stringify({ meetingId, segments: buffered })}\n\n`);
  }

  req.on('close', detach);
});

export default router;
