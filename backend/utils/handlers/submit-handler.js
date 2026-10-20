import { sendChatMessage, buildTextContent } from '../zoom/zoom-api.js';
import { getState } from '../store/state-store.js';
import { handleCreateTaskSubmit } from './create-task-handler.js';

/**
 * Normalize submit_items from a chat_message.submit payload into a flat
 * { action_id: value } map. Handles several shapes Zoom may use.
 * @param {Array} submitItems
 * @returns {{ [action_id: string]: string }}
 */
function normalizeSubmitItems(submitItems = []) {
  return submitItems.reduce((acc, item) => {
    // Zoom wraps each submitted field in a type key. We handle every type
    // the bot's cards use today; unknown types fall through to the generic
    // shape-detection below.

    // { plain_text_input: { action_id, value, text } }
    if (item.plain_text_input) {
      const { action_id, value } = item.plain_text_input;
      if (action_id) acc[action_id] = value ?? '';
      return acc;
    }

    // { datepicker: { action_id, selected_date } }
    if (item.datepicker) {
      const { action_id, selected_date, value } = item.datepicker;
      if (action_id) acc[action_id] = selected_date ?? value ?? '';
      return acc;
    }

    // { select: { action_id, selected_option: { value } } } — for future flows
    if (item.select) {
      const s = item.select;
      const v = s.selected_option?.value ?? s.selected_value ?? s.value ?? '';
      if (s.action_id) acc[s.action_id] = v;
      return acc;
    }

    // Button item — no field value, skip
    if (item.actionItem) return acc;

    // Fallback: flat { action_id, value } shape
    const actionId =
      item.action_id ||
      item.actionId  ||
      item.id        ||
      item.name;

    const value =
      item.value                   ??
      item.text                    ??
      item.selected_date           ??
      item?.input?.value           ??
      item?.selected_option?.value ??
      item?.selected_value;

    if (actionId && value !== undefined) acc[actionId] = value;
    return acc;
  }, {});
}

/**
 * Handle chat_message.submit events fired when the user clicks a Submit button
 * on a card form (`settings.form: true`, `submit: true` on the action item).
 *
 * Dispatches to the active flow based on the user's session state. Today the
 * only flow with a form is Create Task; adding more is a matter of another
 * case below.
 *
 * @param {Object} payload - raw Zoom webhook payload (req.body.payload)
 */
export async function handleChatMessageSubmit(payload) {
  const object  = payload?.object;
  const userJid = object?.user_jid;
  const toJid   = object?.to_jid;

  try {
    const fields  = normalizeSubmitItems(object?.submit_items || []);
    const state   = getState(userJid);
    const threadId = state.threadId || null;

    switch (state.service) {
      case 'CREATE_TASK':
        await handleCreateTaskSubmit(userJid, toJid, fields, threadId);
        break;

      default:
        console.warn(`handleChatMessageSubmit: no active flow for user ${userJid} (service=${state.service})`);
        await sendChatMessage(toJid, buildTextContent("I lost track of this form — type 'menu' to start again."), threadId);
        break;
    }
  } catch (error) {
    console.error('handleChatMessageSubmit error:', error);
    const threadId = getState(userJid)?.threadId || null;
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), threadId);
  }
}
