import express from 'express';
import { verifyZoomWebhookSignature, validateWebhookPayload, createValidationMiddleware, buildUrlValidationResponse } from '../utils/validation.js';
import { sendChatMessage } from '../utils/zoom/zoom-api.js';
import { buildServiceMenuCard, buildChannelWelcomeCard } from '../utils/cards/menu-cards.js';
import { handleChatMessageSubmit }   from '../utils/handlers/submit-handler.js';
import { handleBotAction, handleTextMessage } from '../utils/handlers/action-router.js';
import { startRtmsSession, stopRtmsSession } from '../utils/rtms/rtms-service.js';
import { logger } from '../utils/logger.js';

const log = logger('webhook');
const router = express.Router();

/**
 * Handles Zoom Team Chat webhook events
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleZoomWebhook(req, res) {
  let matchedSecret;
  try {
    // Verify webhook signature first. The returned secret is the one Zoom
    // signed this request with — pass it to buildUrlValidationResponse so the
    // handshake reply uses the matching secret.
    matchedSecret = verifyZoomWebhookSignature(req);
  } catch (error) {
    log.error('signature verification failed', { error: error.message });
    if (error.message.includes('signature') || error.message.includes('Missing signature headers')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid webhook signature',
      });
    }
    return res.status(400).json({
      success: false,
      error: 'Bad Request',
      message: process.env.NODE_ENV === 'production' ? 'Webhook rejected' : error.message,
    });
  }

  const { event, payload } = req.body;
  log.info('event', { type: event });

  // URL validation must respond synchronously — Zoom uses the response body to
  // confirm the endpoint. Every other event ACKs 200 immediately and runs the
  // handler in the background so Anthropic/OpenAI/Team Chat calls don't burn
  // through Zoom's 3-second timeout and trigger retries in production.
  if (event === 'endpoint.url_validation') {
    log.info('url_validation handshake');
    return res.status(200).json(buildUrlValidationResponse(payload?.plainToken, matchedSecret));
  }

  // ACK first; dispatch after. Errors inside dispatchEvent are logged but
  // never reach the client because the response is already on the wire.
  res.status(200).json({ success: true, message: 'Event accepted', event });

  dispatchEvent(event, payload).catch((error) => {
    log.error('async handler error', { event, error: error.message });
  });
}

/**
 * Run Team Chat / RTMS / AI handlers in the background after the webhook ACK.
 * Mirrors the RTMS .catch() pattern: kick off the work, log failures, never throw.
 */
async function dispatchEvent(event, payload) {
  const toJid   = payload?.toJid;
  const message = payload?.cmd || payload?.message || '';
  const userId  = payload?.userJid;

  switch (event) {
    case 'bot_installed':
      log.info('bot installed');
      await sendChatMessage(toJid, buildServiceMenuCard());
      break;

    case 'bot_notification': {
      // replyMainMessageId is the thread root — only present when the user is inside a thread.
      // messageId is the user's own message and is NOT a valid thread root to reply under.
      const threadId = payload?.replyMainMessageId || null;
      log.info('bot_notification', { userMessage: payload?.messageId, threadRoot: threadId });
      await handleTextMessage(toJid, userId, message, threadId);
      break;
    }

    case 'interactive_message_actions': {
      const threadId = payload?.replyMainMessageId || null;
      log.info('interactive_message_actions', { threadRoot: threadId });
      await handleBotAction(payload?.actionItem?.value || '', toJid, userId, payload, threadId);
      break;
    }

    case 'chat_message.submit': {
      log.info('chat_message.submit');
      // For submit events, user_jid lives inside payload.object
      await handleChatMessageSubmit(payload);
      break;
    }

    case 'team_chat.app_invited': {
      const channelJid  = payload?.object?.to_jid;
      const channelName = payload?.object?.channel_name || 'this channel';
      const inviterJid  = payload?.object?.user_jid;
      log.info('app invited to channel', { channel: channelName, channelJid, inviter: inviterJid });
      await sendChatMessage(channelJid, buildChannelWelcomeCard(channelName), null, inviterJid);
      break;
    }

    // Real Zoom RTMS payloads nest the fields one level deeper:
    //   payload.object.{meeting_uuid, rtms_stream_id, server_urls, ...}
    // We accept either shape so unit/synthetic tests with a flat payload also work.
    // Per the Zoom RTMS webhook reference,
    // webinar payloads use the same field names — including meeting_uuid, NOT
    // webinar_uuid — so the meeting/webinar branches share extraction logic.
    case 'meeting.rtms_started':
    case 'webinar.rtms_started': {
      const o = payload?.object ?? payload ?? {};
      const meetingId = o.meeting_uuid ?? o.webinar_uuid ?? o.session_id;
      const { rtms_stream_id, server_urls } = o;
      if (meetingId && rtms_stream_id && server_urls) {
        startRtmsSession(meetingId, rtms_stream_id, server_urls).catch(err =>
          log.error('startRtmsSession error', { error: err.message })
        );
      } else {
        log.warn(`${event} missing required fields`, { payload: o });
      }
      break;
    }

    case 'meeting.rtms_stopped':
    case 'webinar.rtms_stopped': {
      const o = payload?.object ?? payload ?? {};
      const meetingId = o.meeting_uuid ?? o.webinar_uuid ?? o.session_id;
      if (meetingId) stopRtmsSession(meetingId);
      else log.warn(`${event} missing meeting id`, { payload: o });
      break;
    }

    case 'app_deauthorized':
      log.info('bot uninstalled');
      break;

    default:
      log.info('unsupported event type', { type: event });
      break;
  }
}

// Webhook route with validation
router.post('/', createValidationMiddleware(validateWebhookPayload), handleZoomWebhook);

// Health check endpoint
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'zoom-webhook-handler',
  });
});

export default router;
