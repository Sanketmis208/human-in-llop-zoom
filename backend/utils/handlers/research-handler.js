import { sendChatMessage, editChatbotMessage, buildTextContent } from '../zoom/zoom-api.js';
import { callAnthropicAPI } from '../ai/anthropic.js';
import { setState, getState } from '../store/state-store.js';
import {
  buildResearchMenuCard,
  buildResearchPendingCard,
  buildResearchResponseCard,
  buildResearchErrorCard,
} from '../cards/research-cards.js';
import { ACTIONS } from '../constants.js';
import { trackEvent, EVENT_TYPES } from '../store/analytics-store.js';

/**
 * Route a research action button click to the appropriate sub-flow.
 * threadId is the replyMainMessageId from the interactive_message_actions event.
 */
export async function handleResearchAction(action, toJid, userJid, threadId = null) {
  try {
    switch (action) {
      case ACTIONS.START_RESEARCH: {
        setState(userJid, { service: 'RESEARCH', step: null, threadId });
        console.log(`Research flow started for user ${userJid}, threadId=${threadId}`);
        await sendChatMessage(toJid, buildResearchMenuCard(), threadId);
        break;
      }

      case ACTIONS.RESEARCH_ASK_QUESTION: {
        const sent = await sendChatMessage(
          toJid,
          buildTextContent('What question would you like to research? Type your question now.'),
          threadId
        );
        // Store both the event thread root and the bot's own prompt message ID.
        // handleResearchQuestion uses whichever is available as the reply target.
        const threadMessageId = sent?.id || sent?.message_id || sent?.messageId || null;
        setState(userJid, { step: 'awaiting_research_question', threadId, threadMessageId });
        break;
      }

      case ACTIONS.RESEARCH_SUMMARIZE_THREAD: {
        await summarizeThread(toJid, threadId);
        break;
      }

      case ACTIONS.RESEARCH_DRAFT_RESPONSE: {
        const sent = await sendChatMessage(
          toJid,
          buildTextContent('Provide the context or thread you would like me to draft a response for.'),
          threadId
        );
        const threadMessageId = sent?.id || sent?.message_id || sent?.messageId || null;
        setState(userJid, { step: 'awaiting_draft_context', threadId, threadMessageId });
        break;
      }

      default:
        console.warn(`handleResearchAction: unhandled action "${action}"`);
        break;
    }
  } catch (error) {
    console.error('handleResearchAction error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), threadId);
  }
}

/**
 * Called when state.step === 'awaiting_research_question'.
 * Threading priority:
 *   1. replyMainMessageId from the current bot_notification (user replied inside a thread)
 *   2. threadId stored in state when the flow started (button was clicked in a thread)
 *   3. threadMessageId — the bot's own "What question?" prompt message ID
 */
export async function handleResearchQuestion(toJid, userJid, question, threadId = null) {
  await runResearchTurn({ toJid, userJid, prompt: question, threadId });
}

/**
 * Called when state.step === 'awaiting_draft_context'.
 * Same threading priority as handleResearchQuestion.
 */
export async function handleDraftContext(toJid, userJid, context, threadId = null) {
  const prompt = `Draft a professional response based on this context: ${context}`;
  await runResearchTurn({ toJid, userJid, prompt, threadId });
}

/**
 * Run one Anthropic round-trip using the simulated-streaming pattern.
 *
 * Zoom Team Chat doesn't support streaming responses, so we approximate it
 * by posting an "Analyzing…" card immediately and editing that same message
 * once Anthropic returns. The user gets visible feedback in ~1 second
 * instead of a silent wait, and only ever sees one message — not a pending
 * card followed by a duplicate final card.
 *
 * Lifecycle:
 *   1. Send pending card; capture its message_id.
 *   2. Call Anthropic with { skipSend: true } so we own the message lifecycle.
 *   3. Edit the pending message with the final response card.
 *   4. On Anthropic failure → edit the pending message with the error card.
 *   5. On edit-API failure → fall back to sending the response/error card
 *      as a new message so the user is never left staring at "Analyzing…".
 */
async function runResearchTurn({ toJid, userJid, prompt, threadId }) {
  const state   = getState(userJid);
  const replyTo = threadId || state.threadId || state.threadMessageId || null;
  let pendingMessageId = null;

  try {
    trackEvent(EVENT_TYPES.RESEARCH_QUESTION_SUBMITTED, userJid);
    console.log(`Research: starting turn for user ${userJid}, replyTo=${replyTo}`);

    // 1. Post the loading card immediately so the user isn't staring at a silent chat.
    const pendingSent = await sendChatMessage(toJid, buildResearchPendingCard(), replyTo);
    pendingMessageId = pendingSent?.id || pendingSent?.message_id || pendingSent?.messageId || null;
    console.log(`Research: sent pending message (id=${pendingMessageId}) for user ${userJid}`);

    // 2. Run the AI call. skipSend tells callAnthropicAPI to return the
    //    completion text instead of posting it to Zoom — we'll deliver it
    //    by editing the pending card.
    const completion = await callAnthropicAPI(
      { toJid, cmd: prompt, reply_to: replyTo },
      { skipSend: true }
    );

    if (!completion) throw new Error('Anthropic returned an empty completion.');
    trackEvent(EVENT_TYPES.RESEARCH_RESPONSE_GENERATED, userJid);

    // 3. Edit the pending message with the final response — or fall back
    //    to a fresh message if the edit API rejects (e.g., message too old).
    const responseCard = buildResearchResponseCard(completion);
    await deliverResponse({ toJid, userJid, replyTo, pendingMessageId, content: responseCard, label: 'response' });

    trackEvent(EVENT_TYPES.TEAM_CHAT_MESSAGE_SENT, userJid);
    setState(userJid, { step: null, threadMessageId: null });
  } catch (error) {
    console.error('runResearchTurn error:', error);

    // 4. Surface the failure by editing the pending message with the error
    //    card, with the same fallback-to-new-message safety net.
    try {
      await deliverResponse({
        toJid, userJid, replyTo, pendingMessageId,
        content: buildResearchErrorCard(),
        label: 'error',
      });
    } catch (deliverErr) {
      console.error('Failed to deliver research error card:', deliverErr);
      // Last-ditch plain-text fallback so the user knows something happened.
      try {
        await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), replyTo);
      } catch { /* nothing more we can do */ }
    }

    setState(userJid, { step: null, threadMessageId: null });
  }
}

/**
 * Edit the pending message with `content`. If we don't have a pending
 * message id (sendChatMessage didn't return one) or the edit API fails,
 * fall back to posting `content` as a new message so the user isn't stuck
 * looking at an outdated card.
 */
async function deliverResponse({ toJid, userJid, replyTo, pendingMessageId, content, label }) {
  if (pendingMessageId) {
    try {
      await editChatbotMessage(pendingMessageId, userJid, content);
      console.log(`Research: edited pending message ${pendingMessageId} with ${label} card`);
      return;
    } catch (editError) {
      console.warn(`Research: edit ${label} failed (${editError.message}); falling back to new message`);
    }
  }
  await sendChatMessage(toJid, content, replyTo);
  console.log(`Research: posted ${label} as a new message (no pending id or edit failed)`);
}

/**
 * Placeholder: thread summarization not yet implemented.
 */
async function summarizeThread(toJid, threadId = null) {
  await sendChatMessage(toJid, buildTextContent('Thread summarization is not yet implemented. Check back soon!'), threadId);
}
