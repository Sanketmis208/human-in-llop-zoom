/**
 * In-memory task store for the Meeting Task Assistant demo.
 *
 * All state lives in a module-level array. Restarts wipe it; a real app
 * would use a database here.
 *
 * Exported API:
 *   getAllSeries()                                   → series[]
 *   getMeetingInstances(seriesId?)                   → instance[]
 *   getAllTasks()                                     → task[]
 *   getTasksBySeries(seriesId)                       → task[]
 *   getTasksByInstance(instanceId)                   → task[]
 *   getTask(taskId)                                  → task | null
 *   completeTask(taskId, transcriptSegmentId, match) → task | null
 *   updateTaskStatus(taskId, status)                 → task | null
 *   reopenTask(taskId)                               → task | null
 *   resetToSampleData()                              → task[]
 *   buildTaskSummary(tasks)                          → { total, open, inProgress, completed }
 *
 * TODO (Phase 3): Replace every function body with a Zoom Task API call.
 *   Zoom Task API base path: /v2/tasks  (check latest Zoom developer docs)
 */

import { SAMPLE_TASKS, SAMPLE_MEETING_SERIES, SAMPLE_MEETING_INSTANCES } from './sampleTasks.js';

// Deep-clone a task so mutations never corrupt the original sample data.
function cloneTask(t) {
  return { ...t, relatedTranscriptSegmentIds: [...t.relatedTranscriptSegmentIds] };
}

// Live in-memory task list — seeded from sample data at module load.
let tasks = SAMPLE_TASKS.map(cloneTask);

// ── Read operations ───────────────────────────────────────────────────────────

/** All meeting series definitions. */
export function getAllSeries() {
  // TODO (Phase 3): GET /v2/tasks/series  (or equivalent Zoom Task API endpoint)
  return SAMPLE_MEETING_SERIES;
}

/**
 * Meeting instances, optionally filtered by series ID.
 * @param {string} [seriesId]
 */
export function getMeetingInstances(seriesId) {
  // TODO (Phase 3): GET /v2/tasks/meetings?seriesId=...
  if (seriesId) return SAMPLE_MEETING_INSTANCES.filter(i => i.seriesId === seriesId);
  return SAMPLE_MEETING_INSTANCES;
}

/** All tasks across all series and instances. */
export function getAllTasks() {
  // TODO (Phase 3): GET /v2/tasks
  return tasks;
}

/** Tasks belonging to a meeting series. */
export function getTasksBySeries(seriesId) {
  // TODO (Phase 3): GET /v2/tasks?meeting_series_id={seriesId}
  return tasks.filter(t => t.meetingSeriesId === seriesId);
}

/** Tasks belonging to a specific meeting instance. */
export function getTasksByInstance(instanceId) {
  // TODO (Phase 3): GET /v2/tasks?meeting_instance_id={instanceId}
  return tasks.filter(t => t.meetingInstanceId === instanceId);
}

/** Single task by ID. Returns null if not found. */
export function getTask(taskId) {
  // TODO (Phase 3): GET /v2/tasks/{taskId}
  return tasks.find(t => t.id === taskId) ?? null;
}

// ── Write operations ──────────────────────────────────────────────────────────

/**
 * Mark a task as completed.
 *
 * @param {string}      taskId
 * @param {string|null} transcriptSegmentId  - seqNo/ID of the triggering transcript segment; null for manual
 * @param {object|null} matchInfo            - { matchedText, confidence, reason, matchedKeywords, matchedPhrase } from taskMatcher; null for manual
 * @returns {object|null} Updated task, or null if not found.
 *
 * TODO (Phase 3): PATCH /v2/tasks/{taskId}  { status: 'completed', completedAt: ... }
 */
export function completeTask(taskId, transcriptSegmentId = null, matchInfo = null) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;
  if (task.status === 'completed') return task; // idempotent

  task.status = 'completed';
  task.completedAt = new Date().toISOString();
  task.source = transcriptSegmentId ? 'rtms_transcript' : 'manual';

  if (transcriptSegmentId) {
    task.relatedTranscriptSegmentIds.push(String(transcriptSegmentId));
  }

  // Store the last match context so the UI can display the snippet and confidence.
  task.matchInfo = matchInfo ?? null;

  return task;
}

/**
 * Update a task's status to any valid value.
 * @param {string} taskId
 * @param {'open'|'in_progress'|'completed'} status
 * @returns {object|null}
 *
 * TODO (Phase 3): PATCH /v2/tasks/{taskId}  { status }
 */
export function updateTaskStatus(taskId, status) {
  const VALID = new Set(['open', 'in_progress', 'completed']);
  if (!VALID.has(status)) throw new Error(`Invalid task status: "${status}"`);

  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;

  task.status = status;

  // Clear completion metadata when moving out of completed state.
  if (status !== 'completed') {
    task.completedAt = null;
    task.source = 'manual';
    task.matchInfo = null;
  }

  return task;
}

/**
 * Reopen a task — sets status back to 'open' and clears completion metadata.
 *
 * TODO (Phase 3): PATCH /v2/tasks/{taskId}  { status: 'open' }
 */
export function reopenTask(taskId) {
  return updateTaskStatus(taskId, 'open');
}

/**
 * Append a new task to the live in-memory list.
 * Used by the AI workflow when a suggestion is approved.
 *
 * @param {object} task - Must include id, title, meetingSeriesId, meetingInstanceId, status.
 * @returns {object} The stored task (same reference, after defaulting missing fields).
 */
export function addTask(task) {
  const stored = {
    relatedTranscriptSegmentIds: [],
    completedAt: null,
    source: 'manual',
    ...task,
  };
  tasks.push(stored);
  return stored;
}

/**
 * Reset all tasks to the original sample data.
 * Demo / testing only — not relevant in a production deployment.
 *
 * TODO (Phase 3): This function has no equivalent in the Zoom Task API.
 *   Remove it (or guard with a dev-only flag) before going to production.
 */
export function resetToSampleData() {
  tasks = SAMPLE_TASKS.map(cloneTask);
  return tasks;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Count tasks by status — used to populate the summary cards in the UI.
 * @param {object[]} taskList
 * @returns {{ total: number, open: number, inProgress: number, completed: number }}
 */
export function buildTaskSummary(taskList) {
  return {
    total:      taskList.length,
    open:       taskList.filter(t => t.status === 'open').length,
    inProgress: taskList.filter(t => t.status === 'in_progress').length,
    completed:  taskList.filter(t => t.status === 'completed').length,
  };
}
