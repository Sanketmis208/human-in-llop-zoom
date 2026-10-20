import { LiveTranscript } from './LiveTranscript';

export const dynamic = 'force-dynamic';

export default async function MeetingLivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Live transcript</h1>
        <p className="mt-1 text-sm text-ink-500 break-all">{id}</p>
      </header>
      <LiveTranscript meetingId={id} />
    </div>
  );
}
