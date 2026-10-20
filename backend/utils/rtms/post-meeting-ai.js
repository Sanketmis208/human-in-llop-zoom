/**
 * Post-meeting AI pipeline.
 *
 * Fires on `meeting.rtms_stopped` (via cleanupSession in rtms-service.js).
 * Reads the captured transcript from the TaskStore, runs the analyzer and
 * the summary generator in parallel, persists results as pending suggestions
 * and meeting metadata, broadcasts a `meeting.analyzed` event to live
 * subscribers, and posts a threaded Team Chat update.
 *
 * Best-effort: any failure (no transcript, no API key, model error) is
 * logged and surfaced via the broadcast — never throws.
 */

import { broadcastToMeeting } from './websocket-service.js';
import taskStore from '../store/task-store.js';
import { analyzeTranscript } from '../ai/ai-task-analyzer.js';
import { generateMeetingSummary } from '../ai/summary-generator.js';
import { notifySuggestionsDetected } from '../handlers/task-event-notifier.js';
import { logger } from '../logger.js';

const log = logger('rtms');

// Meetings that have already triggered post-meeting AI. Prevents double-run
// when cleanupSession is called both by client.onLeave and by stopRtmsSession's
// catch block. Module-scoped on purpose — analysis should run at most once
// per meeting per process lifetime.
const analyzedMeetings = new Set();

/**
 * @param {string} meetingUuid
 * @returns {Promise<{ suggestionCount: number, summarized: boolean, reason?: string }>}
 */
export async function runPostMeetingAnalysis(meetingUuid) {
  if (analyzedMeetings.has(meetingUuid)) {
    log.info('AI analysis already ran, skipping', { meeting: meetingUuid });
    return { suggestionCount: 0, summarized: false, reason: 'already_analyzed' };
  }
  analyzedMeetings.add(meetingUuid);

  const transcript = taskStore.getTranscript(meetingUuid);
  if (!transcript.length) {
    log.info('skipping AI analysis: no transcript', { meeting: meetingUuid });
    return { suggestionCount: 0, summarized: false, reason: 'no_transcript' };
  }

  const meeting = taskStore.getMeetingContext(meetingUuid);
  const title = meeting?.title || `Live meeting ${meetingUuid}`;

  log.info('running post-meeting AI', { meeting: meetingUuid, segments: transcript.length });

  const [extraction, summary] = await Promise.all([
    analyzeTranscript(transcript, { meetingId: meetingUuid, meetingTitle: title }).catch(err => {
      log.error('analyzeTranscript failed', { error: err.message });
      return { tasks: [], usedAI: false };
    }),
    generateMeetingSummary(transcript, { meetingTitle: title }).catch(err => {
      log.error('generateMeetingSummary failed', { error: err.message });
      return { summary: '', decisions: [], highlights: [], risks: [], usedAI: false };
    }),
  ]);

  const saved = extraction.tasks.map(t => taskStore.saveTaskSuggestion(t));

  if (summary.usedAI) {
    taskStore.upsertMeetingContext(meetingUuid, {
      summary:    summary.summary,
      decisions:  summary.decisions,
      highlights: summary.highlights,
      risks:      summary.risks,
    });
    taskStore.logActivity({ type: 'summary.generated', meetingId: meetingUuid, actor: 'ai', payload: {} });
  }

  taskStore.logActivity({
    type: 'meeting.analyzed',
    meetingId: meetingUuid,
    actor: 'ai',
    payload: { suggestionCount: saved.length, summarized: summary.usedAI },
  });

  broadcastToMeeting(meetingUuid, {
    type:            'meeting.analyzed',
    meetingId:       meetingUuid,
    suggestionCount: saved.length,
    summarized:      summary.usedAI,
    usedAI:          extraction.usedAI || summary.usedAI,
  });

  // Post a threaded Team Chat update if a notification channel is configured.
  notifySuggestionsDetected({
    meetingId:    meetingUuid,
    count:        saved.length,
    meetingTitle: title,
  }).catch(err => log.error('suggestions notify failed', { error: err.message }));

  log.info('AI analysis done', { meeting: meetingUuid, suggestions: saved.length, summary: summary.usedAI });
  return { suggestionCount: saved.length, summarized: summary.usedAI };
}
