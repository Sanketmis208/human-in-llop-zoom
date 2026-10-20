import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Card, CardBody, CardHeader, Badge } from '@/components/Card';

export const dynamic = 'force-dynamic';

export default async function MeetingsListPage() {
  const { meetings } = await api.listMeetings();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Meetings</h1>
        <p className="mt-1 text-sm text-ink-500">Click a meeting to view full context, transcript highlights, and AI summary.</p>
      </header>
      <Card>
        <CardHeader title={`All meetings (${meetings.length})`} />
        <CardBody className="divide-y divide-ink-200 -mx-5 -my-4">
          {meetings.map(m => (
            <Link key={m.id} href={`/meetings/${encodeURIComponent(m.id)}`} className="flex items-center justify-between px-5 py-3 hover:bg-ink-50">
              <div>
                <div className="text-sm font-medium text-ink-900">{m.title}</div>
                <div className="text-xs text-ink-500 mt-0.5">{m.date} • {(m.participants ?? []).join(', ')}</div>
              </div>
              {m.summary ? <Badge tone="ai">AI summary</Badge> : <Badge>No summary</Badge>}
            </Link>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
