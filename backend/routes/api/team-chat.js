/**
 * POST /api/team-chat/digest   body: { meetingId?, limit? }
 *
 * Pushes a "open tasks heading into the next meeting" digest into the
 * configured ZOOM_TASK_NOTIFICATIONS_JID channel. Designed to be triggered by
 * a slash command or scheduled job.
 */

import express from 'express';
import { notifyOpenTasksDigest } from '../../utils/handlers/task-event-notifier.js';

const router = express.Router();

router.post('/team-chat/digest', async (req, res) => {
  const { meetingId, limit } = req.body ?? {};
  const result = await notifyOpenTasksDigest({ meetingId, limit });
  res.json({ success: true, posted: !!result });
});

export default router;
