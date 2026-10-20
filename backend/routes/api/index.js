/**
 * /api/* — AI task workflow API consumed by the Next.js frontend.
 *
 * Each sub-router is focused on one domain and mounted at the same root
 * (`/api`) by server.js. Same URLs, same payloads as before the split.
 *
 *   dashboard.js     GET    /api/dashboard
 *   meetings.js      GET    /api/meetings, /api/meetings/:id/{context,tasks,task-suggestions,activity,changes}
 *   suggestions.js   POST   /api/task-suggestions/:id/{approve,reject,review}
 *   tasks.js         PATCH  /api/tasks/:taskId, POST /api/tasks/:taskId/complete
 *   ai.js            POST   /api/ai/{analyze-transcript,summarize-meeting,ask}
 *   rtms-live.js     GET    /api/rtms/active, POST /api/rtms/test-stream,
 *                    GET    /api/meetings/:id/transcript-stream (SSE)
 *   team-chat.js     POST   /api/team-chat/digest
 *   zoom-tasks.js    POST   /api/zoom-tasks/sync
 *   ai-actions.js    GET    /api/ai-actions/primary-meeting,
 *                    GET    /api/meetings/:id/ai-actions,
 *                    POST   /api/meetings/:id/ai-actions/{preview,create-doc},
 *                    POST   /api/meetings/:id/follow-up-docs/:docId/shared,
 *                    GET    /api/meetings/:id/follow-up-docs
 */

import express from 'express';
import dashboardRouter   from './dashboard.js';
import meetingsRouter    from './meetings.js';
import suggestionsRouter from './suggestions.js';
import tasksRouter       from './tasks.js';
import aiRouter          from './ai.js';
import rtmsLiveRouter    from './rtms-live.js';
import teamChatRouter    from './team-chat.js';
import zoomTasksRouter   from './zoom-tasks.js';
import aiActionsRouter   from './ai-actions.js';

const router = express.Router();

router.use(dashboardRouter);
router.use(meetingsRouter);
router.use(suggestionsRouter);
router.use(tasksRouter);
router.use(aiRouter);
router.use(rtmsLiveRouter);
router.use(teamChatRouter);
router.use(zoomTasksRouter);
router.use(aiActionsRouter);

export default router;
