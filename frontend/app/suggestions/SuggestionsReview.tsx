'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import type { SuggestedTask, MeetingContext, Priority } from '@/lib/types';
import { Card, CardHeader, CardBody, Badge } from '@/components/Card';

const PRIORITY_TONES: Record<Priority, 'default'|'warning'|'danger'> = {
  Low: 'default', Medium: 'warning', High: 'danger',
};

export function SuggestionsReview() {
  const [meetings, setMeetings]   = useState<MeetingContext[]>([]);
  const [selected, setSelected]   = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedTask[]>([]);
  const [loading, setLoading]     = useState(true);
  const [busy, setBusy]           = useState<string | null>(null);
  const [editing, setEditing]     = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);

  // Load meetings on mount.
  useEffect(() => {
    api.listMeetings()
      .then(r => {
        setMeetings(r.meetings);
        if (r.meetings.length && !selected) setSelected(r.meetings[0].id);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload suggestions whenever the selected meeting changes.
  useEffect(() => {
    if (!selected) return;
    api.getSuggestions(selected)
      .then(r => setSuggestions(r.suggestions))
      .catch(e => setError(e.message));
  }, [selected]);

  async function refreshSuggestions() {
    if (!selected) return;
    const r = await api.getSuggestions(selected);
    setSuggestions(r.suggestions);
  }

  async function approve(s: SuggestedTask, updates: Partial<SuggestedTask> = {}) {
    setBusy(s.id);
    try {
      await api.approveSuggestion(s.id, { updates, syncToZoom: false, actor: 'user:demo' });
      await refreshSuggestions();
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reject(s: SuggestedTask) {
    const reason = prompt('Optional rejection reason:') ?? undefined;
    setBusy(s.id);
    try {
      await api.rejectSuggestion(s.id, reason);
      await refreshSuggestions();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function extractFromTranscript() {
    if (!selected) return;
    setBusy('extract');
    try {
      const result = await api.analyzeTranscript(selected);
      if (result.aiUnavailable) {
        setError(`AI unavailable: ${result.error}`);
      }
      await refreshSuggestions();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Card><CardBody>Loading meetings…</CardBody></Card>;

  if (!meetings.length) return <Card><CardBody>No meetings found.</CardBody></Card>;

  const pending = suggestions.filter(s => s.status === 'pending');
  const decided = suggestions.filter(s => s.status !== 'pending');

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

      <Card>
        <CardHeader
          title="Meeting"
          action={
            <div className="flex flex-wrap gap-2 items-center justify-end">
              <select
                className="text-sm rounded border border-ink-300 bg-white px-2 py-1 max-w-full"
                value={selected ?? ''}
                onChange={e => setSelected(e.target.value)}
              >
                {meetings.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
              <button
                disabled={busy === 'extract'}
                onClick={extractFromTranscript}
                className="rounded bg-zoom text-white text-sm px-3 py-1.5 hover:bg-zoom-dark disabled:opacity-50 whitespace-nowrap"
              >
                {busy === 'extract' ? 'Extracting…' : 'Re-run AI extraction'}
              </button>
            </div>
          }
        />
      </Card>

      <Card>
        <CardHeader
          title={`Pending review (${pending.length})`}
          subtitle="Approved suggestions become open tasks. Rejected suggestions are logged but not created."
        />
        <CardBody className="divide-y divide-ink-200 -mx-5 -my-4">
          {pending.length === 0 && <div className="px-5 py-6 text-sm text-ink-500">Nothing pending. Run AI extraction or pick another meeting.</div>}
          {pending.map(s => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              busy={busy === s.id}
              editing={editing === s.id}
              onEdit={() => setEditing(s.id)}
              onCancelEdit={() => setEditing(null)}
              onApprove={(updates) => approve(s, updates)}
              onReject={() => reject(s)}
            />
          ))}
        </CardBody>
      </Card>

      {decided.length > 0 && (
        <Card>
          <CardHeader title={`Decided (${decided.length})`} subtitle="Already approved or rejected" />
          <CardBody className="divide-y divide-ink-200 -mx-5 -my-4">
            {decided.map(s => (
              <div key={s.id} className="px-5 py-3 flex justify-between items-start">
                <div>
                  <div className="text-sm text-ink-700">{s.title}</div>
                  <div className="text-xs text-ink-500 mt-0.5">{s.assignee ?? 'Unassigned'}</div>
                </div>
                <Badge tone={s.status === 'approved' ? 'success' : 'default'}>{s.status}</Badge>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function SuggestionRow({
  suggestion, busy, editing, onEdit, onCancelEdit, onApprove, onReject,
}: {
  suggestion: SuggestedTask;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onApprove: (updates: Partial<SuggestedTask>) => void;
  onReject: () => void;
}) {
  const [draft, setDraft] = useState({
    title: suggestion.title,
    assignee: suggestion.assignee ?? '',
    priority: suggestion.priority,
    dueDate: suggestion.dueDate?.slice(0, 10) ?? '',
  });

  const confidencePct = Math.round(suggestion.confidence * 100);
  const confTone: 'success'|'warning'|'danger' =
    confidencePct >= 85 ? 'success' : confidencePct >= 65 ? 'warning' : 'danger';

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              className="w-full text-sm font-medium rounded border border-ink-300 px-2 py-1"
              value={draft.title}
              onChange={e => setDraft({ ...draft, title: e.target.value })}
            />
          ) : (
            <div className="text-sm font-medium text-ink-900">{suggestion.title}</div>
          )}
          <div className="text-xs text-ink-500 mt-1">{suggestion.description}</div>

          <blockquote className="mt-2 text-xs italic text-ink-500 border-l-2 border-ink-300 pl-2">
            “{suggestion.sourceExcerpt}”
          </blockquote>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Badge tone="ai">AI confidence {confidencePct}%</Badge>
          <Badge tone={confTone}>{suggestion.priority}</Badge>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-500">
        {editing ? (
          <>
            <label className="flex items-center gap-1">
              Assignee:
              <input
                className="rounded border border-ink-300 px-2 py-0.5"
                value={draft.assignee}
                onChange={e => setDraft({ ...draft, assignee: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-1">
              Priority:
              <select
                className="rounded border border-ink-300 px-2 py-0.5"
                value={draft.priority}
                onChange={e => setDraft({ ...draft, priority: e.target.value as Priority })}
              >
                <option>Low</option><option>Medium</option><option>High</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              Due:
              <input
                type="date"
                className="rounded border border-ink-300 px-2 py-0.5"
                value={draft.dueDate}
                onChange={e => setDraft({ ...draft, dueDate: e.target.value })}
              />
            </label>
          </>
        ) : (
          <>
            <span>Owner: <strong className="text-ink-700">{suggestion.assignee ?? 'Unassigned'}</strong></span>
            {suggestion.dueDate && <span>Due: <strong className="text-ink-700">{suggestion.dueDate.slice(0,10)}</strong></span>}
          </>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        {editing ? (
          <>
            <button
              disabled={busy}
              onClick={() => onApprove({
                title: draft.title,
                assignee: draft.assignee || null,
                priority: draft.priority,
                dueDate: draft.dueDate ? new Date(draft.dueDate).toISOString() : null,
              })}
              className="rounded bg-emerald-600 text-white text-xs px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-50"
            >
              Approve with edits
            </button>
            <button
              onClick={onCancelEdit}
              className="rounded border border-ink-300 text-xs px-3 py-1.5 text-ink-700"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              disabled={busy}
              onClick={() => onApprove({})}
              className="rounded bg-emerald-600 text-white text-xs px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? '…' : 'Approve'}
            </button>
            <button
              disabled={busy}
              onClick={onEdit}
              className="rounded border border-ink-300 text-xs px-3 py-1.5 text-ink-700 hover:bg-ink-50"
            >
              Edit
            </button>
            <button
              disabled={busy}
              onClick={onReject}
              className="rounded border border-rose-300 text-xs px-3 py-1.5 text-rose-700 hover:bg-rose-50"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
