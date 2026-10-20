import { getChatbotToken } from './zoom-server-auth.js';

// Override via ZOOM_API_BASE_URL for Zoom for Government (https://api.zoomgov.com/v2)
// or other non-default Zoom API hosts.
const ZOOM_API_BASE_URL = process.env.ZOOM_API_BASE_URL || 'https://api.zoom.us/v2';

/**
 * Build a plain-text message content object for the Zoom chatbot API.
 * @param {string} text
 * @returns {Object}
 */
export function buildTextContent(text) {
  return {
    head: { text: 'Chatbot' },
    body: [{ type: 'message', text }],
  };
}

/**
 * Send a message to a Zoom Team Chat user or channel.
 * @param {string} toJid       - Recipient JID (user or channel)
 * @param {Object} content     - Zoom card content object (head/body or settings/body)
 * @param {string|null} replyTo  - Optional message ID to thread the reply under
 * @param {string|null} userJid  - Acting user JID. Defaults to toJid (correct for DMs).
 *                                 For channel messages, pass the inviting user's JID.
 * @returns {Promise<Object>} Zoom API response (includes message_id)
 */
export async function sendChatMessage(toJid, content, replyTo = null, userJid = null) {
  const accessToken = await getChatbotToken();

  const body = {
    account_id: process.env.ZOOM_ACCOUNT_ID || '',
    content,
    robot_jid: process.env.ZOOM_BOT_JID || '',
    to_jid: toJid,
    user_jid: userJid || toJid,
  };

  // Zoom chatbot API threads replies using "reply_to", not "reply_main_message_id"
  if (replyTo) body.reply_to = replyTo;

  console.log('Sending message to Zoom Team Chat:', JSON.stringify(body, null, 2));

  const response = await fetch(`${ZOOM_API_BASE_URL}/im/chat/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to send message: ${error.message || response.statusText}`);
  }

  return response.json();
}

/**
 * Edit an existing Zoom chatbot message in place.
 *
 * Used by the Research Assistant's "simulated streaming" pattern: the bot
 * posts an "Analyzing…" message immediately, then edits that same message
 * with the final response when the AI call returns. Zoom Team Chat doesn't
 * support real streaming responses, so this is the next-best UX.
 *
 * Endpoint: PUT /v2/im/chat/messages/:message_id
 *
 * @param {string} messageId - Zoom message ID returned from sendChatMessage
 * @param {string} userJid   - Acting user JID (the conversation owner)
 * @param {Object} content   - Updated Zoom card content object (head/body or settings/body)
 * @returns {Promise<Object>}
 */
export async function editChatbotMessage(messageId, userJid, content) {
  const accessToken = await getChatbotToken();

  const body = {
    robot_jid:  process.env.ZOOM_BOT_JID || '',
    account_id: process.env.ZOOM_ACCOUNT_ID || '',
    user_jid:   userJid,
    is_markdown_support: false,
    content,
  };

  const response = await fetch(`${ZOOM_API_BASE_URL}/im/chat/messages/${messageId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to edit message ${messageId}: ${error.message || response.statusText}`);
  }

  // Zoom returns an empty body on success — handle that.
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

