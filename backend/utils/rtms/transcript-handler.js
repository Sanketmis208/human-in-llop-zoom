/**
 * Per-segment transcript processing.
 *
 * Receives raw frames from the @zoom/rtms SDK's onTranscriptData callback
 * (via rtms-service.js), normalizes them, deduplicates, mirrors into both
 * stores, broadcasts to live subscribers, and runs the keyword-based task
 * auto-completion matcher.
 *
 * The actual SDK callback wiring lives in rtms-service.js; this module owns
 * what happens AFTER a frame arrives.
 */

import { broadcastToMeeting } from './websocket-service.js';
import { addSegment } from './transcript-store.js';
import { matchTranscriptToTasks } from '../meeting-tasks/taskMatcher.js';
import { getAllTasks, completeTask } from '../meeting-tasks/taskStore.js';
import taskStore from '../store/task-store.js';
import { logger } from '../logger.js';

const log = logger('rtms');

// Per-meeting transcript segment counts. Used to throttle log output: log
// the first segment (proves the pipe works) and every 25th, plus full text
// at debug level. Cleared automatically when the meeting record is removed.
const segmentCounts = new Map();

/**
 * Handle one transcript frame from @zoom/rtms.
 *
 * @param {string} meetingUuid - Zoom meeting UUID
 * @param {object} raw         - Fields pulled out of the SDK callback args
 */
export function handleTranscriptSegment(meetingUuid, raw) {
  const segment = normalizeSegment(raw);

  if (!segment.text?.trim()) return;        // skip empty/whitespace frames

  const isNew = addSegment(meetingUuid, segment);
  if (!isNew) return;                        // dedup by seqNo

  logArrival(meetingUuid, segment);
  mirrorToTaskStore(meetingUuid, segment);
  broadcastSegment(meetingUuid, segment);
  runKeywordAutoComplete(meetingUuid, segment);
}

// ── Sub-steps (private) ─────────────────────────────────────────────────────

function logArrival(meetingUuid, segment) {
  const n = (segmentCounts.get(meetingUuid) ?? 0) + 1;
  segmentCounts.set(meetingUuid, n);
  if (n === 1 || n % 25 === 0) {
    const preview = segment.text.slice(0, 80) + (segment.text.length > 80 ? '…' : '');
    log.info(`segment #${n}`, { meeting: meetingUuid, speaker: segment.speakerLabel, text: preview });
  }
  log.debug('transcript segment', { meeting: meetingUuid, seqNo: segment.seqNo, text: segment.text });
}

/**
 * Mirror the segment into the unified TaskStore so the AI workflow layer
 * (post-meeting analysis, dashboard, context Q&A) has access to the full
 * transcript without coupling to the live broadcast bus.
 */
function mirrorToTaskStore(meetingUuid, segment) {
  taskStore.appendTranscriptSegment(meetingUuid, {
    ts:      new Date(segment.tStartMs || Date.now()).toISOString(),
    speaker: segment.speakerLabel,
    text:    segment.text,
  });
}

/** Fan the segment out to every WebSocket / SSE subscriber for this meeting. */
function broadcastSegment(meetingUuid, segment) {
  broadcastToMeeting(meetingUuid, {
    type:      'transcript.segment',
    meetingId: meetingUuid,
    segment,
  });
}

/**
 * Run the keyword-based task matcher against this segment. If the speaker
 * appears to be indicating a task was completed, auto-mark it and broadcast
 * a task.completed event so the live UI updates.
 *
 * TODO (Phase 2): replace matchTranscriptToTasks with an AI-based matcher
 *   for higher accuracy (call OpenAI with a structured prompt).
 * TODO (Phase 3): after marking complete here, also call the Zoom Task API
 *   to sync the completion.
 */
function runKeywordAutoComplete(meetingUuid, segment) {
  const matches = matchTranscriptToTasks(segment.text, getAllTasks());

  for (const match of matches) {
    const segmentRef = segment.seqNo != null ? String(segment.seqNo) : `${meetingUuid}-${Date.now()}`;

    const updated = completeTask(match.taskId, segmentRef, {
      matchedText:     segment.text,
      confidence:      match.confidence,
      reason:          match.reason,
      matchedKeywords: match.matchedKeywords,
      matchedPhrase:   match.matchedPhrase,
      originalText:    segment.text,
    });

    if (!updated) continue;

    log.info('task auto-completed', {
      meeting:    meetingUuid,
      task:       match.taskId,
      confidence: match.confidence,
      reason:     match.reason,
    });

    broadcastToMeeting(meetingUuid, {
      type: 'task.completed',
      data: {
        taskId:                match.taskId,
        meetingInstanceId:     updated.meetingInstanceId,
        completedByTranscript: true,
        matchedTranscriptText: segment.text,
        confidence:            match.confidence,
        reason:                match.reason,
      },
    });
  }
}

/**
 * Normalize the raw @zoom/rtms transcript callback arguments into a
 * consistent shape. The SDK's underlying native layer may evolve — keep
 * field mapping here for easy adjustment.
 */
function normalizeSegment({ userId, userName, text, seqNo, tStartMs, tEndMs, confidence }) {
  return {
    speakerId:    String(userId   ?? 'unknown'),
    speakerLabel: String(userName ?? 'Participant'),
    text:         String(text     ?? ''),
    seqNo:        seqNo    != null ? Number(seqNo)    : undefined,
    tStartMs:     tStartMs != null ? Number(tStartMs) : Date.now(),
    tEndMs:       tEndMs   != null ? Number(tEndMs)   : null,
    confidence:   confidence != null ? Number(confidence) : null,
  };
}
