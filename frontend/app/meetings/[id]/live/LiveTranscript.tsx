'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import type { TranscriptSegment } from '@/lib/types';
import { Card, CardBody, CardHeader, Badge } from '@/components/Card';

type Status = 'connecting' | 'live' | 'paused' | 'stopped' | 'error' | 'disconnected';

interface FeedItem {
  key: string;
  speaker: string;
  text: string;
  ts: string;
}

export function LiveTranscript({ meetingId }: { meetingId: string }) {
  const [status, setStatus]     = useState<Status>('connecting');
  const [segments, setSegments] = useState<FeedItem[]>([]);
  const [participants, setParticipants] = useState<Record<string, string>>({});
  const [analyzed, setAnalyzed] = useState<{ suggestionCount: number; summarized: boolean } | null>(null);

  // Auto-scroll to latest segment unless the user has scrolled up.
  const feedRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    const url = api.transcriptStreamUrl(meetingId);
    const es = new EventSource(url);

    es.addEventListener('connected', () => setStatus('connecting'));

    es.addEventListener('transcript.snapshot', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        const items: FeedItem[] = (data.segments ?? []).map((s: TranscriptSegment, i: number) => ({
          key: `snap-${s.seqNo ?? i}`,
          speaker: s.speakerLabel ?? 'Participant',
          text: s.text,
          ts: new Date(s.tStartMs ?? Date.now()).toLocaleTimeString(),
        }));
        setSegments(items);
        if (items.length > 0) setStatus('live');
      } catch { /* ignore */ }
    });

    es.addEventListener('transcript.segment', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        const s: TranscriptSegment = data.segment;
        setSegments(prev => [
          ...prev,
          {
            key: `${s.seqNo ?? Date.now()}-${prev.length}`,
            speaker: s.speakerLabel ?? 'Participant',
            text: s.text,
            ts: new Date(s.tStartMs ?? Date.now()).toLocaleTimeString(),
          },
        ]);
        setStatus('live');
      } catch { /* ignore */ }
    });

    es.addEventListener('meeting.status', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (data.status === 'active' || data.status === 'live') setStatus('live');
        else if (data.status === 'paused')  setStatus('paused');
        else if (data.status === 'stopped') setStatus('stopped');
        else if (data.status === 'error')   setStatus('error');
      } catch { /* ignore */ }
    });

    es.addEventListener('participant.event', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        const next = { ...participants };
        for (const p of data.participants ?? []) {
          if (p?.userId) next[p.userId] = p.userName ?? 'Participant';
        }
        setParticipants(next);
      } catch { /* ignore */ }
    });

    es.addEventListener('meeting.analyzed', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        setAnalyzed({ suggestionCount: data.suggestionCount ?? 0, summarized: !!data.summarized });
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; surface the gap to the user.
      setStatus(prev => prev === 'stopped' ? 'stopped' : 'disconnected');
    };

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // Auto-scroll handling.
  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments]);

  function onScroll() {
    const el = feedRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    autoScrollRef.current = atBottom;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Transcript"
          subtitle={`${segments.length} segment${segments.length === 1 ? '' : 's'}`}
          action={<StatusBadge status={status} />}
        />
        <CardBody className="-mx-5 -my-4 @container/transcript">
          <div
            ref={feedRef}
            onScroll={onScroll}
            className="max-h-[60vh] @md/transcript:max-h-[70vh] overflow-y-auto px-5 py-4 space-y-3"
          >
            {segments.length === 0 && (
              <p className="text-sm text-ink-500">
                Waiting for the first transcript segment. If RTMS is active, segments will appear here as participants speak.
              </p>
            )}
            {segments.map(item => (
              // Stack speaker label above text on narrow widths; inline on wider.
              <div key={item.key} className="flex flex-col @md/transcript:flex-row @md/transcript:gap-3">
                <div className="flex items-baseline gap-2 @md/transcript:gap-0">
                  <span className="shrink-0 text-xs text-ink-500 tabular-nums @md/transcript:w-16">{item.ts}</span>
                  <span
                    className="shrink-0 text-xs font-medium text-zoom-dark @md/transcript:w-32 truncate"
                    title={item.speaker}
                  >
                    {item.speaker}
                  </span>
                </div>
                <span className="text-sm text-ink-900 break-words">{item.text}</span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {Object.keys(participants).length > 0 && (
        <Card>
          <CardHeader title={`Participants (${Object.keys(participants).length})`} />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {Object.entries(participants).map(([id, name]) => (
                <Badge key={id}>{name}</Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {analyzed && (
        <Card>
          <CardHeader title="Post-meeting AI" subtitle="Triggered when the meeting RTMS session stopped" />
          <CardBody className="text-sm text-ink-700">
            {analyzed.suggestionCount} task suggestion{analyzed.suggestionCount === 1 ? '' : 's'} generated
            {analyzed.summarized ? ' • summary written' : ''}.{' '}
            <a className="text-zoom-dark underline" href="/suggestions">Review them →</a>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; tone: 'success' | 'warning' | 'danger' | 'default' }> = {
    connecting:   { label: 'Connecting…', tone: 'warning' },
    live:         { label: 'LIVE',        tone: 'success' },
    paused:       { label: 'Paused',      tone: 'warning' },
    stopped:      { label: 'Stopped',     tone: 'default' },
    error:        { label: 'Error',       tone: 'danger'  },
    disconnected: { label: 'Reconnecting…', tone: 'warning' },
  };
  const { label, tone } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}
