'use client';

/**
 * AIActions — Observe → Recommend → Approve → Execute.
 *
 * The user can:
 *   1. Pick a meeting (or accept the system-recommended one)
 *   2. See "Observations" — what the system noticed about the meeting
 *   3. Approve a suggested action (currently: Create Meeting Follow-up Doc)
 *   4. Preview the generated Markdown
 *   5. Approve → backend creates a Zoom Doc via OpenAI Responses API + Zoom MCP
 *   6. Optionally share the doc link back to Zoom chat via the Apps SDK
 *
 * The AI never mutates state autonomously — every step is gated by a button.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { Card, CardHeader, CardBody, Badge } from '@/components/Card';
import { useZoomAppSdk } from '@/lib/use-zoom-app-sdk';
import type { MeetingContext } from '@/lib/types';

type AiActionsResponse = Awaited<ReturnType<typeof api.getAiActions>>;
type DocRecord         = { id: string; title: string; fileLink: string | null; createdAt: string; sharedToChat: boolean };

export function AIActions() {
  const sdk = useZoomAppSdk();

  // Meeting picker --------------------------------------------------------
  const [meetings,  setMeetings]  = useState<MeetingContext[]>([]);
  const [meetingId, setMeetingId] = useState<string>('');
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, primary] = await Promise.all([
          api.listMeetings(),
          api.getPrimaryAiActionsMeeting(),
        ]);
        if (cancelled) return;
        setMeetings(list.meetings);
        const initial = primary.meetingId ?? list.meetings[0]?.id ?? '';
        setMeetingId(initial);
      } catch (e) {
        if (!cancelled) setBootError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Per-meeting AI Actions state -----------------------------------------
  const [actions,    setActions]    = useState<AiActionsResponse | null>(null);
  const [actionsErr, setActionsErr] = useState<string | null>(null);
  const [docs,       setDocs]       = useState<DocRecord[]>([]);

  const refresh = useCallback(async (id: string) => {
    if (!id) { setActions(null); setDocs([]); return; }
    setActionsErr(null);
    try {
      const [a, d] = await Promise.all([api.getAiActions(id), api.listFollowUpDocs(id)]);
      setActions(a);
      setDocs(d.docs);
    } catch (e) {
      setActionsErr((e as Error).message);
    }
  }, []);

  useEffect(() => { refresh(meetingId); }, [meetingId, refresh]);

  // Preview / Create / Share lifecycle -----------------------------------
  const [phase, setPhase]       = useState<'idle' | 'previewing' | 'preview-ready' | 'creating' | 'authorizing' | 'created' | 'sharing'>('idle');
  const [preview, setPreview]   = useState<{ markdown: string; usedAI: boolean; warning?: string } | null>(null);
  const [editedMd, setEditedMd] = useState<string>('');
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [createdDoc, setCreatedDoc] = useState<{ id: string; title: string; fileLink: string | null } | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const onPreview = async () => {
    if (!meetingId) return;
    setPhase('previewing');
    setCreateErr(null);
    setCreatedDoc(null);
    setShareNote(null);
    try {
      const p = await api.previewAiAction(meetingId, 'create-follow-up-doc');
      setPreview({ markdown: p.markdown, usedAI: p.usedAI, warning: p.warning });
      setEditedMd(p.markdown);
      setPhase('preview-ready');
    } catch (e) {
      setCreateErr((e as Error).message);
      setPhase('idle');
    }
  };

  const onCreate = async () => {
    if (!meetingId || !editedMd.trim()) return;
    setPhase('creating');
    setCreateErr(null);

    const title = actions ? `${actions.meetingTitle} — Follow-up` : undefined;
    let result = await api.createFollowUpDoc(meetingId, { markdown: editedMd, title });

    // Auth path: if the backend says we need a Zoom user token and the Apps
    // SDK is available, run the in-client OAuth flow and retry once.
    if (!result.success && 'authRequired' in result && result.authRequired && sdk.phase === 'ready') {
      setPhase('authorizing');
      const authResult = await sdk.startInClientAuth();
      if (!authResult.ok) {
        setCreateErr(`In-client sign-in failed: ${authResult.reason}`);
        setPhase('preview-ready');
        return;
      }
      setPhase('creating');
      result = await api.createFollowUpDoc(meetingId, { markdown: editedMd, title });
    }

    if (!result.success) {
      if ('authRequired' in result && result.authRequired) {
        // SDK not ready (browser surface) — fall back to the redirect-style flow.
        setCreateErr(`${result.error} Click "Sign in with Zoom" below to authenticate.`);
      } else {
        setCreateErr(result.error ?? 'Failed to create Zoom Doc.');
      }
      setPhase('preview-ready');
      return;
    }

    setCreatedDoc({ id: result.doc.id, title: result.doc.title, fileLink: result.doc.fileLink });
    setPhase('created');
    refresh(meetingId);
  };

  const onShareToChat = async () => {
    if (!createdDoc || !meetingId) return;
    setPhase('sharing');
    setShareNote(null);

    const message = createdDoc.fileLink
      ? `Follow-up doc for our meeting: ${createdDoc.title}\n${createdDoc.fileLink}`
      : `Follow-up doc created: ${createdDoc.title}`;

    const sdkResult = await sdk.sendMessageToChat(message);
    if (!sdkResult.ok) {
      setShareNote(sdkResult.reason);
      setPhase('created');
      return;
    }

    try {
      await api.markFollowUpDocShared(meetingId, createdDoc.id);
      setShareNote('Shared to your current Zoom chat.');
      refresh(meetingId);
    } catch {
      setShareNote('Shared, but couldn\'t record it server-side.');
    }
    setPhase('created');
  };

  const reset = () => {
    setPhase('idle');
    setPreview(null);
    setEditedMd('');
    setCreatedDoc(null);
    setCreateErr(null);
    setShareNote(null);
  };

  // Rendering -------------------------------------------------------------

  const meetingTitle = useMemo(
    () => meetings.find(m => m.id === meetingId)?.title ?? actions?.meetingTitle ?? '',
    [meetings, meetingId, actions?.meetingTitle],
  );

  if (bootError) {
    return (
      <Card>
        <CardBody>
          <h3 className="text-sm font-semibold text-rose-700">Could not load meetings</h3>
          <p className="text-sm text-ink-700 mt-1">{bootError}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-ink-900">AI Actions</h2>
        <p className="mt-1 text-sm text-ink-500">
          Proactive recommendations the AI surfaces based on meeting context.
          Every action requires your explicit approval before it runs.
        </p>
      </header>

      <Card>
        <CardHeader title="Meeting" subtitle="Pick which meeting to act on. The first option is the system's best guess." />
        <CardBody>
          {meetings.length === 0 ? (
            <p className="text-sm text-ink-500">No meetings yet. Capture a meeting via RTMS first.</p>
          ) : (
            <select
              value={meetingId}
              onChange={(e) => { setMeetingId(e.target.value); reset(); }}
              className="block w-full rounded border border-ink-300 px-3 py-2 text-sm"
            >
              {meetings.map(m => (
                <option key={m.id} value={m.id}>
                  {m.title} — {m.date ? new Date(m.date).toLocaleDateString() : 'no date'}
                </option>
              ))}
            </select>
          )}
        </CardBody>
      </Card>

      {actionsErr && (
        <Card>
          <CardBody>
            <p className="text-sm text-rose-700">{actionsErr}</p>
          </CardBody>
        </Card>
      )}

      {actions && (
        <>
          <ObservationsBanner observations={actions.observations} signals={actions.signals} />

          {actions.suggestedActions.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-ink-500">
                  No actions to suggest yet for <span className="font-medium text-ink-700">{meetingTitle}</span>.
                  Once the meeting has approved tasks, AI-extracted suggestions, decisions, blockers, or a summary,
                  a follow-up doc will be recommended here.
                </p>
              </CardBody>
            </Card>
          ) : (
            actions.suggestedActions.map(a => (
              <SuggestedActionCard
                key={a.id}
                title={a.title}
                reasons={a.reasons}
                cta={a.cta}
                disabled={phase !== 'idle' && phase !== 'preview-ready'}
                onClick={onPreview}
                inFlight={phase === 'previewing'}
              />
            ))
          )}
        </>
      )}

      {phase !== 'idle' && (
        <PreviewBlock
          phase={phase}
          markdown={editedMd}
          onEdit={setEditedMd}
          aiBadge={preview?.usedAI ?? false}
          warning={preview?.warning}
          createError={createErr}
          createdDoc={createdDoc}
          shareNote={shareNote}
          sdkPhase={sdk.phase}
          onCancel={reset}
          onCreate={onCreate}
          onShareToChat={onShareToChat}
        />
      )}

      {docs.length > 0 && (
        <Card>
          <CardHeader title="Follow-up docs for this meeting" subtitle="Already created via this flow" />
          <CardBody className="space-y-2">
            {docs.map(d => (
              <div key={d.id} className="flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium text-ink-900">{d.title}</div>
                  <div className="text-xs text-ink-500">{new Date(d.createdAt).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-3">
                  {d.sharedToChat && <Badge tone="success">Shared</Badge>}
                  {d.fileLink && (
                    <a href={d.fileLink} target="_blank" rel="noreferrer" className="text-zoom-dark hover:underline">
                      Open ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ── child components ────────────────────────────────────────────────────────

function ObservationsBanner({ observations, signals }: { observations: { hasAny: boolean; lines: string[] }; signals: Record<string, number | boolean> }) {
  if (!observations.hasAny) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-ink-500">No observations yet for this meeting.</p>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card className="border-zoom/30 bg-zoom/5">
      <CardBody>
        <div className="flex items-start gap-3">
          <Badge tone="ai">AI observed</Badge>
          <div className="flex-1">
            <ul className="text-sm text-ink-800 list-disc list-inside space-y-0.5">
              {observations.lines.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
            <SignalsRow signals={signals} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function SignalsRow({ signals }: { signals: Record<string, number | boolean> }) {
  const numeric = Object.entries(signals).filter(([, v]) => typeof v === 'number' && v > 0) as [string, number][];
  if (numeric.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink-600">
      {numeric.map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1 rounded bg-white border border-ink-200 px-2 py-0.5">
          <span className="text-ink-500">{labelForSignal(k)}</span>
          <span className="font-medium text-ink-900">{v}</span>
        </span>
      ))}
    </div>
  );
}

function labelForSignal(key: string) {
  switch (key) {
    case 'approvedTaskCount':       return 'approved tasks';
    case 'pendingSuggestionCount':  return 'pending suggestions';
    case 'decisionCount':           return 'decisions';
    case 'riskCount':               return 'blockers / risks';
    default:                        return key;
  }
}

function SuggestedActionCard({ title, reasons, cta, disabled, onClick, inFlight }: {
  title: string; reasons: string[]; cta: string; disabled: boolean; onClick: () => void; inFlight: boolean;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle="Recommended next step" action={<Badge tone="ai">Suggested</Badge>} />
      <CardBody className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-500 mb-1">Why</div>
          <ul className="text-sm text-ink-800 list-disc list-inside space-y-0.5">
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="inline-flex items-center rounded bg-zoom text-white px-3 py-2 text-sm font-medium hover:bg-zoom-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {inFlight ? 'Generating preview…' : cta}
        </button>
      </CardBody>
    </Card>
  );
}

function PreviewBlock(props: {
  phase: 'idle' | 'previewing' | 'preview-ready' | 'creating' | 'authorizing' | 'created' | 'sharing';
  markdown: string;
  onEdit: (md: string) => void;
  aiBadge: boolean;
  warning?: string;
  createError: string | null;
  createdDoc: { id: string; title: string; fileLink: string | null } | null;
  shareNote: string | null;
  sdkPhase: string;
  onCancel: () => void;
  onCreate: () => void;
  onShareToChat: () => void;
}) {
  const { phase, markdown, onEdit, aiBadge, warning, createError, createdDoc, shareNote, sdkPhase, onCancel, onCreate, onShareToChat } = props;

  if (phase === 'previewing') {
    return <Card><CardBody><p className="text-sm text-ink-500">Generating preview…</p></CardBody></Card>;
  }

  return (
    <Card>
      <CardHeader
        title={createdDoc ? 'Zoom Doc created' : 'Preview before creating'}
        subtitle={createdDoc ? 'The doc is now in your Zoom Workplace.' : 'Edit anything you like before approving.'}
        action={aiBadge ? <Badge tone="ai">AI-generated</Badge> : <Badge>Built from data</Badge>}
      />
      <CardBody className="space-y-3">
        {warning && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            {warning}
          </p>
        )}

        {!createdDoc && (
          <>
            <textarea
              value={markdown}
              onChange={(e) => onEdit(e.target.value)}
              disabled={phase === 'creating' || phase === 'authorizing'}
              spellCheck={false}
              className="w-full h-72 font-mono text-xs rounded border border-ink-200 p-3 bg-ink-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zoom"
            />

            {phase === 'authorizing' && (
              <p className="text-xs text-zoom-dark bg-zoom/5 border border-zoom/30 rounded px-2 py-1">
                Authorizing with Zoom… If a consent prompt appears in the Zoom client, approve it. The doc will be created automatically afterwards.
              </p>
            )}

            {createError && (
              <p className="text-sm text-rose-700">{createError}</p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCreate}
                disabled={phase === 'creating' || phase === 'authorizing' || !markdown.trim()}
                className="inline-flex items-center rounded bg-zoom text-white px-3 py-2 text-sm font-medium hover:bg-zoom-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {phase === 'authorizing' ? 'Authorizing in Zoom…'
                  : phase === 'creating' ? 'Creating in Zoom…'
                  : 'Approve & create Zoom Doc'}
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={phase === 'creating' || phase === 'authorizing'}
                className="inline-flex items-center rounded border border-ink-300 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
              >
                Cancel
              </button>
              {/* Browser-surface fallback: only show the redirect link when the
                  Apps SDK isn't available. Inside the Zoom client the
                  in-client OAuth flow runs automatically in onCreate. */}
              {createError && createError.includes('Sign in') && sdkPhase !== 'ready' && (
                <a
                  href="/auth/login"
                  className="inline-flex items-center rounded border border-zoom text-zoom-dark px-3 py-2 text-sm font-medium hover:bg-zoom/5"
                >
                  Sign in with Zoom
                </a>
              )}
            </div>
          </>
        )}

        {createdDoc && (
          <div className="space-y-3">
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <div className="font-medium">{createdDoc.title}</div>
              {createdDoc.fileLink && (
                <a href={createdDoc.fileLink} target="_blank" rel="noreferrer" className="text-emerald-900 underline">
                  Open in Zoom Docs ↗
                </a>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onShareToChat}
                disabled={phase === 'sharing' || sdkPhase !== 'ready'}
                className="inline-flex items-center rounded bg-zoom text-white px-3 py-2 text-sm font-medium hover:bg-zoom-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {phase === 'sharing' ? 'Sharing…' : 'Share to Zoom Chat'}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center rounded border border-ink-300 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
              >
                Done
              </button>
            </div>

            {sdkPhase !== 'ready' && (
              <p className="text-xs text-ink-500">
                Zoom Chat sharing is only available when running inside the Zoom client with the
                imchat:userapp scope granted. (Current SDK phase: {sdkPhase}.)
              </p>
            )}
            {shareNote && <p className="text-sm text-ink-700">{shareNote}</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
