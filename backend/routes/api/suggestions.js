/**
 * POST /api/task-suggestions/:id/*    — human review of AI-extracted tasks.
 *
 * The AI extractor never mutates state on its own; suggestions arrive in the
 * store as status="pending" and only move forward when a human approves or
 * rejects via these endpoints. Approving optionally pushes to the Zoom Tasks
 * API and posts a threaded Team Chat update.
 *
 * Endpoints:
 *   POST /api/task-suggestions/:id/approve     body: { updates?, syncToZoom?, notify? }
 *   POST /api/task-suggestions/:id/reject      body: { reason?, notify? }
 *   POST /api/task-suggestions/:id/review      AI pre-flight review (no mutation)
 */

import express from 'express';
import taskStore from '../../utils/store/task-store.js';
import { reviewSuggestion } from '../../utils/ai/task-approval-agent.js';
import { createZoomTask } from '../../utils/zoom/zoom-tasks.js';
import { notifySuggestionApproved, notifySuggestionRejected } from '../../utils/handlers/task-event-notifier.js';
import { logger } from '../../utils/logger.js';
import { actorFrom, notFound } from './helpers.js';
import { aiError } from './ai-helpers.js';

const log = logger('api');
const router = express.Router();

router.post('/task-suggestions/:id/approve', async (req, res) => {
  const { updates = {}, syncToZoom = false, notify = true } = req.body ?? {};
  const actor = actorFrom(req);
  const result = taskStore.approveTaskSuggestion(req.params.id, { ...updates, actor });
  if (!result) return notFound(res, 'suggestion');

  let zoomSync = null;
  if (syncToZoom && result.task) {
    try {
      const zoom = await createZoomTask({
        title:       result.task.title,
        description: result.task.description,
        owner:       result.task.owner,
        dueDate:     result.task.dueDate,
        priority:    result.task.priority,
        meetingId:   result.task.meetingInstanceId,
      });
      zoomSync = zoom;
      const zoomTaskId = zoom.zoomTaskId ?? zoom.id ?? zoom.task_id ?? null;
      if (zoomTaskId) result.task.zoomTaskId = zoomTaskId;
    } catch (err) {
      zoomSync = { error: err.message };
    }
  }

  if (notify) {
    notifySuggestionApproved({ meetingId: result.suggestion.meetingId, suggestion: result.suggestion, actor })
      .catch(err => log.error('approve notify failed', { error: err.message }));
  }

  res.json({ success: true, ...result, zoomSync });
});

router.post('/task-suggestions/:id/reject', (req, res) => {
  const actor = actorFrom(req);
  const reason = req.body?.reason;
  const updated = taskStore.rejectTaskSuggestion(req.params.id, { reason, actor });
  if (!updated) return notFound(res, 'suggestion');

  if (req.body?.notify !== false) {
    notifySuggestionRejected({ meetingId: updated.meetingId, suggestion: updated, actor, reason })
      .catch(err => log.error('reject notify failed', { error: err.message }));
  }

  res.json({ success: true, suggestion: updated });
});

router.post('/task-suggestions/:id/review', async (req, res) => {
  const sug = taskStore.getTaskSuggestion(req.params.id);
  if (!sug) return notFound(res, 'suggestion');
  try {
    const review = await reviewSuggestion(sug, {
      openTasks: taskStore.getOpenTasks(sug.meetingId),
    });
    res.json({ success: true, suggestion: sug, review });
  } catch (err) {
    return aiError(res, err, { suggestion: sug });
  }
});

export default router;
