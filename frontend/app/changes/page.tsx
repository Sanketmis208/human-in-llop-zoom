import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Card, CardBody, CardHeader, Badge } from '@/components/Card';
import type { MeetingContext, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

type ChangeSet = Awaited<ReturnType<typeof api.getChanges>>['changes'];

interface SeriesView {
  seriesId: string;
  fromMeeting: MeetingContext;
  changes: ChangeSet;
}

export default async function WhatChangedPage() {
  const { meetings } = await api.listMeetings();

  // Group meetings by series, sort each series oldest-first. For each series
  // with at least two meetings, ask the backend what changed since the oldest
  // one — that surfaces everything the later meetings did.
  const bySeries = new Map<string, MeetingContext[]>();
  for (const m of meetings) {
    const key = m.seriesId ?? '__no_series__';
    if (!bySeries.has(key)) bySeries.set(key, []);
    bySeries.get(key)!.push(m);
  }
  for (const list of bySeries.values()) {
    list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  }

  const sections: SeriesView[] = [];
  for (const [seriesId, list] of bySeries) {
    if (list.length < 2) continue;       // need ≥2 meetings to have anything to diff
    const fromMeeting = list[0];
    const { changes } = await api.getChanges(fromMeeting.id);
    sections.push({ seriesId, fromMeeting, changes });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">What changed</h1>
        <p className="mt-1 text-sm text-ink-500">
          Diff between meetings in a series — completed work, new tasks, fresh decisions, new risks.
        </p>
      </header>

      {sections.length === 0 && (
        <Card><CardBody className="text-sm text-ink-500">
          No series has two or more meetings yet. Run a second meeting in any series to see a diff here.
        </CardBody></Card>
      )}

      {sections.map(({ seriesId, fromMeeting, changes }) => (
        <Card key={seriesId}>
          <CardHeader
            title={`Series ${seriesId}`}
            subtitle={`Changes since ${fromMeeting.title} (${formatDate(fromMeeting.date)})`}
          />
          <CardBody className="space-y-5">
            <ChangeGroup
              title="Completed work"
              tone="success"
              empty="Nothing has been completed since then."
            >
              {changes.completed.map(t => (
                <TaskLine key={t.id} task={t} accent="completed" />
              ))}
            </ChangeGroup>

            <ChangeGroup
              title="Newly opened"
              tone="warning"
              empty="No new tasks have been opened."
            >
              {changes.newlyOpen.map(t => (
                <TaskLine key={t.id} task={t} accent="open" />
              ))}
            </ChangeGroup>

            <ChangeGroup
              title="New decisions"
              tone="ai"
              empty="No new decisions recorded."
            >
              {changes.newDecisions.map((d, i) => (
                <div key={i} className="text-sm text-ink-700 flex gap-2">
                  <span className="text-ink-500">•</span>
                  <span>{d.decision} <span className="text-xs text-ink-500">(from {d.meetingId})</span></span>
                </div>
              ))}
            </ChangeGroup>

            <ChangeGroup
              title="New risks"
              tone="danger"
              empty="No new risks raised."
            >
              {changes.newRisks.map((r, i) => (
                <div key={i} className="text-sm text-rose-700 flex gap-2">
                  <span className="text-ink-500">•</span>
                  <span>{r.risk} <span className="text-xs text-ink-500">(from {r.meetingId})</span></span>
                </div>
              ))}
            </ChangeGroup>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

// ── Local rendering helpers ─────────────────────────────────────────────────

function ChangeGroup({
  title, tone, empty, children,
}: {
  title: string;
  tone: 'success' | 'warning' | 'danger' | 'ai';
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : children ? [children] : [];
  const isEmpty = items.length === 0;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="text-xs text-ink-500">{isEmpty ? '0' : items.length}</span>
      </div>
      {isEmpty
        ? <div className="text-xs text-ink-500 italic">{empty}</div>
        : <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function TaskLine({ task, accent }: { task: Task; accent: 'completed' | 'open' }) {
  return (
    <div className="text-sm flex gap-2 items-start">
      <span className="text-ink-500">•</span>
      <div className="flex-1 min-w-0">
        <span className={accent === 'completed' ? 'text-ink-700 line-through decoration-ink-300' : 'text-ink-900'}>
          {task.title}
        </span>
        <span className="text-xs text-ink-500 ml-2">{task.owner ?? 'Unassigned'}</span>
        {task.meetingInstanceId && (
          <Link href={`/meetings/${encodeURIComponent(task.meetingInstanceId)}`} className="text-xs text-zoom-dark hover:underline ml-2">
            {task.meetingInstanceId}
          </Link>
        )}
      </div>
    </div>
  );
}

function formatDate(iso?: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}
