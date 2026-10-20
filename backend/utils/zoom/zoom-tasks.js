/**
 * Zoom Tasks API wrapper.
 *
 * Calls the Zoom Tasks API (requires the corresponding scopes on your app).
 * If ZOOM_TASKS_API_ENABLED is not 'true', every function logs and returns a
 * mock response — so the sample app runs end-to-end without the scope.
 *
 * Endpoints used here mirror Zoom's REST conventions. Adjust paths to match
 * the latest published Zoom Tasks API reference for your account.
 *
 *   POST   /v2/tasks            createZoomTask({...})
 *   PATCH  /v2/tasks/{taskId}   updateZoomTask(taskId, {...})
 *   PATCH  /v2/tasks/{taskId}   markZoomTaskComplete(taskId)
 *   GET    /v2/tasks            getOpenTasks({ status, owner })
 *
 * Sync helper:
 *   syncMeetingTasks(meetingId)  - push every local AI-approved task for a
 *                                  meeting up to Zoom, attaching the returned
 *                                  Zoom task ID to the local record.
 */

import { getChatbotToken } from './zoom-server-auth.js';
import { getTask, patchTask } from '../store/task-store.js';
import { getTasksByInstance } from '../meeting-tasks/taskStore.js';
import { logger } from '../logger.js';

const log = logger('zoom-tasks');

// Override via ZOOM_API_BASE_URL for Zoom for Government (https://api.zoomgov.com/v2)
// or other non-default Zoom API hosts.
const ZOOM_API_BASE = process.env.ZOOM_API_BASE_URL || 'https://api.zoom.us/v2';

function isLive() {
  return process.env.ZOOM_TASKS_API_ENABLED === 'true';
}

async function callZoomTasksApi(method, path, body) {
  const token = await getChatbotToken();
  const res = await fetch(`${ZOOM_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err.message || `${res.status} ${res.statusText}`;
    const e = new Error(`Zoom Tasks API ${method} ${path} failed: ${message}`);
    e.status = res.status;
    e.responseBody = err;
    throw e;
  }
  return res.json().catch(() => ({}));
}

function mockResponse(action, payload) {
  log.info('mock', { action, payload });
  return { mock: true, zoomTaskId: `mock-zoom-${Date.now()}`, payload };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a task in Zoom Tasks.
 * @param {object} task
 * @param {string} task.title
 * @param {string} [task.description]
 * @param {string} [task.owner]        - Email or Zoom user ID, depending on API
 * @param {string} [task.dueDate]      - ISO-8601
 * @param {'Low'|'Medium'|'High'} [task.priority]
 * @param {string} [task.meetingId]    - Zoom meeting UUID for cross-linking
 * @returns {Promise<object>}
 */
export async function createZoomTask(task) {
  const payload = {
    title:       task.title,
    description: task.description ?? '',
    assignee:    task.owner ?? null,
    due_date:    task.dueDate ?? null,
    priority:    task.priority ?? 'Medium',
    meeting_id:  task.meetingId ?? null,
    source:      'team-chat-ai-suggestion',
  };

  if (!isLive()) return mockResponse('createZoomTask', payload);

  try {
    return await callZoomTasksApi('POST', '/tasks', payload);
  } catch (err) {
    log.error('createZoomTask failed', { error: err.message });
    throw err;
  }
}

export async function updateZoomTask(zoomTaskId, updates) {
  if (!isLive()) return mockResponse(`updateZoomTask(${zoomTaskId})`, updates);
  return callZoomTasksApi('PATCH', `/tasks/${zoomTaskId}`, updates);
}

export async function markZoomTaskComplete(zoomTaskId) {
  if (!isLive()) return mockResponse(`markZoomTaskComplete(${zoomTaskId})`, {});
  return callZoomTasksApi('PATCH', `/tasks/${zoomTaskId}`, { status: 'completed' });
}

export async function getOpenZoomTasks({ owner, meetingId } = {}) {
  if (!isLive()) {
    return mockResponse('getOpenZoomTasks', { owner, meetingId, results: [] });
  }
  const qs = new URLSearchParams();
  if (owner)     qs.set('owner', owner);
  if (meetingId) qs.set('meeting_id', meetingId);
  qs.set('status', 'open');
  return callZoomTasksApi('GET', `/tasks?${qs.toString()}`);
}

/**
 * Push every approved-but-unsynced local task for a meeting up to Zoom Tasks,
 * and record the returned Zoom task ID on the local record.
 *
 * Best-effort: failures are logged per task and do not abort the loop.
 */
export async function syncMeetingTasks(meetingId) {
  const localTasks = getTasksByInstance(meetingId).filter(
    t => t.source === 'ai_suggestion' && !t.zoomTaskId,
  );

  const results = [];
  for (const task of localTasks) {
    try {
      const response = await createZoomTask({
        title:       task.title,
        description: task.description,
        owner:       task.owner,
        dueDate:     task.dueDate,
        priority:    task.priority,
        meetingId:   task.zoomMeetingUuid ?? meetingId,
      });
      const zoomTaskId = response.zoomTaskId ?? response.id ?? response.task_id ?? null;
      if (zoomTaskId) {
        // Stash on the local record; patchTask only handles known fields, so set directly.
        const local = getTask(task.id);
        if (local) local.zoomTaskId = zoomTaskId;
        patchTask(task.id, { actor: 'system:zoom-sync' });
      }
      results.push({ taskId: task.id, zoomTaskId, ok: true });
    } catch (err) {
      log.error('sync failed', { task: task.id, error: err.message });
      results.push({ taskId: task.id, ok: false, error: err.message });
    }
  }

  return { meetingId, synced: results.filter(r => r.ok).length, results };
}
