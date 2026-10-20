// Thin typed fetch wrapper around the Express /api endpoints.
// All paths are relative; next.config.mjs rewrites /api/* to the Express origin.

import type {
  DashboardSummary,
  MeetingContext,
  SuggestedTask,
  Task,
  ActivityEvent,
  Priority,
  ActiveRtmsSession,
} from './types';

// In Server Components fetch runs in the Next.js process, not the browser, so
// rewrites do not apply. Use an absolute URL on the server, relative in the
// browser (rewrites take over and forward to Express).
function url(path: string) {
  if (typeof window === 'undefined') {
    const base = process.env.EXPRESS_ORIGIN || 'http://localhost:4000';
    return base + path;
  }
  return path;
}

// Zoom RTMS meeting UUIDs are URL-unsafe base64 — they contain "/", "+", and
// "==". Naive `${meetingId}` interpolation produces invalid paths (slashes
// turn into extra path segments → 404). All meeting-id paths must go through
// this helper. The backend's unwrapMeetingId() peels off the encoding when
// the request arrives.
const eid = (s: string) => encodeURIComponent(s);

async function get<T>(path: string): Promise<T> {
  const res = await fetch(url(path), { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function send<T>(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res.json();
}

export const api = {
  getDashboard:   ()                 => get<DashboardSummary>('/api/dashboard'),
  listMeetings:   ()                 => get<{ success: true; meetings: MeetingContext[] }>('/api/meetings'),
  getMeeting:     (id: string)       => get<{ success: true; meeting: MeetingContext }>(`/api/meetings/${eid(id)}/context`),
  getSuggestions: (meetingId: string) => get<{ success: true; suggestions: SuggestedTask[] }>(`/api/meetings/${eid(meetingId)}/task-suggestions`),
  getTasks:       (meetingId: string) => get<{ success: true; open: Task[]; completed: Task[] }>(`/api/meetings/${eid(meetingId)}/tasks`),
  getActivity:    (meetingId: string, limit = 50) => get<{ success: true; events: ActivityEvent[] }>(`/api/meetings/${eid(meetingId)}/activity?limit=${limit}`),
  getChanges:     (meetingId: string) => get<{ success: true; changes: { completed: Task[]; newlyOpen: Task[]; newDecisions: Array<{ meetingId: string; decision: string }>; newRisks: Array<{ meetingId: string; risk: string }> } }>(`/api/meetings/${eid(meetingId)}/changes`),

  approveSuggestion: (id: string, opts: { updates?: Partial<SuggestedTask>; syncToZoom?: boolean; actor?: string } = {}) =>
    send<{ success: true; suggestion: SuggestedTask; task: Task; zoomSync: unknown }>('POST', `/api/task-suggestions/${id}/approve`, opts),
  rejectSuggestion: (id: string, reason?: string) =>
    send<{ success: true; suggestion: SuggestedTask }>('POST', `/api/task-suggestions/${id}/reject`, { reason }),
  reviewSuggestion: (id: string) =>
    send<{ success: true; suggestion: SuggestedTask; review: { recommendation: 'approve'|'edit'|'reject'; reasoning: string; usedAI: boolean } }>('POST', `/api/task-suggestions/${id}/review`),

  completeTask: (taskId: string) =>
    send<{ success: true; task: Task }>('POST', `/api/tasks/${taskId}/complete`),
  patchTask: (taskId: string, updates: Partial<Pick<Task, 'title'|'description'|'owner'|'status'>> & { priority?: Priority }) =>
    send<{ success: true; task: Task }>('PATCH', `/api/tasks/${taskId}`, updates),

  analyzeTranscript: (meetingId: string) =>
    send<{ success: boolean; aiUnavailable?: boolean; suggestions: SuggestedTask[]; usedAI: boolean; error?: string }>('POST', '/api/ai/analyze-transcript', { meetingId, persist: true }),
  summarizeMeeting: (meetingId: string) =>
    send<{ success: boolean; aiUnavailable?: boolean; summary: string; decisions: string[]; highlights: string[]; risks: string[]; usedAI: boolean; error?: string }>('POST', '/api/ai/summarize-meeting', { meetingId, persist: true }),

  syncMeetingToZoom: (meetingId: string) =>
    send<{ success: true; meetingId: string; synced: number; results: Array<{ taskId: string; ok: boolean; zoomTaskId?: string; error?: string }> }>('POST', '/api/zoom-tasks/sync', { meetingId }),

  /**
   * Legacy /api/meeting-tasks returns every series, instance, and task in
   * one call — convenient for stub pages that need a flat list across all
   * meetings without N+1 fetches.
   */
  listAllMeetingTasks: () =>
    get<{
      success: true;
      summary: { total: number; open: number; inProgress: number; completed: number };
      series:    Array<{ id: string; title: string; description?: string; recurrence?: string; participants?: string[] }>;
      instances: Array<{ id: string; seriesId: string; title: string; date: string }>;
      tasks:     Task[];
    }>('/api/meeting-tasks'),

  listActiveRtmsSessions: () =>
    get<{ success: true; sessions: ActiveRtmsSession[] }>('/api/rtms/active'),

  startTestStream: () =>
    send<{ success: true; meetingId: string; segmentCount: number; durationMs: number; viewUrl: string }>('POST', '/api/rtms/test-stream'),

  /** URL the browser can open with EventSource to receive live transcript events. */
  transcriptStreamUrl: (meetingId: string) =>
    `/api/meetings/${eid(meetingId)}/transcript-stream`,

  // ── AI Actions (Observe → Recommend → Approve → Execute) ──────────────────

  getPrimaryAiActionsMeeting: () =>
    get<{ success: true; meetingId: string | null }>('/api/ai-actions/primary-meeting'),

  getAiActions: (meetingId: string) =>
    get<{
      success: true;
      meetingId: string;
      meetingTitle: string;
      observations: { hasAny: boolean; lines: string[] };
      signals: Record<string, number | boolean>;
      suggestedActions: Array<{ id: string; title: string; reasons: string[]; signals: Record<string, number | boolean>; cta: string }>;
    }>(`/api/meetings/${eid(meetingId)}/ai-actions`),

  previewAiAction: (meetingId: string, actionId: string) =>
    send<{ success: true; meetingId: string; markdown: string; usedAI: boolean; warning?: string }>(
      'POST',
      `/api/meetings/${eid(meetingId)}/ai-actions/preview`,
      { actionId },
    ),

  // Inlined fetch because the 401 (auth-required) response carries a useful
  // body — we want the UI to read `authStartUrl` instead of throwing on !ok.
  createFollowUpDoc: async (meetingId: string, opts: { markdown: string; title?: string }) => {
    const res = await fetch(url(`/api/meetings/${eid(meetingId)}/ai-actions/create-doc`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(opts),
      cache:   'no-store',
    });
    const body = await res.json().catch(() => ({}));
    return body as
      | { success: true; doc: { id: string; meetingId: string; title: string; fileId: string | null; fileLink: string | null; createdAt: string; sharedToChat: boolean; actor: string } }
      | { success: false; authRequired?: boolean; authStartUrl?: string; error: string };
  },

  listFollowUpDocs: (meetingId: string) =>
    get<{ success: true; meetingId: string; docs: Array<{ id: string; title: string; fileLink: string | null; createdAt: string; sharedToChat: boolean }> }>(
      `/api/meetings/${eid(meetingId)}/follow-up-docs`,
    ),

  markFollowUpDocShared: (meetingId: string, docId: string) =>
    send<{ success: true; doc: { id: string; sharedToChat: boolean } }>(
      'POST',
      `/api/meetings/${eid(meetingId)}/follow-up-docs/${docId}/shared`,
    ),

  // ── In-client OAuth (Zoom Apps SDK authorize / onAuthorized) ──────────────

  startInClientAuth: () =>
    send<
      | { success: true; alreadySignedIn: true }
      | { success: true; state: string; codeChallenge: string; codeChallengeMethod: 'plain' }
    >('POST', '/auth/in-client/start'),

  completeInClientAuth: (payload: { code: string; state: string }) =>
    send<{ success: true } | { success: false; error: string }>('POST', '/auth/in-client/callback', payload),
};
