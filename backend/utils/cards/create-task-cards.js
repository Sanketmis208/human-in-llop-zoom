/**
 * Cards for the "Create Task" Team Chat flow.
 *
 * Lifecycle (mirrors the legacy Employee Appreciation flow's structure so
 * existing form / submit / threading plumbing keeps working):
 *
 *   buildCreateTaskIntroCard()    — sent first; asks for Task Title
 *   buildCreateTaskFormCard()     — form with description, owner, due date, priority
 *   buildCreateTaskConfirmCard()  — summary with Create / Edit / Cancel buttons
 *   buildTaskCreatedCard()        — final "Task Created" confirmation
 */

import { ACTIONS } from '../constants.js';
import { getWebviewUrl } from './menu-cards.js';

// ── Step 1: prompt for the title ────────────────────────────────────────────

export function buildCreateTaskIntroCard() {
  return {
    head: { text: 'Create Task', style: { bold: true } },
    body: [
      {
        type: 'message',
        text: 'What should the task be? Enter a short, action-oriented title.',
      },
      {
        type: 'message',
        text: 'Example: Follow up with engineering about RTMS retry issue',
        style: { italic: true },
      },
    ],
  };
}

// ── Step 2: form card for the remaining fields ──────────────────────────────

// action_ids the form card emits. The submit handler maps these back to the
// internal field names (description, owner, dueDate, priority).
export const FORM_ACTION_IDS = {
  description: 'multiline_plain_text_input_action',
  owner:       'owner_plain_text_input_action',
  dueDate:     'datepicker_action',
  priority:    'plain_text_input_action',
};

/**
 * @param {object} [defaults] - pre-fill values when the user clicks Edit
 *   defaults.description, defaults.owner, defaults.dueDate, defaults.priority
 */
export function buildCreateTaskFormCard(defaults = {}) {
  return {
    settings: { form: true },
    head: { text: 'Task Details', style: { bold: true } },
    body: [
      {
        type: 'message',
        text: 'Complete the task details below',
        style: { bold: true },
      },
      {
        type: 'plain_text_input',
        text: 'Description',
        action_id: FORM_ACTION_IDS.description,
        value: defaults.description ?? '',
        placeholder: 'What needs to happen and why?',
        multiline: true,
        min_length: 0,
        max_length: 2000,
      },
      {
        type: 'plain_text_input',
        text: 'Owner',
        action_id: FORM_ACTION_IDS.owner,
        value: defaults.owner ?? '',
        placeholder: 'Person responsible (name or email)',
        multiline: false,
        min_length: 0,
        max_length: 200,
      },
      {
        type: 'message',
        text: 'Due date',
      },
      {
        type: 'datepicker',
        action_id: FORM_ACTION_IDS.dueDate,
        initial_date: defaults.dueDate || defaultDueDate(),
      },
      {
        type: 'plain_text_input',
        text: 'Priority',
        action_id: FORM_ACTION_IDS.priority,
        value: defaults.priority ?? 'Medium',
        placeholder: 'High, Medium, or Low',
        multiline: false,
        min_length: 0,
        max_length: 500,
      },
      {
        type: 'actions',
        items: [
          { text: 'Review', value: ACTIONS.SUBMIT_CREATE_TASK, style: 'Primary', submit: true },
          { text: 'Cancel', value: ACTIONS.CANCEL_CREATE_TASK, style: 'Danger' },
        ],
      },
      {
        type: 'message',
        text: 'Type "cancel" to stop at any time.',
      },
    ],
  };
}

/**
 * Default to one week from today (YYYY/MM/DD — the format Zoom's datepicker
 * accepts and emits in our example payloads). Computed on every card render so
 * the suggestion stays fresh.
 */
function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

// ── Step 3: confirmation summary with Create / Edit / Cancel ────────────────

/**
 * @param {object} draft - { title, description, owner, dueDate, priority }
 */
export function buildCreateTaskConfirmCard(draft) {
  const owner    = draft.owner    || 'Unassigned';
  const dueDate  = draft.dueDate  || 'Not set';
  const priority = draft.priority || 'Medium';

  return {
    settings: {},
    body: [
      { type: 'message', text: 'Task Summary',     style: { bold: true } },
      { type: 'divider', style: { bold: false, dotted: false, color: '#98a0a9' } },

      { type: 'message', text: 'Title',            style: { bold: true } },
      { type: 'message', text: draft.title, is_markdown_support: true },

      { type: 'message', text: 'Description',      style: { bold: true } },
      { type: 'message', text: draft.description || '(none)' },

      { type: 'message', text: 'Owner',            style: { bold: true } },
      { type: 'message', is_markdown_support: true, text: `<color:#0E71EB|${owner}>` },

      { type: 'message', text: 'Due Date',         style: { bold: true } },
      { type: 'message', text: dueDate },

      { type: 'message', text: 'Priority',         style: { bold: true } },
      { type: 'message', is_markdown_support: true, text: `<color:${priorityColor(priority)}|${priority}>` },

      { type: 'divider', style: { bold: false, dotted: false, color: '#98a0a9' } },
      { type: 'message', text: 'Create this task?' },

      {
        type: 'actions',
        items: [
          { text: 'Create Task', value: ACTIONS.CONFIRM_CREATE_TASK, style: 'Primary' },
          { text: 'Edit',        value: ACTIONS.EDIT_CREATE_TASK,    style: 'Default' },
          { text: 'Cancel',      value: ACTIONS.CANCEL_CREATE_TASK,  style: 'Danger'  },
        ],
      },
    ],
  };
}

// ── Step 4: final "Task Created" card ───────────────────────────────────────

export function buildTaskCreatedCard(task) {
  const owner    = task.owner    || 'Unassigned';
  const dueDate  = task.dueDate  || 'Not set';
  const priority = task.priority || 'Medium';

  return {
    settings: {},
    body: [
      { type: 'message', text: 'Task Created',     style: { bold: true } },
      { type: 'divider', style: { bold: false, dotted: false, color: '#98a0a9' } },
      { type: 'message', is_markdown_support: true, text: `<color:#2E7D32|${task.title}>` },
      { type: 'message', text: `Owner: ${owner}` },
      { type: 'message', is_markdown_support: true, text: `Priority: <color:${priorityColor(priority)}|${priority}>` },
      { type: 'message', text: `Due Date: ${dueDate}` },
      { type: 'divider', style: { bold: false, dotted: false, color: '#98a0a9' } },
      {
        type: 'actions',
        items: [
          {
            type: 'button',
            text: 'Open Dashboard',
            value: ACTIONS.OPEN_DASHBOARD,
            style: 'Default',
            ...maybeDialog(),
          },
        ],
      },
    ],
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function priorityColor(priority) {
  switch (priority) {
    case 'High':   return '#D32F2F';
    case 'Medium': return '#F9A825';
    case 'Low':    return '#2E7D32';
    default:       return '#0E71EB';
  }
}

/**
 * Open Dashboard only renders as an in-client dialog when getWebviewUrl()
 * resolves to an https URL (Zoom rejects http/null dialog links). In local-
 * only dev the button is rendered as a plain message-style button.
 */
function maybeDialog() {
  const url = getWebviewUrl();
  if (!url) return {};
  return {
    action: 'dialog',
    dialog: {
      size: 'L',
      title: { text: 'AI Services Dashboard' },
      link: url,
    },
  };
}
