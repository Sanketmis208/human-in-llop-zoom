/**
 * Task mutation endpoints — edit and complete real Tasks (post-approval).
 *
 *   PATCH /api/tasks/:taskId            body: { title?, description?, owner?, priority?, dueDate?, status? }
 *   POST  /api/tasks/:taskId/complete   body: { notify? }
 *
 * Both write to the unified TaskStore. Completing also emits a Team Chat
 * threaded notification by default (set notify:false to suppress).
 */

import express from 'express';
import taskStore from '../../utils/store/task-store.js';
import { notifyTaskCompleted } from '../../utils/handlers/task-event-notifier.js';
import { logger } from '../../utils/logger.js';
import { actorFrom, notFound } from './helpers.js';

const log = logger('api');
const router = express.Router();

router.patch('/tasks/:taskId', (req, res) => {
  const updated = taskStore.patchTask(req.params.taskId, { ...req.body, actor: actorFrom(req) });
  if (!updated) return notFound(res, 'task');
  res.json({ success: true, task: updated });
});

router.post('/tasks/:taskId/complete', (req, res) => {
  const actor = actorFrom(req);
  const done = taskStore.markTaskComplete(req.params.taskId, { actor });
  if (!done) return notFound(res, 'task');

  if (req.body?.notify !== false) {
    notifyTaskCompleted({ task: done, actor })
      .catch(err => log.error('complete notify failed', { error: err.message }));
  }

  res.json({ success: true, task: done });
});

export default router;
