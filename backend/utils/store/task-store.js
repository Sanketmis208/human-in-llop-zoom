/**
 * TaskStore — unified storage abstraction for the AI task workflow layer.
 *
 * Backend: in-memory, seeded from data/seed/*.json on boot. Swap to SQLite,
 * Supabase, or Postgres by reimplementing this file behind the same API.
 *
 * Tables:
 *   meetings     — MeetingContext per meeting instance (transcript, summary, decisions)
 *   suggestions  — AI-generated SuggestedTask awaiting human approval
 *   activity     — append-only audit log
 *   tasks        — delegates to utils/meeting-tasks/taskStore.js (confirmed/open/completed)
 *
 * Lifecycle:
 *   transcript → AI analyzer → saveTaskSuggestion (pending)
 *     → user approves → approveTaskSuggestion → creates a Task → links suggestion.approvedTaskId
 *     → user rejects  → rejectTaskSuggestion → status=rejected, no task created
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import {
  getAllTasks,
  getTasksByInstance,
  getTask as getTaskFromMeetingStore,
  completeTask as completeTaskInMeetingStore,
  updateTaskStatus,
  addTask,
  buildTaskSummary,
} from '../meeting-tasks/taskStore.js';
import { SAMPLE_MEETING_INSTANCES } from '../meeting-tasks/sampleTasks.js';
import { logger } from '../logger.js';

const log = logger('store');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(__dirname, '..', '..', 'data', 'seed');

// ── In-memory tables, seeded on boot ──────────────────────────────────────────

let meetings    = [];   // MeetingContext[]
let transcripts = {};   // { [meetingId]: TranscriptSegment[] }
let suggestions = [];   // SuggestedTask[]
let activity    = [];   // ActivityEvent[]

function readSeed(filename, fallback) {
  try {
    const raw = fs.readFileSync(path.join(SEED_DIR, filename), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn('failed to load seed', { filename, error: err.message });
    }
    return fallback;
  }
}

function loadSeed() {
  meetings    = readSeed('meetings.json',    []);
  transcripts = readSeed('transcripts.json', {});
  suggestions = readSeed('suggestions.json', []);
  activity    = readSeed('activity.json',    []);
}

loadSeed();

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function logActivity(event) {
  const record = {
    id: newId('evt'),
    timestamp: now(),
    ...event,
  };
  activity.push(record);
  return record;
}

// ── Meetings / Context ────────────────────────────────────────────────────────

export function listMeetings() {
  return [...meetings].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export function getMeetingContext(meetingId) {
  const meeting = meetings.find(m => m.id === meetingId) ?? null;
  if (!meeting) return null;

  return {
    ...meeting,
    transcript:  transcripts[meetingId] ?? [],
    tasks:       getTasksByInstance(meetingId),
    suggestions: getTaskSuggestions(meetingId),
  };
}

export function upsertMeetingContext(meetingId, patch) {
  const idx = meetings.findIndex(m => m.id === meetingId);
  if (idx === -1) {
    const created = { id: meetingId, date: now(), ...patch };
    meetings.push(created);
    return created;
  }
  meetings[idx] = { ...meetings[idx], ...patch };
  return meetings[idx];
}

export function saveMeetingSummary(meetingId, summary) {
  const updated = upsertMeetingContext(meetingId, { summary });
  logActivity({ type: 'summary.generated', meetingId, actor: 'ai', payload: {} });
  return updated;
}

export function appendTranscriptSegment(meetingId, segment) {
  transcripts[meetingId] = transcripts[meetingId] ?? [];
  transcripts[meetingId].push({ ts: now(), ...segment });
  return transcripts[meetingId];
}

export function getTranscript(meetingId) {
  return transcripts[meetingId] ?? [];
}

// ── Suggested tasks ───────────────────────────────────────────────────────────

export function getTaskSuggestions(meetingId, { status } = {}) {
  let result = meetingId
    ? suggestions.filter(s => s.meetingId === meetingId)
    : [...suggestions];
  if (status) result = result.filter(s => s.status === status);
  return result.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

export function getTaskSuggestion(id) {
  return suggestions.find(s => s.id === id) ?? null;
}

/**
 * Save a new suggestion (AI-generated).
 * @param {Partial<SuggestedTask>} suggestion
 * @returns {SuggestedTask}
 */
export function saveTaskSuggestion(suggestion) {
  const record = {
    id:           suggestion.id ?? newId('sug'),
    meetingId:    suggestion.meetingId ?? null,
    title:        suggestion.title ?? 'Untitled task',
    description:  suggestion.description ?? '',
    assignee:     suggestion.assignee ?? null,
    priority:     suggestion.priority ?? 'Medium',
    dueDate:      suggestion.dueDate ?? null,
    confidence:   typeof suggestion.confidence === 'number' ? suggestion.confidence : 0,
    sourceExcerpt: suggestion.sourceExcerpt ?? '',
    status:       'pending',
    createdBy:    suggestion.createdBy ?? 'ai',
    createdAt:    now(),
    updatedAt:    now(),
    approvedTaskId: null,
  };
  suggestions.push(record);
  logActivity({
    type: 'suggestion.created',
    meetingId: record.meetingId,
    suggestionId: record.id,
    actor: record.createdBy,
    payload: { title: record.title, confidence: record.confidence },
  });
  return record;
}

/**
 * Approve a suggestion and turn it into a real task.
 * Optional updates let the user edit the suggestion at approval time.
 *
 * @param {string} id
 * @param {object} [updates] - fields the user edited before approving
 * @returns {{ suggestion, task }} approved suggestion + the new task record
 */
export function approveTaskSuggestion(id, updates = {}) {
  const sug = suggestions.find(s => s.id === id);
  if (!sug) return null;
  if (sug.status !== 'pending') return { suggestion: sug, task: null };

  Object.assign(sug, updates, {
    status: 'approved',
    updatedAt: now(),
  });

  const meetingInstance = SAMPLE_MEETING_INSTANCES.find(i => i.id === sug.meetingId);
  const task = addTask({
    id: newId('task'),
    title: sug.title,
    description: sug.description,
    meetingSeriesId: meetingInstance?.seriesId ?? null,
    meetingInstanceId: sug.meetingId,
    status: 'open',
    owner: sug.assignee,
    priority: sug.priority,
    createdAt: now(),
    dueDate: sug.dueDate,
    source: 'ai_suggestion',
    suggestionId: sug.id,
  });
  sug.approvedTaskId = task.id;

  logActivity({
    type: 'suggestion.approved',
    meetingId: sug.meetingId,
    suggestionId: sug.id,
    taskId: task.id,
    actor: updates.actor ?? 'user',
    payload: { title: task.title, edits: Object.keys(updates) },
  });

  return { suggestion: sug, task };
}

export function rejectTaskSuggestion(id, { reason, actor } = {}) {
  const sug = suggestions.find(s => s.id === id);
  if (!sug) return null;
  if (sug.status !== 'pending') return sug;

  sug.status = 'rejected';
  sug.updatedAt = now();
  sug.rejectReason = reason ?? null;

  logActivity({
    type: 'suggestion.rejected',
    meetingId: sug.meetingId,
    suggestionId: sug.id,
    actor: actor ?? 'user',
    payload: { reason },
  });

  return sug;
}

export function updateTaskSuggestion(id, updates) {
  const sug = suggestions.find(s => s.id === id);
  if (!sug) return null;
  Object.assign(sug, updates, { updatedAt: now() });
  return sug;
}

/**
 * Create a real Task from manual input (Team Chat "Create Task" flow).
 * Bypasses the AI suggestion lifecycle since the user is both author and
 * approver. Task appears immediately in /tasks, the dashboard counts, and
 * /api/meeting-tasks.
 *
 * @param {object} input
 * @param {string} input.title         - required
 * @param {string} [input.description]
 * @param {string} [input.owner]
 * @param {string} [input.dueDate]     - ISO if parseable, else freeform text
 * @param {'Low'|'Medium'|'High'} [input.priority]
 * @param {string} [input.actor]       - user JID for the activity log
 * @param {string} [input.meetingInstanceId]
 */
export function createManualTask(input) {
  const task = addTask({
    id: newId('task'),
    title:             input.title,
    description:       input.description ?? '',
    owner:             input.owner ?? null,
    priority:          input.priority ?? 'Medium',
    dueDate:           input.dueDate ?? null,
    status:            'open',
    meetingSeriesId:   null,
    meetingInstanceId: input.meetingInstanceId ?? null,
    createdAt:         now(),
    source:            'manual_team_chat',
  });

  logActivity({
    type:   'task.created.manual',
    taskId: task.id,
    actor:  input.actor ?? 'user',
    payload: {
      title:    task.title,
      owner:    task.owner,
      priority: task.priority,
      dueDate:  task.dueDate,
    },
  });

  return task;
}

// ── Tasks (confirmed) ─────────────────────────────────────────────────────────

export function getOpenTasks(meetingId) {
  const all = meetingId ? getTasksByInstance(meetingId) : getAllTasks();
  return all.filter(t => t.status === 'open' || t.status === 'in_progress');
}

export function getCompletedTasks(meetingId) {
  const all = meetingId ? getTasksByInstance(meetingId) : getAllTasks();
  return all.filter(t => t.status === 'completed');
}

export function getTask(taskId) {
  return getTaskFromMeetingStore(taskId);
}

export function markTaskComplete(taskId, { actor } = {}) {
  const task = completeTaskInMeetingStore(taskId, null, null);
  if (task) {
    logActivity({
      type: 'task.completed',
      meetingId: task.meetingInstanceId,
      taskId,
      actor: actor ?? 'user',
      payload: { title: task.title },
    });
  }
  return task;
}

export function patchTask(taskId, updates) {
  const task = getTaskFromMeetingStore(taskId);
  if (!task) return null;
  if (updates.status) updateTaskStatus(taskId, updates.status);
  Object.assign(task, {
    ...(updates.title       !== undefined && { title: updates.title }),
    ...(updates.description !== undefined && { description: updates.description }),
    ...(updates.owner       !== undefined && { owner: updates.owner }),
    ...(updates.priority    !== undefined && { priority: updates.priority }),
    ...(updates.dueDate     !== undefined && { dueDate: updates.dueDate }),
  });
  logActivity({
    type: 'task.updated',
    taskId,
    meetingId: task.meetingInstanceId,
    actor: updates.actor ?? 'user',
    payload: { fields: Object.keys(updates).filter(k => k !== 'actor') },
  });
  return task;
}

// ── Activity log ──────────────────────────────────────────────────────────────

export function getActivity({ meetingId, taskId, limit = 50 } = {}) {
  let result = [...activity];
  if (meetingId) result = result.filter(e => e.meetingId === meetingId);
  if (taskId)    result = result.filter(e => e.taskId === taskId);
  return result.slice(-limit).reverse();
}

export { logActivity };

// ── "What changed since last meeting" ─────────────────────────────────────────

/**
 * Compare two meetings in a series and surface what moved between them.
 * Used by the dashboard's "What Changed" view.
 *
 * @param {string} seriesId
 * @param {string} sinceMeetingId  - reference meeting; we compare against everything after it
 * @returns {{ completed, newlyOpen, newDecisions, newRisks }}
 */
export function whatChangedSince(seriesId, sinceMeetingId) {
  const seriesMeetings = meetings
    .filter(m => m.seriesId === seriesId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const sinceIdx = seriesMeetings.findIndex(m => m.id === sinceMeetingId);
  if (sinceIdx === -1) return { completed: [], newlyOpen: [], newDecisions: [], newRisks: [] };

  const after = seriesMeetings.slice(sinceIdx + 1);
  const afterIds = new Set(after.map(m => m.id));

  const allTasks = getAllTasks().filter(t => t.meetingSeriesId === seriesId);
  const completed = allTasks.filter(t =>
    t.status === 'completed' && t.completedAt && t.completedAt >= (seriesMeetings[sinceIdx].date || ''),
  );
  const newlyOpen = allTasks.filter(t =>
    (t.status === 'open' || t.status === 'in_progress') &&
    afterIds.has(t.meetingInstanceId),
  );

  const newDecisions = after.flatMap(m => (m.decisions || []).map(d => ({ meetingId: m.id, decision: d })));
  const newRisks     = after.flatMap(m => (m.risks     || []).map(r => ({ meetingId: m.id, risk: r })));

  return { completed, newlyOpen, newDecisions, newRisks };
}

// ── Summary helpers ───────────────────────────────────────────────────────────

export function getDashboardSummary() {
  const all = getAllTasks();
  const pendingSuggestions = suggestions.filter(s => s.status === 'pending');
  return {
    tasks: buildTaskSummary(all),
    pendingSuggestionCount: pendingSuggestions.length,
    recentMeetings: listMeetings().slice(0, 5).map(m => ({
      id: m.id,
      title: m.title,
      date: m.date,
      hasSummary: !!m.summary,
    })),
  };
}

// ── Object façade (matches the brief's TaskStore class API) ───────────────────

export const taskStore = {
  // suggestions
  getTaskSuggestions,
  getTaskSuggestion,
  saveTaskSuggestion,
  approveTaskSuggestion,
  rejectTaskSuggestion,
  updateTaskSuggestion,
  // tasks
  getOpenTasks,
  getCompletedTasks,
  getTask,
  markTaskComplete,
  patchTask,
  createManualTask,
  // meeting context
  listMeetings,
  getMeetingContext,
  upsertMeetingContext,
  saveMeetingSummary,
  appendTranscriptSegment,
  getTranscript,
  // activity
  getActivity,
  logActivity,
  // aggregations
  whatChangedSince,
  getDashboardSummary,
};

export default taskStore;
