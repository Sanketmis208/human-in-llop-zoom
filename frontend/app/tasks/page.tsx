import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Card, CardBody, CardHeader, Badge } from '@/components/Card';
import type { Priority } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function OpenTasksPage() {
  const { tasks, instances } = await api.listAllMeetingTasks();
  const meetingById = Object.fromEntries(instances.map(m => [m.id, m]));
  const open = tasks
    .filter(t => t.status === 'open' || t.status === 'in_progress')
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Open tasks</h1>
        <p className="mt-1 text-sm text-ink-500">
          Active work surfaced from approved suggestions and existing meeting tasks, sorted by due date.
        </p>
      </header>

      <Card>
        <CardHeader
          title={`${open.length} open${open.length === 1 ? '' : ''} ${open.length === 1 ? 'task' : 'tasks'}`}
          subtitle="Includes both `open` and `in_progress` statuses across all meetings"
        />
        <CardBody className="-mx-5 -my-4">
          {open.length === 0 ? (
            <div className="px-5 py-6 text-sm text-ink-500">Nothing open. Everything's done.</div>
          ) : (
            <ul className="divide-y divide-ink-200">
              {open.map(t => {
                const meeting = t.meetingInstanceId ? meetingById[t.meetingInstanceId] : null;
                return (
                  <li key={t.id} className="px-5 py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink-900">{t.title}</div>
                      {t.description && (
                        <div className="text-xs text-ink-500 mt-0.5 line-clamp-1">{t.description}</div>
                      )}
                      <div className="text-xs text-ink-500 mt-1 flex flex-wrap gap-x-3">
                        <span>Owner: <strong className="text-ink-700">{t.owner ?? 'Unassigned'}</strong></span>
                        {meeting && (
                          <Link href={`/meetings/${encodeURIComponent(meeting.id)}`} className="text-zoom-dark hover:underline">
                            {meeting.title}
                          </Link>
                        )}
                        {t.dueDate && <span>Due: {t.dueDate.slice(0, 10)}</span>}
                        {t.source === 'ai_suggestion' && <Badge tone="ai">From AI</Badge>}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <Badge tone={t.status === 'in_progress' ? 'warning' : 'default'}>
                        {t.status.replace('_', ' ')}
                      </Badge>
                      {t.priority && (
                        <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                      )}
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

function priorityTone(p: Priority): 'default' | 'warning' | 'danger' {
  if (p === 'High')   return 'danger';
  if (p === 'Medium') return 'warning';
  return 'default';
}
