'use client';

import { Card, CardBody, CardHeader, Badge } from './Card';
import { useZoomAppSdk, type RtmsState } from '@/lib/use-zoom-app-sdk';

/**
 * RTMS control panel rendered inside the Zoom App side panel during a meeting.
 *
 * All SDK detection and state management lives in useZoomAppSdk(). This
 * component is purely the rendering layer: it picks the right card based on
 * the current phase and wires buttons to hook actions.
 */
export function RtmsControls() {
  const sdk = useZoomAppSdk();

  if (sdk.phase === 'detecting') {
    return <Card><CardBody>Initializing Zoom Apps SDK…</CardBody></Card>;
  }

  if (sdk.phase === 'browser') {
    return (
      <Card>
        <CardHeader title="RTMS controls" subtitle="Open this page inside the Zoom App (in a meeting) to start RTMS." />
        <CardBody className="text-sm text-ink-500">
          You're viewing in a regular browser. The Zoom Apps SDK is only available when this page is loaded by the Zoom client.
        </CardBody>
      </Card>
    );
  }

  if (sdk.phase === 'error') {
    return (
      <Card className="border-rose-300">
        <CardHeader title="RTMS controls — SDK config failed" />
        <CardBody className="text-sm text-rose-700">{sdk.error}</CardBody>
      </Card>
    );
  }

  // phase === 'ready' but the user is in a non-meeting in-client surface
  // (e.g., Apps tab, Team Chat tab). RTMS only operates inside meetings.
  if (!sdk.isInMeeting) {
    return (
      <Card>
        <CardHeader
          title="RTMS controls"
          subtitle={`In-client context: ${sdk.context}. Start RTMS is only available inside a meeting.`}
        />
        <CardBody className="text-sm text-ink-500">
          Start a meeting, then open this app from the meeting's Apps panel.
        </CardBody>
      </Card>
    );
  }

  // phase === 'ready' AND in a meeting
  return (
    <Card>
      <CardHeader
        title="RTMS controls"
        subtitle={sdk.meetingId ? `Meeting ${sdk.meetingId}` : `Context: ${sdk.context}`}
        action={<Badge tone={badgeTone(sdk.rtmsState)}>{sdk.rtmsState}</Badge>}
      />
      <CardBody className="space-y-3">
        {sdk.error && (
          <div className="text-sm text-rose-700">
            {sdk.error}
            <button className="underline ml-2" onClick={sdk.dismissError}>dismiss</button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            label="Start RTMS" busyLabel="Starting…"
            tone="primary"
            disabled={!!sdk.busy || sdk.rtmsState === 'STARTED'}
            busy={sdk.busy === 'start'}
            onClick={sdk.startRtms}
          />
          <Button
            label="Pause" busyLabel="Pausing…"
            tone="ghost"
            disabled={!!sdk.busy || sdk.rtmsState !== 'STARTED'}
            busy={sdk.busy === 'pause'}
            onClick={sdk.pauseRtms}
          />
          <Button
            label="Resume" busyLabel="Resuming…"
            tone="ghost"
            disabled={!!sdk.busy || sdk.rtmsState !== 'PAUSED'}
            busy={sdk.busy === 'resume'}
            onClick={sdk.resumeRtms}
          />
          <Button
            label="Stop" busyLabel="Stopping…"
            tone="danger"
            disabled={!!sdk.busy || sdk.rtmsState === 'STOPPED'}
            busy={sdk.busy === 'stop'}
            onClick={sdk.stopRtms}
          />
        </div>
        <p className="text-xs text-ink-500">
          Clicking Start RTMS asks the Zoom client to begin streaming this meeting. Zoom then fires <code className="font-mono">meeting.rtms_started</code> to your webhook, and the live transcript begins flowing here.
        </p>
      </CardBody>
    </Card>
  );
}

// ── Local rendering helpers ─────────────────────────────────────────────────

function badgeTone(state: RtmsState): 'success' | 'warning' | 'default' {
  if (state === 'STARTED') return 'success';
  if (state === 'PAUSED')  return 'warning';
  return 'default';
}

interface ButtonProps {
  label:     string;
  busyLabel: string;
  tone:      'primary' | 'ghost' | 'danger';
  disabled:  boolean;
  busy:      boolean;
  onClick:   () => void;
}

function Button({ label, busyLabel, tone, disabled, busy, onClick }: ButtonProps) {
  const styles = {
    primary: 'bg-emerald-600 text-white font-medium hover:bg-emerald-700',
    ghost:   'border border-ink-300 text-ink-700 hover:bg-ink-50',
    danger:  'border border-rose-300 text-rose-700 hover:bg-rose-50',
  }[tone];
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded text-sm px-4 py-2 disabled:opacity-50 ${styles}`}
    >
      {busy ? busyLabel : label}
    </button>
  );
}
