import { ACTIONS, MENU_TRIGGERS, CANCEL_TRIGGERS } from '../constants.js';
import { getState, clearState } from '../store/state-store.js';
import { sendChatMessage, buildTextContent } from '../zoom/zoom-api.js';
import { buildServiceMenuCard } from '../cards/menu-cards.js';
import {
  buildResearchFeedbackThankYouCard,
  buildResearchFeedbackAcknowledgeCard,
} from '../cards/research-cards.js';
import * as ResearchHandler from './research-handler.js';
import * as CreateTaskHandler from './create-task-handler.js';
import { trackEvent, EVENT_TYPES } from '../store/analytics-store.js';

/**
 * Central dispatcher for interactive_message_actions button clicks.
 * threadId is the replyMainMessageId from the webhook — present when the button
 * was clicked inside an existing thread.
 */
export async function handleBotAction(actionValue, toJid, userJid, payload, threadId = null) {
  console.log(`handleBotAction: action="${actionValue}" user=${userJid} threadId=${threadId}`);

  try {
    switch (actionValue) {
      case ACTIONS.OPEN_MENU:
        await sendChatMessage(toJid, buildServiceMenuCard(), threadId);
        break;

      // OPEN_DASHBOARD opens an in-client modal via the "dialog" action type.
      // Zoom handles the modal client-side and may or may not fire a webhook —
      // this case is here as a no-op so it doesn't fall through to the warning.
      case ACTIONS.OPEN_DASHBOARD:
        trackEvent(EVENT_TYPES.DASHBOARD_OPENED, userJid);
        break;

      case ACTIONS.START_RESEARCH:
        trackEvent(EVENT_TYPES.SERVICE_SELECTED, userJid, { service: 'RESEARCH' });
        await ResearchHandler.handleResearchAction(ACTIONS.START_RESEARCH, toJid, userJid, threadId);
        break;

      case ACTIONS.RESEARCH_ASK_QUESTION:
        await ResearchHandler.handleResearchAction(ACTIONS.RESEARCH_ASK_QUESTION, toJid, userJid, threadId);
        break;

      case ACTIONS.RESEARCH_SUMMARIZE_THREAD:
        await ResearchHandler.handleResearchAction(ACTIONS.RESEARCH_SUMMARIZE_THREAD, toJid, userJid, threadId);
        break;

      case ACTIONS.RESEARCH_DRAFT_RESPONSE:
        await ResearchHandler.handleResearchAction(ACTIONS.RESEARCH_DRAFT_RESPONSE, toJid, userJid, threadId);
        break;

      case ACTIONS.START_CREATE_TASK:
        trackEvent(EVENT_TYPES.SERVICE_SELECTED, userJid, { service: 'CREATE_TASK' });
        await CreateTaskHandler.startCreateTaskFlow(toJid, userJid, threadId);
        break;

      case ACTIONS.CONFIRM_CREATE_TASK:
      case ACTIONS.EDIT_CREATE_TASK:
      case ACTIONS.CANCEL_CREATE_TASK:
        await CreateTaskHandler.handleCreateTaskAction(actionValue, toJid, userJid, threadId);
        break;

      case ACTIONS.RESEARCH_FEEDBACK_POSITIVE:
        trackEvent(EVENT_TYPES.RESEARCH_FEEDBACK_POSITIVE, userJid);
        await sendChatMessage(toJid, buildResearchFeedbackThankYouCard(), threadId);
        break;

      case ACTIONS.RESEARCH_FEEDBACK_NEGATIVE:
        trackEvent(EVENT_TYPES.RESEARCH_FEEDBACK_NEGATIVE, userJid);
        await sendChatMessage(toJid, buildResearchFeedbackAcknowledgeCard(), threadId);
        break;

      default:
        console.warn(`handleBotAction: unrecognized action "${actionValue}"`);
        await sendChatMessage(toJid, buildTextContent("I didn't recognize that action. Type 'menu' to see available services."), threadId);
        break;
    }
  } catch (error) {
    console.error('handleBotAction error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), threadId);
  }
}

/**
 * Called from bot_notification. Routes menu triggers and flow-state text messages.
 * threadId is replyMainMessageId from the webhook — present when the user's message
 * was sent inside an existing thread.
 */
export async function handleTextMessage(toJid, userJid, message, threadId = null) {
  const lower = message.toLowerCase().trim();
  console.log(`handleTextMessage: user=${userJid} step=${getState(userJid).step} message="${lower}" threadId=${threadId}`);

  try {
    // Cancel triggers stop any active flow and confirm — no menu redirect
    if (CANCEL_TRIGGERS.includes(lower)) {
      clearState(userJid);
      await sendChatMessage(toJid, buildTextContent("Got it — I've stopped. Type 'menu' whenever you're ready."), threadId);
      return;
    }

    // Menu triggers show the main service menu
    if (MENU_TRIGGERS.includes(lower)) {
      await sendChatMessage(toJid, buildServiceMenuCard(), threadId);
      return;
    }

    // Route based on current flow step
    const state = getState(userJid);

    // For mid-flow steps, prefer the threadId from the current event.
    // Fall back to the threadId stored when the flow was started (covers cases
    // where the user replies from outside the original thread context).
    const replyTo = threadId || state.threadId || null;

    switch (state.step) {
      case 'awaiting_research_question':
        await ResearchHandler.handleResearchQuestion(toJid, userJid, message, replyTo);
        break;

      case 'awaiting_draft_context':
        await ResearchHandler.handleDraftContext(toJid, userJid, message, replyTo);
        break;

      case 'awaiting_title':
        await CreateTaskHandler.handleCreateTaskText(toJid, userJid, message, replyTo);
        break;

      default:
        await sendChatMessage(toJid, buildTextContent("Type 'menu' to see available services."), threadId);
        break;
    }
  } catch (error) {
    console.error('handleTextMessage error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), threadId);
  }
}
