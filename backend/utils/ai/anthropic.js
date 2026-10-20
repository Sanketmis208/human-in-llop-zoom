import { sendChatMessage, buildTextContent } from '../zoom/zoom-api.js';
import { buildResearchResponseCard } from '../cards/research-cards.js';

// In-memory conversation history per user. Replace with a database for persistence.
const conversationHistory = new Map();

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

function buildRequestHeaders() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY in environment variables.');
  if (!apiKey.startsWith('sk-ant-')) throw new Error('Invalid ANTHROPIC_API_KEY format. Should start with "sk-ant-".');

  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };
}

function buildRequestBody({ model, messages, stream }) {
  return {
    model,
    max_tokens: 1000,
    temperature: 0.7,
    system: 'You are a helpful AI assistant integrated with Zoom Team Chat. Provide concise, helpful responses. Write in plain text only — do not use markdown formatting such as **bold**, *italic*, ## headers, or bullet dashes.',
    messages,
    stream,
  };
}

/**
 * Send a message to the Anthropic model and (by default) deliver the response back to
 * Zoom Team Chat. Maintains per-user conversation history for multi-turn
 * exchanges.
 *
 * When called with `{ skipSend: true }`, the function returns the completion
 * text and does NOT send a Zoom message. The caller owns the message
 * lifecycle — used by the Research Assistant to edit a pre-posted
 * "Analyzing…" message in place instead of dropping a second message into
 * the conversation.
 *
 * On API failure: if skipSend is true, the error is re-thrown so the caller
 * can decide how to surface it (typically by editing the pending message
 * with an error card). If skipSend is false, the legacy behaviour stands —
 * the function posts a generic error message to Zoom.
 *
 * @param {Object} payload - { toJid, cmd, reply_to }
 * @param {Object} options - { stream?: boolean, onStreamChunk?: fn, skipSend?: boolean }
 * @returns {Promise<string|undefined>} The Anthropic completion text, or undefined on swallowed error.
 */
export async function callAnthropicAPI(payload, options = {}) {
  const toJid = payload?.toJid;
  if (!toJid) {
    console.error('callAnthropicAPI: payload.toJid is missing.');
    return;
  }

  const { stream = true, onStreamChunk = null, skipSend = false } = options;

  try {
    const headers = buildRequestHeaders();

    const history = conversationHistory.get(toJid) || [];
    history.push({ role: 'user', content: payload.cmd || payload.message || 'Hello' });

    const requestBody = buildRequestBody({ model: DEFAULT_MODEL, messages: history, stream });

    console.log(`Sending message to Anthropic (model=${DEFAULT_MODEL}, stream=${stream}, skipSend=${skipSend}) for destination: ${toJid}`);

    const completion = stream
      ? await handleStreamingResponse(requestBody, headers, toJid, payload, onStreamChunk, skipSend)
      : await handleNonStreamingResponse(requestBody, headers, toJid, payload, skipSend);

    return completion;
  } catch (error) {
    console.error('callAnthropicAPI error:', error?.message || error);

    const status = error?.status ?? error?.response?.status;
    if (status === 401) console.error('Anthropic: Authentication failed. Check ANTHROPIC_API_KEY.');
    if (status === 429) console.error('Anthropic: Rate limit exceeded.');
    if (status === 400) console.error('Anthropic: Bad request — check model/params.');
    if (status === 404) console.error('Anthropic: Model not found for your account/region.');

    // skipSend means the caller is managing the message lifecycle (e.g.,
    // editing a pending card with an error). Re-throw so they can react.
    if (skipSend) throw error;

    try {
      await sendChatMessage(
        toJid,
        buildTextContent('Sorry, I hit an AI model error. I will be back shortly. (Check model access/config.)'),
        payload?.reply_to || null
      );
    } catch (sendError) {
      console.error('Failed to send error message to Zoom:', sendError?.message || sendError);
    }
  }
}

/**
 * Non-streaming request to Anthropic. Sends the full reply to Zoom in one
 * message unless `skipSend` is true (caller will deliver the text itself).
 */
async function handleNonStreamingResponse(requestBody, headers, toJid, payload, skipSend = false) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...requestBody, stream: false }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(async () => ({ message: await response.text() }));
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
    error.status = response.status;
    error.response = { data: errorData };
    throw error;
  }

  const data = await response.json();

  if (!data?.content || !Array.isArray(data.content)) {
    throw new Error(`Unexpected Anthropic response shape: ${JSON.stringify(data)}`);
  }

  const completion = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  if (!completion) throw new Error('Empty response from Anthropic API');

  const history = conversationHistory.get(toJid) || [];
  history.push({ role: 'assistant', content: completion });
  conversationHistory.set(toJid, history.length > 20 ? history.slice(-20) : history);

  if (!skipSend) {
    await sendChatMessage(toJid, buildResearchResponseCard(completion), payload.reply_to || null);
    console.log('Successfully sent Anthropic response to Zoom Team Chat');
  }

  return completion;
}

/**
 * Streaming request to Anthropic using Server-Sent Events (SSE).
 * Accumulates the full response, then sends it to Zoom as one message
 * (unless `skipSend` is true — caller will deliver the text itself).
 */
async function handleStreamingResponse(requestBody, headers, toJid, payload, onStreamChunk, skipSend = false) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { ...headers, Accept: 'text/event-stream' },
    body: JSON.stringify({ ...requestBody, stream: true }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(async () => ({ message: await response.text() }));
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
    error.status = response.status;
    error.response = { data: errorData };
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completion = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines (\n\n)
      let separatorIndex;
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        let dataLine = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) dataLine += line.slice(5).trim();
        }

        if (!dataLine || dataLine === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataLine);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            const chunk = parsed.delta.text || '';
            if (chunk) {
              completion += chunk;
              onStreamChunk?.(chunk, completion);
            }
          }
        } catch {
          // Ignore malformed SSE frames
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  if (!completion.trim()) throw new Error('Empty response from Anthropic streaming API');

  const history = conversationHistory.get(toJid) || [];
  history.push({ role: 'assistant', content: completion });
  conversationHistory.set(toJid, history.length > 20 ? history.slice(-20) : history);

  if (!skipSend) {
    await sendChatMessage(toJid, buildResearchResponseCard(completion), payload.reply_to || null);
    console.log('Successfully sent streaming Anthropic response to Zoom Team Chat');
  }

  return completion;
}

