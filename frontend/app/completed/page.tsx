import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Card, CardBody, CardHeader, Badge } from '@/components/Card';

export const dynamic = 'force-dynamic';

export default async function CompletedTasksPage() {
  const { tasks, instances } = await api.listAllMeetingTasks();
  const meetingById = Object.fromEntries(instances.map(m => [m.id, m]));
  const done = tasks
    .filter(t => t.status === 'completed')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Completed</h1>
        <p className="mt-1 text-sm text-ink-500">Finished tasks across all meetings, most recent first.</p>
      </header>

      <Card>
        <CardHeader
          title={`${done.length} completed task${done.length === 1 ? '' : 's'}`}
          subtitle="Includes manual completions and tasks auto-completed by the keyword-match transcript pipeline"
        />
        <CardBody className="-mx-5 -my-4">
          {done.length === 0 ? (
            <div className="px-5 py-6 text-sm text-ink-500">No completed tasks yet.</div>
          ) : (
            <ul className="divide-y divide-ink-200">
              {done.map(t => {
                const meeting = t.meetingInstanceId ? meetingById[t.meetingInstanceId] : null;
                return (
                  <li key={t.id} className="px-5 py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink-900 line-through decoration-ink-300">{t.title}</div>
                      <div className="text-xs text-ink-500 mt-1 flex flex-wrap gap-x-3">
                        <span>Owner: <strong className="text-ink-700">{t.owner ?? 'Unassigned'}</strong></span>
                        {meeting && (
                          <Link href={`/meetings/${encodeURIComponent(meeting.id)}`} className="text-zoom-dark hover:underline">
                            {meeting.title}
                          </Link>
                        )}
                        {t.completedAt && <span>Completed {formatDate(t.completedAt)}</span>}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {t.source === 'rtms_transcript'
                        ? <Badge tone="ai">Auto from transcript</Badge>
                        : <Badge tone="success">Completed</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 10);
  }
}
