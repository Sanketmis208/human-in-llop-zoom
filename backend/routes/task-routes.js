/**
 * Meeting Task API routes
 *
 * GET  /api/meeting-tasks                       — all series, instances, and tasks
 * GET  /api/meeting-tasks/series/:seriesId      — tasks for a specific series
 * GET  /api/meeting-tasks/instances/:instanceId — tasks for a specific meeting instance
 * POST /api/meeting-tasks/simulate-transcript   — demo: run matcher + auto-complete (no live RTMS needed)
 * POST /api/meeting-tasks/reset                 — reset all tasks to sample data (demo)
 * POST /api/meeting-tasks/:taskId/complete      — manually mark a task complete
 * POST /api/meeting-tasks/:taskId/reopen        — reopen a completed task
 *
 * Note: /simulate-transcript and /reset are declared before /:taskId routes so
 * Express does not treat the literal strings as task IDs.
 *
 * TODO (Phase 3): Replace each store call with the corresponding Zoom Task API request.
 */

import express from 'express';
import {
  getAllSeries,
  getMeetingInstances,
  getAllTasks,
  getTasksBySeries,
  getTasksByInstance,
  getTask,
  completeTask,
  reopenTask,
  resetToSampleData,
  buildTaskSummary,
} from '../utils/meeting-tasks/taskStore.js';
import { matchTranscriptToTasks } from '../utils/meeting-tasks/taskMatcher.js';

const router = express.Router();

// ── GET /api/meeting-tasks ────────────────────────────────────────────────────
// Returns everything the task dashboard needs on first load.

router.get('/', (_req, res) => {
  const allTasks  = getAllTasks();
  const series    = getAllSeries();
  const instances = getMeetingInstances();
  const summary   = buildTaskSummary(allTasks);

  res.json({ success: true, summary, series, instances, tasks: allTasks });
});

// ── GET /api/meeting-tasks/series/:seriesId ───────────────────────────────────

router.get('/series/:seriesId', (req, res) => {
  const { seriesId } = req.params;
  const tasks     = getTasksBySeries(seriesId);
  const instances = getMeetingInstances(seriesId);
  const summary   = buildTaskSummary(tasks);

  res.json({ success: true, seriesId, summary, instances, tasks });
});

// ── GET /api/meeting-tasks/instances/:instanceId ──────────────────────────────

router.get('/instances/:instanceId', (req, res) => {
  const { instanceId } = req.params;
  const tasks   = getTasksByInstance(instanceId);
  const summary = buildTaskSummary(tasks);

  res.json({ success: true, instanceId, summary, tasks });
});

// ── POST /api/meeting-tasks/simulate-transcript ───────────────────────────────
// Demo endpoint: run the task matcher against provided text and auto-complete
// any matched tasks — exactly as the live RTMS flow does during a real meeting.

router.post('/simulate-transcript', (req, res) => {
  const { text } = req.body ?? {};
  if (!text?.trim()) {
    return res.status(400).json({ success: false, error: 'text is required' });
  }

  const matches = matchTranscriptToTasks(text, getAllTasks());
  if (!matches.length) {
    return res.json({ success: false, matches: [], completedTasks: [] });
  }

  // Auto-complete the highest-confidence match and record the rest.
  const [best] = matches;
  const updated = completeTask(best.taskId, `demo-sim-${Date.now()}`, {
    matchedText:     text,
    confidence:      best.confidence,
    reason:          best.reason,
    matchedKeywords: best.matchedKeywords,
    matchedPhrase:   best.matchedPhrase,
    originalText:    text,
  });

  res.json({
    success: true,
    matches,
    completedTasks: updated ? [updated] : [],
  });
});

// ── POST /api/meeting-tasks/reset ─────────────────────────────────────────────

router.post('/reset', (_req, res) => {
  const tasks   = resetToSampleData();
  const summary = buildTaskSummary(tasks);
  res.json({ success: true, message: 'Task data reset to sample state', summary });
});

// ── POST /api/meeting-tasks/:taskId/complete ──────────────────────────────────

router.post('/:taskId/complete', (req, res) => {
  const { taskId } = req.params;
  if (!getTask(taskId)) {
    return res.status(404).json({ success: false, error: `Task "${taskId}" not found` });
  }
  const updated = completeTask(taskId, null, null);
  res.json({ success: true, task: updated });
});

// ── POST /api/meeting-tasks/:taskId/reopen ────────────────────────────────────

router.post('/:taskId/reopen', (req, res) => {
  const { taskId } = req.params;
  if (!getTask(taskId)) {
    return res.status(404).json({ success: false, error: `Task "${taskId}" not found` });
  }
  const updated = reopenTask(taskId);
  res.json({ success: true, task: updated });
});

export default router;
