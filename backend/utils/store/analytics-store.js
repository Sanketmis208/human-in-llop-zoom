// TODO: Replace in-memory store with database persistence for production.

export const EVENT_TYPES = {
  DASHBOARD_OPENED:              'dashboard_opened',
  SERVICE_SELECTED:              'service_selected',

  // Create Task (manual task creation via Team Chat bot)
  CREATE_TASK_STARTED:           'create_task_started',
  CREATE_TASK_COMPLETED:         'create_task_completed',
  CREATE_TASK_CANCELED:          'create_task_canceled',

  // Research Assistant
  RESEARCH_QUESTION_SUBMITTED:   'research_question_submitted',
  RESEARCH_RESPONSE_GENERATED:   'research_response_generated',
  RESEARCH_FEEDBACK_POSITIVE:    'research_feedback_positive',
  RESEARCH_FEEDBACK_NEGATIVE:    'research_feedback_negative',
  RESPONSE_EDITED:               'response_edited',

  // Generic
  TEAM_CHAT_MESSAGE_SENT:        'team_chat_message_sent',
  SERVICE_ERROR:                 'service_error',

  // Retained for historical analytics seed data — no longer emitted by the bot.
  APPRECIATION_STARTED:          'employee_appreciation_started',
  APPRECIATION_COMPLETED:        'employee_appreciation_completed',
  APPRECIATION_SENT:             'appreciation_sent',
  APPRECIATION_FEEDBACK_POSITIVE:'appreciation_feedback_positive',
  APPRECIATION_FEEDBACK_NEGATIVE:'appreciation_feedback_negative',
};

const events = [];

// Seed realistic demo data across the last 7 days.
// Remove this block once real event data is flowing.
(function seedDemoData() {
  const now = Date.now();
  const h   = 3600000;
  const d   = 86400000;

  const demo = [
    { type: EVENT_TYPES.SERVICE_SELECTED,             userJid: 'user-a@xmpp.zoom.us', service: 'RESEARCH',     timestamp: now - 7 * d },
    { type: EVENT_TYPES.RESEARCH_QUESTION_SUBMITTED,  userJid: 'user-a@xmpp.zoom.us',                          timestamp: now - 7 * d + 2 * h },
    { type: EVENT_TYPES.RESEARCH_RESPONSE_GENERATED,  userJid: 'user-a@xmpp.zoom.us',                          timestamp: now - 7 * d + 2 * h + 30000 },
    { type: EVENT_TYPES.TEAM_CHAT_MESSAGE_SENT,       userJid: 'user-a@xmpp.zoom.us',                          timestamp: now - 7 * d + 2 * h + 31000 },
    { type: EVENT_TYPES.SERVICE_SELECTED,             userJid: 'user-b@xmpp.zoom.us', service: 'APPRECIATION', timestamp: now - 6 * d },
    { type: EVENT_TYPES.APPRECIATION_STARTED,         userJid: 'user-b@xmpp.zoom.us',                          timestamp: now - 6 * d + h },
    { type: EVENT_TYPES.APPRECIATION_COMPLETED,       userJid: 'user-b@xmpp.zoom.us',                          timestamp: now - 6 * d + 2 * h },
    { type: EVENT_TYPES.TEAM_CHAT_MESSAGE_SENT,       userJid: 'user-b@xmpp.zoom.us',                          timestamp: now - 6 * d + 2 * h + 5000 },
    { type: EVENT_TYPES.SERVICE_SELECTED,             userJid: 'user-c@xmpp.zoom.us', service: 'RESEARCH',     timestamp: now - 5 * d },
    { type: EVENT_TYPES.RESEARCH_QUESTION_SUBMITTED,  userJid: 'user-c@xmpp.zoom.us',                          timestamp: now - 5 * d + h },
    { type: EVENT_TYPES.RESEARCH_RESPONSE_GENERATED,  userJid: 'user-c@xmpp.zoom.us',                          timestamp: now - 5 * d + h + 45000 },
    { type: EVENT_TYPES.TEAM_CHAT_MESSAGE_SENT,       userJid: 'user-c@xmpp.zoom.us',                          timestamp: now - 5 * d + h + 46000 },
    { type: EVENT_TYPES.SERVICE_SELECTED,             userJid: 'user-a@xmpp.zoom.us', service: 'APPRECIATION', timestamp: now - 4 * d },
    { type: EVENT_TYPES.APPRECIATION_STARTED,         userJid: 'user-a@xmpp.zoom.us',                          timestamp: now - 4 * d + h },
    { type: EVENT_TYPES.APPRECIATION_COMPLETED,       userJid: 'user-a@xmpp.zoom.us',                          timestamp: now - 4 * d + 2 * h },
    { type: EVENT_TYPES.TEAM_CHAT_MESSAGE_SENT,       userJid: 'user-a@xmpp.zoom.us',                          timestamp: now - 4 * d + 2 * h + 5000 },
    { type: EVENT_TYPES.SERVICE_SELECTED,             userJid: 'user-d@xmpp.zoom.us', service: 'RESEARCH',     timestamp: now - 3 * d },
    { type: EVENT_TYPES.RESEARCH_QUESTION_SUBMITTED,  userJid: 'user-d@xmpp.zoom.us',                          timestamp: now - 3 * d + h },
    { type: EVENT_TYPES.RESEARCH_RESPONSE_GENERATED,  userJid: 'user-d@xmpp.zoom.us',                          timestamp: now - 3 * d + h + 20000 },
    { type: EVENT_TYPES.TEAM_CHAT_MESSAGE_SENT,       userJid: 'user-d@xmpp.zoom.us',                          timestamp: now - 3 * d + h + 21000 },
    { type: EVENT_TYPES.SERVICE_SELECTED,             userJid: 'user-e@xmpp.zoom.us', service: 'APPRECIATION', timestamp: now - 2 * d },
    { type: EVENT_TYPES.APPRECIATION_STARTED,         userJid: 'user-e@xmpp.zoom.us',                          timestamp: now - 2 * d + h },
    { type: EVENT_TYPES.SERVICE_ERROR,                userJid: 'user-e@xmpp.zoom.us', service: 'APPRECIATION', timestamp: now - 2 * d + 2 * h },
    { type: EVENT_TYPES.SERVICE_SELECTED,             userJid: 'user-b@xmpp.zoom.us', service: 'RESEARCH',     timestamp: now - d },
    { type: EVENT_TYPES.RESEARCH_QUESTION_SUBMITTED,  userJid: 'user-b@xmpp.zoom.us',                          timestamp: now - d + h },
    { type: EVENT_TYPES.RESEARCH_RESPONSE_GENERATED,  userJid: 'user-b@xmpp.zoom.us',                          timestamp: now - d + h + 35000 },
    { type: EVENT_TYPES.TEAM_CHAT_MESSAGE_SENT,       userJid: 'user-b@xmpp.zoom.us',                          timestamp: now - d + h + 36000 },
    { type: EVENT_TYPES.SERVICE_SELECTED,             userJid: 'user-c@xmpp.zoom.us', service: 'APPRECIATION', timestamp: now - 4 * h },
    { type: EVENT_TYPES.APPRECIATION_STARTED,         userJid: 'user-c@xmpp.zoom.us',                          timestamp: now - 3 * h },
    { type: EVENT_TYPES.APPRECIATION_COMPLETED,       userJid: 'user-c@xmpp.zoom.us',                          timestamp: now - 2 * h },
    { type: EVENT_TYPES.TEAM_CHAT_MESSAGE_SENT,       userJid: 'user-c@xmpp.zoom.us',                          timestamp: now - 2 * h + 5000 },
    { type: EVENT_TYPES.DASHBOARD_OPENED,             userJid: 'user-a@xmpp.zoom.us',                          timestamp: now - h },
  ];

  events.push(...demo);
})();

/**
 * Record an analytics event.
 * @param {string} type    - One of EVENT_TYPES values
 * @param {string} userJid - JID of the acting user
 * @param {Object} [meta]  - Optional extra fields (e.g. { service: 'RESEARCH' })
 */
export function trackEvent(type, userJid, meta = {}) {
  events.push({ type, userJid, timestamp: Date.now(), ...meta });
}

/**
 * Compute and return dashboard analytics for the last 7 days.
 * @returns {Object}
 */
export function getAnalytics() {
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const recent = events.filter(e => e.timestamp >= sevenDaysAgo);

  const count = (type) => recent.filter(e => e.type === type).length;

  const appStarted   = count(EVENT_TYPES.APPRECIATION_STARTED);
  const appCompleted = count(EVENT_TYPES.APPRECIATION_COMPLETED);
  const completionRate = appStarted > 0 ? Math.round((appCompleted / appStarted) * 100) : 0;

  return {
    period: '7 days',
    metrics: {
      totalLaunches:     count(EVENT_TYPES.SERVICE_SELECTED),
      appreciations:     appCompleted,
      researchQuestions: count(EVENT_TYPES.RESEARCH_QUESTION_SUBMITTED),
      messagesSent:      count(EVENT_TYPES.TEAM_CHAT_MESSAGE_SENT),
      activeUsers:       new Set(recent.map(e => e.userJid)).size,
      completionRate,
    },
    services: {
      appreciation: {
        started:   appStarted,
        completed: appCompleted,
        rate:      `${completionRate}%`,
      },
      research: {
        questionsSubmitted: count(EVENT_TYPES.RESEARCH_QUESTION_SUBMITTED),
        responsesGenerated: count(EVENT_TYPES.RESEARCH_RESPONSE_GENERATED),
      },
    },
    recentActivity: [...events]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20),
  };
}
