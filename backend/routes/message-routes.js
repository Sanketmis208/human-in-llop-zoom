import express from 'express';
import { sendChatMessage, buildTextContent } from '../utils/zoom/zoom-api.js';
import { validateMessagePayload, createValidationMiddleware, sanitizeMessage } from '../utils/validation.js';
import { getAnalytics } from '../utils/store/analytics-store.js';

const router = express.Router();

/**
 * POST /api/message
 * Sends a plain-text message to a Zoom Team Chat channel or user.
 * Include `reply_to` in the body to post as a threaded reply.
 */
router.post('/message', createValidationMiddleware(validateMessagePayload), async (req, res) => {
  try {
    const { to_jid, message, reply_to } = req.body;

    const sanitizedMessage = sanitizeMessage(message);
    const result = await sendChatMessage(to_jid, buildTextContent(sanitizedMessage), reply_to || null);

    console.log('Message sent successfully:', result);
    return res.status(200).json({ success: true, message: 'Message sent successfully!', data: result });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
    });
  }
});

/**
 * GET /api/analytics
 * Returns dashboard metrics and recent activity for the last 7 days.
 */
router.get('/analytics', (_req, res) => {
  res.json(getAnalytics());
});

export default router;
