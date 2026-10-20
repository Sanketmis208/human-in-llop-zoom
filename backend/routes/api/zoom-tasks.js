/**
 * POST /api/zoom-tasks/sync   body: { meetingId }
 *
 * Pushes every approved-but-unsynced local task for a meeting up to the Zoom
 * Tasks API. Mock-mode by default; set ZOOM_TASKS_API_ENABLED=true to make
 * real REST calls.
 */

import express from 'express';
import { syncMeetingTasks } from '../../utils/zoom/zoom-tasks.js';

const router = express.Router();

router.post('/zoom-tasks/sync', async (req, res) => {
  const { meetingId } = req.body ?? {};
  if (!meetingId) return res.status(400).json({ success: false, error: 'meetingId required' });
  const result = await syncMeetingTasks(meetingId);
  res.json({ success: true, ...result });
});

export default router;
