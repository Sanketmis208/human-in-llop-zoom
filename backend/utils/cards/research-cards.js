import { ACTIONS } from '../constants.js';
import { getWebviewUrl } from './menu-cards.js';

export function buildResearchMenuCard() {
  return {
    head: { text: 'Research Assistant', style: { bold: true } },
    body: [
      { type: 'message', text: 'What would you like help with?' },
      {
        type: 'actions',
        items: [
          { text: 'Ask a Question',        value: ACTIONS.RESEARCH_ASK_QUESTION,     style: 'Primary' },
          { text: 'Summarize This Thread', value: ACTIONS.RESEARCH_SUMMARIZE_THREAD, style: 'Default' },
          { text: 'Draft a Response',      value: ACTIONS.RESEARCH_DRAFT_RESPONSE,   style: 'Default' },
        ],
      },
    ],
  };
}

/**
 * Loading-state card the bot posts immediately after the user asks a question,
 * before Anthropic responds. The Research Assistant then edits this same
 * message with the final response when the AI call returns.
 *
 * Zoom Team Chat doesn't support streaming, so this is the closest UX we can
 * give to "the AI is thinking" — visible feedback within ~1 second instead of
 * the user staring at chat wondering if the bot is alive.
 */
export function buildResearchPendingCard() {
  return {
    settings: {},
    body: [
      { type: 'message', text: 'Research Assistant', style: { bold: true } },
      { type: 'message', text: 'Analyzing your question…' },
    ],
  };
}

/**
 * Error card shown when the Anthropic call fails. The handler tries to edit
 * the pending message with this card first; if the edit API itself fails it
 * falls back to sending the card as a new message.
 */
export function buildResearchErrorCard() {
  return {
    settings: {},
    body: [
      { type: 'message', text: 'Research Assistant', style: { bold: true } },
      { type: 'message', text: 'I ran into an issue while generating the research response. Please try again.' },
    ],
  };
}

/**
 * Card that wraps the AI-generated response text.
 * - editable: true lets the user refine the text before sharing.
 * - Thumbs up/down buttons capture feedback without a follow-up prompt.
 */
export function buildResearchResponseCard(responseText) {
  return {
    settings: {},
    body: [
      {
        type: 'message',
        text: 'Research Response',
        style: { bold: true },
      },
      {
        type: 'message',
        text: responseText,
        editable: true,
      },
      {
        type: 'divider',
        style: { bold: false, dotted: false, color: '#98a0a9' },
      },
      {
        type: 'message',
        text: 'Was this response helpful?',
      },
      {
        type: 'actions',
        items: [
          { text: 'Thumbsup',   value: ACTIONS.RESEARCH_FEEDBACK_POSITIVE, style: 'Thumbsup' },
          { text: 'Thumbsdown', value: ACTIONS.RESEARCH_FEEDBACK_NEGATIVE, style: 'Thumbsdown' },
        ],
      },
    ],
  };
}

/**
 * Sent after a positive feedback click — confirms receipt and surfaces the dashboard.
 */
export function buildResearchFeedbackThankYouCard() {
  return {
    settings: {},
    body: [
      {
        type: 'message',
        text: 'Thanks for the feedback!',
        style: { bold: true },
      },
      {
        type: 'message',
        text: 'View engagement analytics in the dashboard.',
      },
      {
        type: 'actions',
        items: [
          {
            type: 'button',
            text: 'Open Dashboard',
            value: ACTIONS.OPEN_DASHBOARD,
            style: 'Primary',
            action: 'dialog',
            dialog: {
              size: 'L',
              title: { text: 'AI Services Dashboard' },
              link: getWebviewUrl(),
            },
          },
        ],
      },
    ],
  };
}

/**
 * Sent after a negative feedback click — acknowledges without surfacing the dashboard.
 */
export function buildResearchFeedbackAcknowledgeCard() {
  return {
    settings: {},
    body: [
      {
        type: 'message',
        text: 'Thanks for the feedback — we will keep improving!',
      },
    ],
  };
}
