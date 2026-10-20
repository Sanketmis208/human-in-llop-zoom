import { api } from '@/lib/api-client';
import { Card, CardBody, CardHeader, Badge } from '@/components/Card';

export const dynamic = 'force-dynamic';

export default async function MeetingContextPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let meeting;
  try {
    const r = await api.getMeeting(id);
    meeting = r.meeting;
  } catch (err) {
    return (
      <Card>
        <CardBody className="text-rose-700">Meeting not found: {(err as Error).message}</CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">{meeting.title}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {new Date(meeting.date).toLocaleString()} • {meeting.participants.join(', ')}
        </p>
      </header>

      <Card>
        <CardHeader title="AI summary" />
        <CardBody>
          {meeting.summary
            ? <p className="text-sm text-ink-700">{meeting.summary}</p>
            : <p className="text-sm text-ink-500">No summary yet. POST /api/ai/summarize-meeting with this meetingId to generate one.</p>}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 @xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Decisions" />
          <CardBody>
            {meeting.decisions.length === 0 && <p className="text-sm text-ink-500">None recorded.</p>}
            <ul className="space-y-1 text-sm text-ink-700">
              {meeting.decisions.map((d, i) => <li key={i}>• {d}</li>)}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Risks" />
          <CardBody>
            {meeting.risks.length === 0 && <p className="text-sm text-ink-500">None.</p>}
            <ul className="space-y-1 text-sm text-rose-700">
              {meeting.risks.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Suggestions"
          subtitle="AI-detected follow-ups from this meeting"
          action={<Badge tone="ai">{(meeting.suggestions ?? []).filter(s => s.status === 'pending').length} pending</Badge>}
        />
        <CardBody className="divide-y divide-ink-200 -mx-5 -my-4">
          {(meeting.suggestions ?? []).length === 0 && (
            <div className="px-5 py-4 text-sm text-ink-500">No suggestions for this meeting.</div>
          )}
          {(meeting.suggestions ?? []).map(s => (
            <div key={s.id} className="px-5 py-3">
              <div className="flex justify-between items-start">
                <div className="text-sm font-medium text-ink-900">{s.title}</div>
                <Badge tone={s.status === 'pending' ? 'warning' : s.status === 'approved' ? 'success' : 'default'}>{s.status}</Badge>
              </div>
              <div className="text-xs text-ink-500 mt-0.5">{s.assignee ?? 'Unassigned'} • conf {Math.round(s.confidence*100)}%</div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Transcript" subtitle={`${(meeting.transcript ?? []).length} segments`} />
        <CardBody className="space-y-2 text-sm text-ink-700 max-h-96 overflow-y-auto">
          {(meeting.transcript ?? []).map((seg, i) => (
            <div key={i}>
              <span className="text-xs text-ink-500">{seg.speaker}:</span>{' '}
              {seg.text}
            </div>
          ))}
          {(meeting.transcript ?? []).length === 0 && <p className="text-ink-500">No transcript captured for this meeting.</p>}
        </CardBody>
      </Card>
    </div>
  );
}
