/**
 * AI Actions API — Observe → Recommend → Approve → Execute.
 *
 * The AI never mutates state from these endpoints. The flow is:
 *
 *   GET    /api/meetings/:id/ai-actions          surface what's recommended
 *   POST   /api/meetings/:id/ai-actions/preview  generate Markdown for review
 *   POST   /api/meetings/:id/ai-actions/create-doc  user approves → Zoom MCP creates a Doc
 *   POST   /api/meetings/:id/follow-up-docs/:docId/shared
 *                                                user shared the doc to chat (record only)
 *   GET    /api/meetings/:id/follow-up-docs      list docs created so far
 *
 * `create-doc` is the only endpoint that calls Zoom MCP. It needs a user
 * OAuth session (the bearer token comes from req.session.zoomTokens).
 */

import express from 'express';
import { unwrapMeetingId } from '../../utils/http-helpers.js';
import { logger } from '../../utils/logger.js';
import {
  evaluateFollowUpRecommendation,
  buildObservationsBanner,
  findPrimaryActionableMeeting,
} from '../../utils/ai/follow-up-recommender.js';
import { generateFollowUpDocMarkdown } from '../../utils/ai/follow-up-doc-generator.js';
import { createZoomDocFromMarkdown } from '../../utils/zoom/zoom-mcp-docs.js';
import {
  recordCreatedDoc,
  listDocsForMeeting,
  markSharedToChat,
} from '../../utils/store/follow-up-docs-store.js';
import taskStore from '../../utils/store/task-store.js';
import { notFound } from './helpers.js';

const log    = logger('ai-actions');
const router = express.Router();

// ── GET /api/ai-actions/primary-meeting ──────────────────────────────────────
// Default meeting selection for the AI Actions tab on the Dashboard.
router.get('/ai-actions/primary-meeting', (_req, res) => {
  const meetingId = findPrimaryActionableMeeting();
  res.json({ success: true, meetingId });
});

// ── GET /api/meetings/:id/ai-actions ────────────────────────────────────────

router.get('/meetings/:meetingId/ai-actions', (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  const meeting   = taskStore.getMeetingContext(meetingId);
  if (!meeting) return notFound(res, 'meeting');

  const evaluation = evaluateFollowUpRecommendation(meetingId);
  const observations = buildObservationsBanner(evaluation.signals);

  const suggestedActions = [];
  if (evaluation.shouldSuggestDoc) {
    suggestedActions.push({
      id:        'create-follow-up-doc',
      title:     'Create Meeting Follow-up Doc',
      reasons:   evaluation.reasons,
      signals:   evaluation.signals,
      cta:       'Preview Document',
    });
  }

  res.json({
    success: true,
    meetingId,
    meetingTitle: meeting.title,
    observations,
    signals: evaluation.signals,
    suggestedActions,
  });
});

// ── POST /api/meetings/:id/ai-actions/preview ───────────────────────────────

router.post('/meetings/:meetingId/ai-actions/preview', async (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  const meeting   = taskStore.getMeetingContext(meetingId);
  if (!meeting) return notFound(res, 'meeting');

  const { actionId } = req.body ?? {};
  if (actionId !== 'create-follow-up-doc') {
    return res.status(400).json({ success: false, error: `Unknown action: ${actionId}` });
  }

  const { markdown, usedAI, error } = await generateFollowUpDocMarkdown(meetingId);
  res.json({ success: true, meetingId, markdown, usedAI, ...(error ? { warning: error } : {}) });
});

// ── POST /api/meetings/:id/ai-actions/create-doc ────────────────────────────
// User has approved the preview. Call Zoom MCP to create the actual Zoom Doc.

router.post('/meetings/:meetingId/ai-actions/create-doc', async (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  const meeting   = taskStore.getMeetingContext(meetingId);
  if (!meeting) return notFound(res, 'meeting');

  const { markdown, title } = req.body ?? {};
  if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
    return res.status(400).json({
      success: false,
      error: 'markdown is required. Call /ai-actions/preview first.',
    });
  }

  // The user OAuth token comes from the session populated by /auth/callback.
  // If absent the user must sign in before creating a Doc.
  const userAccessToken = req.session?.zoomTokens?.access_token ?? null;
  if (!userAccessToken) {
    return res.status(401).json({
      success: false,
      authRequired: true,
      authStartUrl: '/auth/login',
      error: 'You need to sign in with Zoom before creating a Doc. Visit /auth/login to authenticate (requires docs:write:import scope on your app).',
    });
  }

  const docTitle = (title && title.trim()) || `${meeting.title || 'Meeting'} — Follow-up`;

  const result = await createZoomDocFromMarkdown({
    userAccessToken,
    content: markdown,
    fileName: docTitle,
  });

  if (!result.ok) {
    log.warn('Zoom MCP create failed', { meeting: meetingId, error: result.error });
    return res.status(result.status ?? 502).json({
      success: false,
      error: result.error,
      raw: result.raw ?? null,
    });
  }

  const record = recordCreatedDoc(meetingId, {
    title:    result.title ?? docTitle,
    fileId:   result.fileId,
    fileLink: result.fileLink,
    actor:    req.headers['x-user-id'] ?? 'user',
  });

  res.json({ success: true, doc: record });
});

// ── POST /api/meetings/:id/follow-up-docs/:docId/shared ─────────────────────
// Frontend calls this after the user shares the doc to chat via the Apps SDK.
// We don't actually post the message from the backend — Apps SDK does that
// client-side. This endpoint just records the intent for the activity log.

router.post('/meetings/:meetingId/follow-up-docs/:docId/shared', (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  const docId = req.params.docId;
  const updated = markSharedToChat(meetingId, docId);
  if (!updated) return notFound(res, 'doc');
  taskStore.logActivity({
    type: 'follow_up_doc.shared',
    meetingId,
    actor: req.headers['x-user-id'] ?? 'user',
    payload: { docId, fileLink: updated.fileLink },
  });
  res.json({ success: true, doc: updated });
});

// ── GET /api/meetings/:id/follow-up-docs ────────────────────────────────────

router.get('/meetings/:meetingId/follow-up-docs', (req, res) => {
  const meetingId = unwrapMeetingId(req.params.meetingId);
  res.json({ success: true, meetingId, docs: listDocsForMeeting(meetingId) });
});

export default router;
