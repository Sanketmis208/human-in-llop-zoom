/**
 * AI orchestration endpoints — pure analyze/summarize/ask helpers.
 *
 * Every function in utils/ai/ returns data and never mutates the store. These
 * route handlers decide whether to persist via taskStore.
 *
 *   POST /api/ai/analyze-transcript   body: { meetingId, transcript?, persist? }
 *   POST /api/ai/summarize-meeting    body: { meetingId, persist? }
 *   POST /api/ai/ask                  body: { meetingId, question }
 */

import express from 'express';
import taskStore from '../../utils/store/task-store.js';
import { analyzeTranscript } from '../../utils/ai/ai-task-analyzer.js';
import { generateMeetingSummary } from '../../utils/ai/summary-generator.js';
import { answerMeetingQuestion } from '../../utils/ai/meeting-context-agent.js';
import { notFound } from './helpers.js';
import { aiError } from './ai-helpers.js';

const router = express.Router();

router.post('/ai/analyze-transcript', async (req, res) => {
  const { meetingId, transcript: bodyTranscript, persist = true } = req.body ?? {};
  if (!meetingId) return res.status(400).json({ success: false, error: 'meetingId required' });

  const meeting = taskStore.getMeetingContext(meetingId);
  if (!meeting) return notFound(res, 'meeting');

  try {
    const transcript = bodyTranscript ?? meeting.transcript;
    const { tasks, usedAI } = await analyzeTranscript(transcript, {
      meetingId,
      meetingTitle: meeting.title,
    });
    const saved = persist ? tasks.map(t => taskStore.saveTaskSuggestion(t)) : [];
    res.json({ success: true, meetingId, usedAI, suggestions: saved.length ? saved : tasks });
  } catch (err) {
    return aiError(res, err, { meetingId, suggestions: [] });
  }
});

router.post('/ai/summarize-meeting', async (req, res) => {
  const { meetingId, persist = true } = req.body ?? {};
  if (!meetingId) return res.status(400).json({ success: false, error: 'meetingId required' });

  const meeting = taskStore.getMeetingContext(meetingId);
  if (!meeting) return notFound(res, 'meeting');

  try {
    const result = await generateMeetingSummary(meeting.transcript, { meetingTitle: meeting.title });
    if (persist && result.usedAI) {
      taskStore.upsertMeetingContext(meetingId, {
        summary:    result.summary,
        decisions:  result.decisions,
        highlights: result.highlights,
        risks:      result.risks,
      });
      taskStore.logActivity({ type: 'summary.generated', meetingId, actor: 'ai', payload: {} });
    }
    res.json({ success: true, meetingId, ...result });
  } catch (err) {
    return aiError(res, err, { meetingId });
  }
});

router.post('/ai/ask', async (req, res) => {
  const { meetingId, question } = req.body ?? {};
  if (!meetingId || !question) {
    return res.status(400).json({ success: false, error: 'meetingId and question required' });
  }
  try {
    const result = await answerMeetingQuestion(meetingId, question);
    res.json({ success: true, meetingId, question, ...result });
  } catch (err) {
    return aiError(res, err, { meetingId, question });
  }
});

export default router;
