/**
 * Follow-up docs store — keeps the metadata of Zoom Docs created via the
 * AI Actions tab so the UI can show "previously created" cards and
 * support Share-to-Chat after the user closes the preview modal.
 *
 * In-memory only, matches the rest of the sample app's storage approach.
 * Replace with a real DB before production.
 */

import { logger } from '../logger.js';
const log = logger('store');

const docsByMeeting = new Map(); // meetingId → FollowUpDocRecord[]

/**
 * @typedef {Object} FollowUpDocRecord
 * @property {string}  id
 * @property {string}  meetingId
 * @property {string}  title
 * @property {string}  fileId       - Zoom Docs file id (when MCP returned one)
 * @property {string}  fileLink     - shareable URL
 * @property {string}  createdAt    - ISO timestamp
 * @property {boolean} sharedToChat - flipped to true after the user shares
 * @property {string}  [actor]
 */

export function recordCreatedDoc(meetingId, { title, fileId, fileLink, actor }) {
  const record = {
    id:          `doc-${Date.now().toString(36)}`,
    meetingId,
    title,
    fileId:      fileId ?? null,
    fileLink:    fileLink ?? null,
    createdAt:   new Date().toISOString(),
    sharedToChat: false,
    actor:       actor ?? 'user',
  };
  const list = docsByMeeting.get(meetingId) ?? [];
  list.unshift(record);
  docsByMeeting.set(meetingId, list);
  log.info('follow-up doc recorded', { meeting: meetingId, id: record.id, title });
  return record;
}

export function listDocsForMeeting(meetingId) {
  return [...(docsByMeeting.get(meetingId) ?? [])];
}

export function findDoc(meetingId, docId) {
  return (docsByMeeting.get(meetingId) ?? []).find(d => d.id === docId) ?? null;
}

export function markSharedToChat(meetingId, docId) {
  const doc = findDoc(meetingId, docId);
  if (!doc) return null;
  doc.sharedToChat = true;
  doc.sharedAt = new Date().toISOString();
  return doc;
}
