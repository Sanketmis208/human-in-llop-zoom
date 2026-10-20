/**
 * GET /api/dashboard — top-of-page counts and recent meetings list.
 * Read-only. Consumed by frontend/app/page.tsx (server component).
 */

import express from 'express';
import taskStore from '../../utils/store/task-store.js';

const router = express.Router();

router.get('/dashboard', (_req, res) => {
  res.json({ success: true, ...taskStore.getDashboardSummary() });
});

export default router;
