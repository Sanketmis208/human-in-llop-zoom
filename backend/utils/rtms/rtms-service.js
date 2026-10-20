/**
 * RTMS service — manages @zoom/rtms Client connections for active meetings.
 *
 * Responsibility: lifecycle only. Connect to Zoom RTMS for a meeting, wire
 * the SDK callbacks to the right downstream modules, and clean up cleanly.
 *
 *   meeting.rtms_started webhook → startRtmsSession()
 *     → @zoom/rtms Client.join()
 *       → onTranscriptData → transcript-handler.handleTranscriptSegment()
 *       → onParticipantEvent → broadcast
 *       → onSessionUpdate → broadcast
 *       → onLeave → cleanupSession() → post-meeting-ai.runPostMeetingAnalysis()
 *
 *   meeting.rtms_stopped webhook → stopRtmsSession()
 *     → Client.leave() → (eventually) onLeave → cleanupSession()
 *
 * The actual per-segment work lives in ./transcript-handler.js. The post-meeting
 * AI pipeline lives in ./post-meeting-ai.js. This file stays focused on the
 * lifecycle and the SDK contract.
 */
import rtms from '@zoom/rtms';
import { broadcastToMeeting } from './websocket-service.js';
import { createSession, updateSessionStatus, removeSession, upsertParticipant } from './meeting-session-store.js';
import taskStore from '../store/task-store.js';
import { handleTranscriptSegment } from './transcript-handler.js';
import { runPostMeetingAnalysis } from './post-meeting-ai.js';
import { logger } from '../logger.js';

const log = logger('rtms');

const { Client } = rtms;

// meetingUuid → Client instance
const activeClients = new Map();

const POLL_INTERVAL_MS = 500;      // how often the SDK polls for new data
const SESSION_CLEANUP_MS = 60_000; // how long to keep the session record around so
                                   // the frontend can read final state after stop

// ── Lifecycle: start ────────────────────────────────────────────────────────

/**
 * Start an RTMS session for a meeting. Called from the
 * `meeting.rtms_started` webhook handler.
 */
export async function startRtmsSession(meetingUuid, rtmsStreamId, serverUrls) {
  if (activeClients.has(meetingUuid)) {
    log.warn('session already active', { meeting: meetingUuid });
    return;
  }

  log.info('starting session', { meeting: meetingUuid, stream: rtmsStreamId });
  createSession(meetingUuid, rtmsStreamId, serverUrls);
  registerMeetingContext(meetingUuid, rtmsStreamId);

  const client = new Client();
  wireClientCallbacks(client, meetingUuid);
  attemptJoin(client, meetingUuid, rtmsStreamId, serverUrls);
}

/**
 * Register the meeting in the unified TaskStore so AI queries and the Next.js
 * dashboard can find it. Idempotent — safe to call again for the same UUID.
 */
function registerMeetingContext(meetingUuid, rtmsStreamId) {
  taskStore.upsertMeetingContext(meetingUuid, {
    id:              meetingUuid,
    zoomMeetingUuid: meetingUuid,
    title:           `Live meeting ${meetingUuid.slice(-8)}`,
    date:            new Date().toISOString(),
    participants:    [],
    summary:         '',
    decisions:       [],
    highlights:      [],
    risks:           [],
  });
  taskStore.logActivity({ type: 'meeting.started', meetingId: meetingUuid, actor: 'system', payload: { rtmsStreamId } });
}

/**
 * Wire SDK callbacks to downstream modules. Each callback in this function
 * is a thin adapter: it translates SDK arguments into the shapes our internal
 * modules expect, then delegates.
 */
function wireClientCallbacks(client, meetingUuid) {
  // onJoinConfirm(reason): reason=0 means success. Enable transcript stream
  // on success; otherwise broadcast an error status and drop the client.
  client.onJoinConfirm((reason) => {
    if (reason !== 0) {
      log.error('join failed', { meeting: meetingUuid, reason });
      updateSessionStatus(meetingUuid, 'error');
      broadcastToMeeting(meetingUuid, {
        type:      'meeting.status',
        meetingId: meetingUuid,
        status:    'error',
        reason:    `Join failed with reason code ${reason}`,
      });
      activeClients.delete(meetingUuid);
      return;
    }

    log.info('join confirmed', { meeting: meetingUuid });
    updateSessionStatus(meetingUuid, 'active');

    try {
      // The native binding requires the boolean: enableTranscript(true).
      // Calling with no argument throws "Boolean argument expected".
      client.enableTranscript(true);
      log.info('transcript enabled', { meeting: meetingUuid });
    } catch (err) {
      log.warn('enableTranscript(true) failed', { meeting: meetingUuid, error: err.message });
    }

    broadcastToMeeting(meetingUuid, {
      type:      'meeting.status',
      meetingId: meetingUuid,
      status:    'active',
    });
  });

  // onTranscriptData(buffer, size, timestamp, metadata)
  client.onTranscriptData((buffer, _size, timestamp, metadata) => {
    handleTranscriptSegment(meetingUuid, {
      userId:     metadata?.userId,
      userName:   metadata?.userName,
      text:       buffer.toString('utf8'),
      seqNo:      timestamp,                  // SDK timestamp doubles as dedup key
      tStartMs:   timestamp,
      tEndMs:     null,
      confidence: null,
    });
  });

  // onParticipantEvent(eventType, timestamp, participants)
  client.onParticipantEvent((eventType, timestamp, participants) => {
    for (const p of participants ?? []) {
      upsertParticipant(meetingUuid, { userId: p.userId, userName: p.userName });
    }
    broadcastToMeeting(meetingUuid, {
      type:         'participant.event',
      meetingId:    meetingUuid,
      eventType,
      timestamp,
      participants: participants ?? [],
    });
  });

  // onSessionUpdate(op, sessionInfo)
  // op values: SESSION_EVENT_ADD=1, SESSION_EVENT_STOP=2, SESSION_EVENT_PAUSE=3, SESSION_EVENT_RESUME=4
  client.onSessionUpdate((op, sessionInfo) => {
    log.info('session update', { meeting: meetingUuid, op, sessionInfo });
    if      (op === rtms.SESSION_EVENT_PAUSE)  broadcastStatus('paused');
    else if (op === rtms.SESSION_EVENT_RESUME) broadcastStatus('active');
    else if (op === rtms.SESSION_EVENT_ADD)    broadcastStatus('active');
    else if (op === rtms.SESSION_EVENT_STOP)   broadcastStatus('stopped');

    function broadcastStatus(status) {
      broadcastToMeeting(meetingUuid, { type: 'meeting.status', meetingId: meetingUuid, status });
    }
  });

  // onLeave(reason): client disconnected. Triggers cleanup + post-meeting AI.
  client.onLeave((reason) => {
    log.info('client left', { meeting: meetingUuid, reason });
    cleanupSession(meetingUuid);
  });
}

/**
 * Initiate the underlying WebSocket join. Synchronous from our perspective —
 * the SDK returns immediately and uses the onJoinConfirm callback to report
 * whether the handshake succeeded.
 */
function attemptJoin(client, meetingUuid, rtmsStreamId, serverUrls) {
  try {
    // @zoom/rtms reads ZM_RTMS_CLIENT / ZM_RTMS_SECRET from env by default;
    // passing them explicitly here works regardless of env var naming.
    const joined = client.join({
      meeting_uuid:   meetingUuid,
      rtms_stream_id: rtmsStreamId,
      server_urls:    serverUrls,
      client:         process.env.ZOOM_CLIENT_ID,
      secret:         process.env.ZOOM_CLIENT_SECRET,
      pollInterval:   POLL_INTERVAL_MS,
    });
    if (!joined) {
      throw new Error('client.join() returned false — check credentials or server_urls');
    }
    activeClients.set(meetingUuid, client);
    log.info('join initiated', { meeting: meetingUuid });
  } catch (err) {
    log.error('join error', { meeting: meetingUuid, error: err.message });
    updateSessionStatus(meetingUuid, 'error');
    broadcastToMeeting(meetingUuid, {
      type:      'meeting.status',
      meetingId: meetingUuid,
      status:    'error',
      reason:    err.message,
    });
  }
}

// ── Lifecycle: stop ─────────────────────────────────────────────────────────

/**
 * Stop an RTMS session. Called from the `meeting.rtms_stopped` webhook
 * handler. cleanupSession runs via the onLeave callback in the happy path;
 * we call it directly if leave() throws so a hung session doesn't leak.
 */
export function stopRtmsSession(meetingUuid) {
  const client = activeClients.get(meetingUuid);
  if (!client) {
    log.warn('no active client', { meeting: meetingUuid });
    return;
  }

  log.info('stopping session', { meeting: meetingUuid });
  try {
    client.leave();
  } catch (err) {
    log.error('leave() error', { meeting: meetingUuid, error: err.message });
    cleanupSession(meetingUuid);
  }
}

export function isSessionActive(meetingUuid) {
  return activeClients.has(meetingUuid);
}

/**
 * Final teardown. Idempotent — post-meeting AI guards against double-run
 * internally, so this is safe to call from both onLeave and stopRtmsSession's
 * error path.
 */
function cleanupSession(meetingUuid) {
  activeClients.delete(meetingUuid);
  updateSessionStatus(meetingUuid, 'stopped');
  broadcastToMeeting(meetingUuid, {
    type:      'meeting.status',
    meetingId: meetingUuid,
    status:    'stopped',
  });

  // Fire-and-forget post-meeting AI analysis. We don't block the webhook
  // response on this — analysis can run for several seconds.
  runPostMeetingAnalysis(meetingUuid).catch(err =>
    log.error('post-meeting AI failed', { meeting: meetingUuid, error: err.message }),
  );

  // Keep session record briefly so the frontend can read final state.
  setTimeout(() => removeSession(meetingUuid), SESSION_CLEANUP_MS);
}

// Re-export so callers that imported runPostMeetingAnalysis from this file
// before the split continue to work without an import path change.
export { runPostMeetingAnalysis } from './post-meeting-ai.js';
