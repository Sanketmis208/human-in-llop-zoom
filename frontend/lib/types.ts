// Shared types for the AI task workflow frontend.
// Mirrors the shapes returned by routes/api-routes.js on the Express backend.

export type Priority = 'Low' | 'Medium' | 'High';
export type TaskStatus = 'open' | 'in_progress' | 'completed';
export type SuggestionStatus = 'pending' | 'approved' | 'rejected';

export interface SuggestedTask {
  id: string;
  meetingId: string | null;
  title: string;
  description: string;
  assignee: string | null;
  priority: Priority;
  dueDate: string | null;
  confidence: number;
  sourceExcerpt: string;
  status: SuggestionStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  approvedTaskId: string | null;
  rejectReason?: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  meetingSeriesId: string | null;
  meetingInstanceId: string | null;
  status: TaskStatus;
  owner: string | null;
  priority?: Priority;
  createdAt: string;
  dueDate: string | null;
  completedAt: string | null;
  source: string;
  suggestionId?: string;
  zoomTaskId?: string;
}

export interface MeetingContext {
  id: string;
  seriesId: string | null;
  title: string;
  date: string;
  participants: string[];
  summary: string;
  decisions: string[];
  highlights: string[];
  risks: string[];
  zoomMeetingUuid: string | null;
  transcript?: Array<{ ts: string; speaker: string; text: string }>;
  tasks?: Task[];
  suggestions?: SuggestedTask[];
}

export interface ActivityEvent {
  id: string;
  type: string;
  meetingId?: string;
  taskId?: string;
  suggestionId?: string;
  actor: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface DashboardSummary {
  success: true;
  tasks: { total: number; open: number; inProgress: number; completed: number };
  pendingSuggestionCount: number;
  recentMeetings: Array<{ id: string; title: string; date: string; hasSummary: boolean }>;
}

export interface ActiveRtmsSession {
  meetingUuid: string;
  status: 'active' | 'paused' | 'stopped' | 'error' | string;
  startedAt: string | number;
  participants: Array<{ userId?: string; userName?: string }>;
  transcriptSegments: number;
}

/** Wire format used by both the SSE stream and the buffered snapshot it sends on connect. */
export interface TranscriptSegment {
  speakerId?: string;
  speakerLabel?: string;
  text: string;
  seqNo?: number;
  tStartMs?: number;
  tEndMs?: number | null;
  confidence?: number | null;
}
