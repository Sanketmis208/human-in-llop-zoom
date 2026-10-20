// In-memory store for active RTMS meeting sessions.
// TODO: Replace with Redis or a database for multi-instance deployments.

// meetingUuid → session object
const sessions = new Map();

/**
 * Register a new RTMS session when meeting.rtms_started is received.
 */
export function createSession(meetingUuid, rtmsStreamId, serverUrls) {
  const session = {
    meetingUuid,
    rtmsStreamId,
    serverUrls,
    status: 'connecting', // connecting | active | stopped | error
    startedAt: new Date().toISOString(),
    participants: new Map(),
  };
  sessions.set(meetingUuid, session);
  return session;
}

export function getSession(meetingUuid) {
  return sessions.get(meetingUuid) ?? null;
}

export function updateSessionStatus(meetingUuid, status) {
  const session = sessions.get(meetingUuid);
  if (session) session.status = status;
}

export function upsertParticipant(meetingUuid, participant) {
  const session = sessions.get(meetingUuid);
  if (session) session.participants.set(String(participant.userId), participant);
}

export function removeSession(meetingUuid) {
  sessions.delete(meetingUuid);
}

export function getActiveSessions() {
  return [...sessions.values()].filter(s => s.status === 'active');
}

