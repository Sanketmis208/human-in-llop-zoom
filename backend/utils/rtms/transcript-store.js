// In-memory transcript store with seqNo-based deduplication.
// TODO: Swap the arrays/Sets for a database (e.g. Postgres) for persistence.

// meetingUuid → Set<seqNo>  (for dedup)
const seenSeqNos = new Map();
// meetingUuid → segment[]
const transcripts = new Map();

const MAX_SEGMENTS = 2000; // cap per meeting to avoid unbounded memory growth

/**
 * Attempt to add a transcript segment.
 * Returns true if the segment was new and stored, false if it was a duplicate.
 * @param {string} meetingUuid
 * @param {Object} segment  - normalized segment shape from rtms-service
 * @returns {boolean}
 */
export function addSegment(meetingUuid, segment) {
  if (!seenSeqNos.has(meetingUuid)) {
    seenSeqNos.set(meetingUuid, new Set());
    transcripts.set(meetingUuid, []);
  }

  const seen = seenSeqNos.get(meetingUuid);
  const list = transcripts.get(meetingUuid);

  // Deduplicate by seqNo when present
  if (segment.seqNo != null) {
    if (seen.has(segment.seqNo)) return false;
    seen.add(segment.seqNo);
  }

  list.push({ ...segment, receivedAt: Date.now() });

  // Keep memory bounded — drop oldest segments when limit exceeded
  if (list.length > MAX_SEGMENTS) list.splice(0, list.length - MAX_SEGMENTS);

  // TODO: persist segment to database here (non-blocking)

  return true;
}

/** Return all stored segments for a meeting, oldest first. */
export function getTranscript(meetingUuid) {
  return transcripts.get(meetingUuid) ?? [];
}

/** Wipe stored data for a meeting (called when a session is fully cleaned up). */
export function clearTranscript(meetingUuid) {
  seenSeqNos.delete(meetingUuid);
  transcripts.delete(meetingUuid);
}
