/**
 * Team Chat bot updates for AI task workflow events.
 *
 * Posts threaded messages into a chat (channel or DM) when:
 *   - N suggestions are detected from a meeting
 *   - a user approves a suggestion
 *   - a user rejects a suggestion
 *   - a task is completed
 *   - the user requests a pre-meeting open-tasks digest
 *
 * Threading: the first notification for a meeting captures the resulting
 * message_id and stores it on the meeting context as `chatThreadId`. Every
 * subsequent notification for the same meeting replies under that thread, so
 * we avoid spamming the channel.
 *
 * Recipient: ZOOM_TASK_NOTIFICATIONS_JID controls where messages go. If unset,
 * notifications are logged and skipped — the rest of the workflow continues.
 *
 * Per the safety requirement, this is a notification surface only; nothing
 * here mutates task or suggestion state.
 */

import { sendChatMessage } from '../zoom/zoom-api.js';
import taskStore from '../store/task-store.js';
import { logger } from '../logger.js';

const log = logger('notifier');

function recipient() {
  return process.env.ZOOM_TASK_NOTIFICATIONS_JID || null;
}

function inviter() {
  return process.env.ZOOM_TASK_NOTIFICATIONS_USER_JID || recipient();
}

function buildSimpleCard(headerText, bodyLines) {
  return {
    head: { text: headerText },
    body: bodyLines.map(text => ({ type: 'message', text })),
  };
}

async function postAndThread({ meetingId, content }) {
  const toJid = recipient();
  if (!toJid) {
    log.info('skipped: ZOOM_TASK_NOTIFICATIONS_JID not set', { title: content.head?.text });
    return null;
  }

  const meeting = meetingId ? taskStore.getMeetingContext(meetingId) : null;
  const replyTo = meeting?.chatThreadId ?? null;

  try {
    const res = await sendChatMessage(toJid, content, replyTo, inviter());
    // Capture the first message ID so future updates thread under it.
    if (meetingId && !replyTo && res?.message_id) {
      taskStore.upsertMeetingContext(meetingId, { chatThreadId: res.message_id });
    }
    return res;
  } catch (err) {
    log.error('sendChatMessage failed', { error: err.message });
    return null;
  }
}

// ── Notification surface ──────────────────────────────────────────────────────

export async function notifySuggestionsDetected({ meetingId, count, meetingTitle }) {
  if (!count) return;
  const lines = [
    `${count} task suggestion${count === 1 ? '' : 's'} were detected from ${meetingTitle || 'this meeting'}.`,
    `Review them at /suggestions — nothing is created until you approve.`,
  ];
  return postAndThread({ meetingId, content: buildSimpleCard('AI Task Suggestions', lines) });
}

export async function notifySuggestionApproved({ meetingId, suggestion, actor }) {
  const lines = [
    `${actor || 'A reviewer'} approved a task suggestion:`,
    `• ${suggestion.title}`,
    suggestion.assignee ? `Assigned to ${suggestion.assignee}.` : 'Unassigned.',
  ];
  return postAndThread({ meetingId, content: buildSimpleCard('Suggestion approved', lines) });
}

export async function notifySuggestionRejected({ meetingId, suggestion, actor, reason }) {
  const lines = [
    `${actor || 'A reviewer'} rejected a task suggestion:`,
    `• ${suggestion.title}`,
    reason ? `Reason: ${reason}` : 'No reason provided.',
  ];
  return postAndThread({ meetingId, content: buildSimpleCard('Suggestion rejected', lines) });
}

export async function notifyTaskCompleted({ task, actor }) {
  const lines = [
    `Task completed: ${task.title}`,
    task.owner ? `Owner: ${task.owner}` : null,
  ].filter(Boolean);
  return postAndThread({
    meetingId: task.meetingInstanceId,
    content: buildSimpleCard('Task completed', lines),
  });
}

/**
 * Pre-meeting digest. Lists open tasks the user should be aware of before the
 * next meeting in a series. Designed to be triggered by a /open-tasks slash
 * command or a scheduled job.
 */
export async function notifyOpenTasksDigest({ meetingId, limit = 10 }) {
  const open = taskStore.getOpenTasks(meetingId).slice(0, limit);
  if (open.length === 0) {
    return postAndThread({
      meetingId,
      content: buildSimpleCard('Pre-meeting digest', ['No open tasks. Looking clean.']),
    });
  }
  const lines = [
    `Open tasks heading into the next meeting (${open.length}):`,
    ...open.map(t => `• ${t.title} — ${t.owner || 'unassigned'} (${t.status})`),
  ];
  return postAndThread({ meetingId, content: buildSimpleCard('Pre-meeting digest', lines) });
}
