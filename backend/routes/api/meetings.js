/**
 * GET /api/meetings*                  — read-only meeting data.
 *
 * Endpoints:
 *   GET /api/meetings                            list with summaries
 *   GET /api/meetings/:meetingId/context         full context: transcript + tasks + suggestions
 *   GET /api/meetings/:meetingId/tasks           open and completed tasks for the meeting
 *   GET /api/meetings/:meetingId/task-suggestions  AI-extracted suggestions
 *   GET /api/meetings/:meetingId/activity        recent activity events (paged via ?limit=)
 *   GET /api/meetings/:meetingId/changes         "what changed since this meeting"
 *
 * Live transcript streaming lives in routes/api/rtms-live.js.
 */

import express from 'express';
import taskStore from '../../utils/store/task-store.js';
import { unwrapMeetingId } from '../../utils/http-helpers.js';
import { notFound } from './helpers.js';

const router = express.Router();

router.get('/meetings', (_req, res) => {
  res.json({ success: true, meetings: taskStore.listMeetings() });
});

router.get('/meetings/:meetingId/context', (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  const ctx = taskStore.getMeetingContext(meetingId);
  if (!ctx) return notFound(res, 'meeting');
  res.json({ success: true, meeting: ctx });
});

router.get('/meetings/:meetingId/tasks', (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  res.json({
    success: true,
    meetingId,
    open:      taskStore.getOpenTasks(meetingId),
    completed: taskStore.getCompletedTasks(meetingId),
  });
});

router.get('/meetings/:meetingId/task-suggestions', (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  res.json({
    success: true,
    meetingId,
    suggestions: taskStore.getTaskSuggestions(meetingId),
  });
});

router.get('/meetings/:meetingId/activity', (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  const limit = Number(req.query.limit ?? 50);
  res.json({
    success: true,
    meetingId,
    events: taskStore.getActivity({ meetingId, limit }),
  });
});

router.get('/meetings/:meetingId/changes', (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  const ctx = taskStore.getMeetingContext(meetingId);
  if (!ctx) return notFound(res, 'meeting');
  res.json({
    success: true,
    meetingId,
    changes: taskStore.whatChangedSince(ctx.seriesId, meetingId),
  });
});

export default router;
