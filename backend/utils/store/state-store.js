// Per-user session state for multi-step Team Chat bot flows (Create Task,
// Research Assistant). In-memory only — replace with Redis / Postgres /
// DynamoDB for production.

const userStore = new Map();    // userJid → session state

export function getState(userJid) {
  return userStore.get(userJid) ?? {
    service: null,         // 'CREATE_TASK' | 'RESEARCH' | null
    step: null,            // current step inside the active flow's state machine
    draft: null,           // Create Task: { title, description, owner, dueDate, priority }
    threadId: null,        // replyMainMessageId from the event that started this flow
    threadMessageId: null, // message_id of the bot's own prompt (research fallback)
  };
}

export function setState(userJid, updates) {
  userStore.set(userJid, { ...getState(userJid), ...updates });
}

export function clearState(userJid) {
  userStore.delete(userJid);
}
