/**
 * Create Task — Team Chat flow that lets a user enter a task manually and
 * have it saved into the same TaskStore the AI workflow uses.
 *
 * State machine (stored on the per-user session via state-store):
 *   awaiting_title       — bot prompted for the task title
 *     ↓ user types title
 *   awaiting_form        — bot showed the details form
 *     ↓ user submits form
 *   awaiting_confirmation — bot showed the summary; user clicks
 *                            Create Task (→ save) / Edit (→ back to form) / Cancel
 *
 * The submit-handler (utils/handlers/submit-handler.js) owns the form
 * submission step; everything else lives here.
 */

import { sendChatMessage, buildTextContent } from '../zoom/zoom-api.js';
import { getState, setState, clearState } from '../store/state-store.js';
import {
  buildCreateTaskIntroCard,
  buildCreateTaskFormCard,
  buildCreateTaskConfirmCard,
  buildTaskCreatedCard,
  FORM_ACTION_IDS,
} from '../cards/create-task-cards.js';
import { ACTIONS } from '../constants.js';
import { trackEvent, EVENT_TYPES } from '../store/analytics-store.js';
import { createManualTask } from '../store/task-store.js';

const VALID_PRIORITIES = ['High', 'Medium', 'Low'];

/**
 * Start the Create Task flow. Stores threadId in state so every subsequent
 * step (including form submission) can thread its responses.
 */
export async function startCreateTaskFlow(toJid, userJid, threadId = null) {
  try {
    setState(userJid, {
      service: 'CREATE_TASK',
      step: 'awaiting_title',
      draft: {},
      threadId,
    });
    trackEvent(EVENT_TYPES.CREATE_TASK_STARTED, userJid);
    await sendChatMessage(toJid, buildCreateTaskIntroCard(), threadId);
    console.log(`CreateTask flow started for user ${userJid}, threadId=${threadId}`);
  } catch (error) {
    console.error('startCreateTaskFlow error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), threadId);
  }
}

/**
 * Handle plain-text input during the Create Task flow (just the title step).
 */
export async function handleCreateTaskText(toJid, userJid, message, threadId = null) {
  const state = getState(userJid);
  const replyTo = threadId || state.threadId || null;

  try {
    switch (state.step) {
      case 'awaiting_title': {
        const title = message.trim();
        if (!title) {
          await sendChatMessage(toJid, buildTextContent('Please enter a task title.'), replyTo);
          return;
        }
        setState(userJid, {
          step: 'awaiting_form',
          draft: { ...(state.draft || {}), title },
        });
        console.log(`CreateTask: stored title="${title}" for user ${userJid}`);
        await sendChatMessage(toJid, buildCreateTaskFormCard(), replyTo);
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error('handleCreateTaskText error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), replyTo);
  }
}

/**
 * Handle button actions during the Create Task flow:
 *   CONFIRM_CREATE_TASK — save the task and send the success card
 *   EDIT_CREATE_TASK    — re-show the form pre-filled with the draft
 *   CANCEL_CREATE_TASK  — clear state and acknowledge
 */
export async function handleCreateTaskAction(actionValue, toJid, userJid, threadId = null) {
  const state = getState(userJid);
  const replyTo = threadId || state.threadId || null;

  try {
    switch (actionValue) {
      case ACTIONS.CONFIRM_CREATE_TASK: {
        const draft = state.draft;
        if (!draft?.title) {
          await sendChatMessage(toJid, buildTextContent("I lost the draft — type 'menu' and try again."), replyTo);
          clearState(userJid);
          return;
        }
        const task = createManualTask({
          title:       draft.title,
          description: draft.description,
          owner:       draft.owner,
          dueDate:     draft.dueDate,
          priority:    draft.priority,
          actor:       `user:${userJid}`,
        });
        clearState(userJid);
        trackEvent(EVENT_TYPES.CREATE_TASK_COMPLETED, userJid, { taskId: task.id });
        console.log(`CreateTask: created task ${task.id} for user ${userJid}`);
        await sendChatMessage(toJid, buildTaskCreatedCard(task), replyTo);
        trackEvent(EVENT_TYPES.TEAM_CHAT_MESSAGE_SENT, userJid);
        break;
      }

      case ACTIONS.EDIT_CREATE_TASK: {
        // Drop back to the form, pre-filled with whatever draft fields exist.
        setState(userJid, { step: 'awaiting_form' });
        await sendChatMessage(toJid, buildCreateTaskFormCard(state.draft || {}), replyTo);
        break;
      }

      case ACTIONS.CANCEL_CREATE_TASK: {
        console.log(`CreateTask: cancelled by user ${userJid}`);
        trackEvent(EVENT_TYPES.CREATE_TASK_CANCELED, userJid);
        clearState(userJid);
        await sendChatMessage(toJid, buildTextContent("No problem — I canceled the task. Type 'menu' anytime."), replyTo);
        break;
      }

      default:
        console.warn(`handleCreateTaskAction: unhandled action "${actionValue}"`);
        break;
    }
  } catch (error) {
    console.error('handleCreateTaskAction error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), replyTo);
  }
}

/**
 * Submit-handler hook. The chat_message.submit event is generic — submit-handler
 * routes here when state.service === 'CREATE_TASK'.
 *
 * @param {string} userJid
 * @param {string} toJid
 * @param {object} fields    — merged submitted + cached form fields
 * @param {string|null} threadId
 */
export async function handleCreateTaskSubmit(userJid, toJid, fields, threadId) {
  const state = getState(userJid);
  const replyTo = threadId || state.threadId || null;

  try {
    // The card emits each field under a generic action_id. Map back to our
    // semantic field names so the rest of the code (task store, dashboards,
    // notifications) stays clean.
    const description = fields[FORM_ACTION_IDS.description] ?? fields.description ?? '';
    const owner       = fields[FORM_ACTION_IDS.owner]       ?? fields.owner       ?? '';
    const dueDate     = fields[FORM_ACTION_IDS.dueDate]     ?? fields.dueDate     ?? '';
    const priority    = fields[FORM_ACTION_IDS.priority]    ?? fields.priority    ?? '';

    const draft = {
      ...(state.draft || {}),
      description: description.trim(),
      owner:       owner.trim() || null,
      dueDate:     normalizeDueDate(dueDate),
      priority:    normalizePriority(priority),
    };

    if (!draft.title) {
      await sendChatMessage(toJid, buildTextContent("I lost the title — type 'menu' and try again."), replyTo);
      clearState(userJid);
      return;
    }

    setState(userJid, { step: 'awaiting_confirmation', draft });
    await sendChatMessage(toJid, buildCreateTaskConfirmCard(draft), replyTo);
  } catch (error) {
    console.error('handleCreateTaskSubmit error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), replyTo);
  }
}

// ── input normalization ─────────────────────────────────────────────────────

/**
 * Accept any case-insensitive match for High/Medium/Low. Default to Medium for
 * blank or unrecognised input so the flow doesn't dead-end on a typo.
 */
function normalizePriority(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 'Medium';
  const match = VALID_PRIORITIES.find(p => p.toLowerCase() === trimmed.toLowerCase());
  return match ?? 'Medium';
}

/**
 * Normalize dueDate to YYYY/MM/DD — the format Zoom's datepicker emits and
 * accepts as `initial_date`. Storing it this way means the Edit flow can
 * pre-fill the picker by handing the stored value back as `initial_date`
 * without any reformatting.
 *
 * Falls back to freeform text if the input isn't a parseable date (e.g.
 * "Next Friday" typed into the form before the datepicker was added). The
 * /tasks page renders whatever's here via .slice(0, 10).
 */
function normalizeDueDate(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return trimmed;
  const yyyy = parsed.getFullYear();
  const mm   = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd   = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}
