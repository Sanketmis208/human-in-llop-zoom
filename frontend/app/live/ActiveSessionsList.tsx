'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import type { ActiveRtmsSession } from '@/lib/types';
import { Card, CardBody, CardHeader, Badge } from '@/components/Card';

const POLL_MS_VISIBLE = 10_000;  // poll every 10s when the tab is visible
const POLL_MS_HIDDEN  = 60_000;  // back off to 60s when the tab is in the background

export function ActiveSessionsList() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ActiveRtmsSession[]>([]);
  const [loaded, setLoaded]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function startTestStream() {
    setTesting(true);
    try {
      const r = await api.startTestStream();
      // Navigate to the synthetic meeting's live view; segments will arrive
      // via SSE over the next ~14 seconds.
      router.push(r.viewUrl);
    } catch (e) {
      setError((e as Error).message);
      setTesting(false);
    }
  }

  useEffect(() => {
    let alive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      try {
        const { sessions } = await api.listActiveRtmsSessions();
        if (alive) { setSessions(sessions); setError(null); setLoaded(true); }
      } catch (e) {
        if (alive) { setError((e as Error).message); setLoaded(true); }
      }
    }

    function schedule(ms: number) {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(tick, ms);
    }

    function onVisibility() {
      if (document.hidden) schedule(POLL_MS_HIDDEN);
      else { tick(); schedule(POLL_MS_VISIBLE); }
    }

    tick();
    schedule(POLL_MS_VISIBLE);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!loaded) return <Card><CardBody>Loading active sessions…</CardBody></Card>;

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-rose-300">
          <CardBody className="text-sm text-rose-700">
            {error}
            <button className="ml-3 underline" onClick={() => setError(null)}>dismiss</button>
          </CardBody>
        </Card>
      )}

      {sessions.length === 0 ? (
        <Card>
          <CardHeader title="No live meetings" subtitle="When Zoom sends a meeting.rtms_started event, that meeting will appear here within a few seconds." />
          <CardBody className="text-xs text-ink-500">
            Polling /api/rtms/active every {POLL_MS_VISIBLE / 1000}s (60s when tab hidden).
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`Active sessions (${sessions.length})`}
            action={<Badge tone="success">LIVE</Badge>}
          />
          <CardBody className="divide-y divide-ink-200 -mx-5 -my-4">
            {sessions.map(s => (
              <Link
                key={s.meetingUuid}
                href={`/meetings/${encodeURIComponent(s.meetingUuid)}/live`}
                className="flex items-center justify-between px-5 py-4 hover:bg-ink-50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-900 truncate">{s.meetingUuid}</div>
                  <div className="text-xs text-ink-500 mt-0.5">
                    started {formatTime(s.startedAt)} • {s.transcriptSegments} segment{s.transcriptSegments === 1 ? '' : 's'}
                    {s.participants.length > 0 ? ` • ${s.participants.length} participant${s.participants.length === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
                <Badge tone={s.status === 'active' ? 'success' : 'warning'}>{s.status}</Badge>
              </Link>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Test stream"
          subtitle="Push a scripted demo transcript through the same broadcast bus that real RTMS uses. Useful for verifying the live UI without needing Zoom to fire meeting.rtms_started."
        />
        <CardBody>
          <button
            disabled={testing}
            onClick={startTestStream}
            className="rounded bg-zoom text-white text-sm font-medium px-4 py-2 hover:bg-zoom-dark disabled:opacity-50"
          >
            {testing ? 'Starting test stream…' : 'Start test stream'}
          </button>
          <p className="text-xs text-ink-500 mt-2">
            Creates a synthetic meeting and streams ~7 segments at 2s intervals. Opens the live view automatically.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function formatTime(t: string | number) {
  try {
    const d = typeof t === 'number' ? new Date(t) : new Date(t);
    return d.toLocaleTimeString();
  } catch {
    return String(t);
  }
}
