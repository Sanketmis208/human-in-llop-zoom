'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Hook: useZoomAppSdk()
 *
 * Centralises everything React components need to talk to the Zoom Apps SDK:
 *   - SDK detection and zoomSdk.config({ capabilities: [...] }) call
 *   - Running-context probe (inMeeting / inWebinar / inMainClient / browser)
 *   - RTMS status read + live status updates via onRTMSStatusChange
 *   - Start / Pause / Resume / Stop helpers that re-read status afterwards
 *
 * Why the start/stop helpers re-read status:
 *   The Zoom Apps SDK is known to throw `Error: start rtms fail` even when
 *   RTMS genuinely starts (Zoom fires meeting.rtms_started, the media plane
 *   connects, the in-meeting indicator shows "Accessing"). We treat any SDK
 *   error as benign as long as the post-action status matches the target.
 *   The hook returns a clean `error` only when the status didn't actually
 *   change, so the UI doesn't show a misleading "failed" message.
 */

const CAPABILITIES = [
  'startRTMS',
  'stopRTMS',
  'pauseRTMS',
  'resumeRTMS',
  'getRTMSStatus',
  'onRTMSStatusChange',
  'getRunningContext',
  'getMeetingContext',
  'sendMessageToChat',
  'authorize',
  'onAuthorized',
];

export type SdkPhase =
  | 'detecting'      // checking if window.zoomSdk exists
  | 'browser'        // not running inside the Zoom client
  | 'ready'          // SDK initialized inside the Zoom client (any context).
                     //   Use `isInMeeting` to gate meeting-specific actions like RTMS.
  | 'error';         // SDK config failed

export type RtmsState = 'STARTED' | 'STOPPED' | 'PAUSED' | 'unknown';

declare global {
  interface Window {
    zoomSdk?: {
      config: (opts: { version?: string; capabilities: string[] }) => Promise<unknown>;
      getRunningContext: () => Promise<{ context: string }>;
      getMeetingContext: () => Promise<{ meetingID?: string; meetingTopic?: string } & Record<string, unknown>>;
      getRTMSStatus: () => Promise<{ status: RtmsState } & Record<string, unknown>>;
      startRTMS:  () => Promise<unknown>;
      stopRTMS:   () => Promise<unknown>;
      pauseRTMS:  () => Promise<unknown>;
      resumeRTMS: () => Promise<unknown>;
      onRTMSStatusChange: (cb: (ev: { status: RtmsState }) => void) => void;
      sendMessageToChat: (opts: { message: string }) => Promise<unknown>;
      authorize: (opts: { state: string; codeChallenge: string; codeChallengeMethod?: 'plain' }) => Promise<unknown>;
      addEventListener: (event: 'onAuthorized' | string, cb: (ev: unknown) => void) => void;
      removeEventListener?: (event: string, cb: (ev: unknown) => void) => void;
    };
  }
}

export interface ZoomAppSdkState {
  phase:       SdkPhase;
  context:     string | null;     // e.g. "inMeeting", "inMainClient", "inChat"
  isInMeeting: boolean;           // true only for inMeeting / inWebinar
  meetingId:   string | null;
  rtmsState:   RtmsState;
  busy:        string | null;     // 'start' | 'stop' | 'pause' | 'resume' | null
  error:       string | null;

  startRtms:  () => Promise<void>;
  stopRtms:   () => Promise<void>;
  pauseRtms:  () => Promise<void>;
  resumeRtms: () => Promise<void>;

  /**
   * Post a message into the user's current Zoom chat context. Only available
   * when phase === 'ready' AND the SDK exposes sendMessageToChat (gated by the
   * `imchat:userapp` scope on the Marketplace app). Returns { ok: false } with
   * a reason if those preconditions aren't met.
   */
  sendMessageToChat: (message: string) => Promise<{ ok: true } | { ok: false; reason: string }>;

  /**
   * Run the Zoom Apps SDK in-client OAuth flow (zoomSdk.authorize +
   * onAuthorized) to obtain a user OAuth token, server-side, in the current
   * session. The whole exchange is delegated to the backend's
   * /auth/in-client/{start,callback} pair — this hook only mediates the SDK
   * side.
   *
   * Returns when tokens are persisted in the Express session (or when the
   * flow short-circuits because the user is already signed in). The caller
   * should then retry whatever 401'd to begin with.
   */
  startInClientAuth: () => Promise<{ ok: true; alreadySignedIn?: boolean } | { ok: false; reason: string }>;

  dismissError: () => void;
}

export function useZoomAppSdk(): ZoomAppSdkState {
  const [phase, setPhase]       = useState<SdkPhase>('detecting');
  const [context, setContext]   = useState<string | null>(null);
  const [isInMeeting, setIsInMeeting] = useState<boolean>(false);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [rtmsState, setRtmsState] = useState<RtmsState>('unknown');
  const [busy, setBusy]         = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);

  // Initialize the SDK once the script has loaded.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    async function init() {
      // The Apps SDK script is in the root layout with strategy="beforeInteractive";
      // wait briefly for window.zoomSdk to register if needed.
      while (!cancelled && !window.zoomSdk && attempt < 20) {
        await new Promise(r => setTimeout(r, 100));
        attempt++;
      }
      if (cancelled) return;
      if (!window.zoomSdk) { setPhase('browser'); return; }

      try {
        await window.zoomSdk.config({ version: '0.16.26', capabilities: CAPABILITIES });
        const ctx = await window.zoomSdk.getRunningContext();
        if (cancelled) return;
        setContext(ctx.context);

        const inMeeting = ctx.context === 'inMeeting' || ctx.context === 'inWebinar';
        setIsInMeeting(inMeeting);

        // Meeting-specific setup (RTMS state, meeting id) only when applicable —
        // these calls throw outside meeting contexts. Auth APIs (authorize /
        // sendMessageToChat) work in any in-client context, so the hook still
        // reaches `phase: 'ready'` even when we're not in a meeting.
        if (inMeeting) {
          try {
            const mc = await window.zoomSdk.getMeetingContext();
            if (!cancelled) setMeetingId(String(mc?.meetingID ?? mc?.meetingTopic ?? ''));
          } catch { /* not all contexts expose meeting info */ }

          try {
            const status = await window.zoomSdk.getRTMSStatus();
            if (!cancelled) setRtmsState(status.status);
          } catch { /* status might not be available immediately */ }

          try {
            window.zoomSdk.onRTMSStatusChange((ev) => {
              if (!cancelled) setRtmsState(ev.status);
            });
          } catch { /* listener registration can throw on some SDK versions */ }
        }

        if (!cancelled) setPhase('ready');
      } catch (e) {
        if (!cancelled) {
          setPhase('error');
          setError((e as Error).message);
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Shared action runner. If the SDK throws but the post-action status matches
  // the target, swallow the error (Zoom's "start rtms fail" false alarm).
  const runAction = useCallback(async (label: string, targetState: RtmsState | null, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    let sdkError: unknown = null;
    try { await fn(); }
    catch (e) {
      sdkError = e;
      console.warn(`[useZoomAppSdk] ${label} SDK threw:`, e);
    }

    let finalStatus: RtmsState = rtmsState;
    try {
      const r = await window.zoomSdk!.getRTMSStatus();
      finalStatus = r.status;
      setRtmsState(finalStatus);
    } catch { /* onRTMSStatusChange will catch up */ }

    if (sdkError && targetState && finalStatus !== targetState) {
      const raw = sdkError as Record<string, unknown> | Error;
      const msg = (raw as Error).message
        ?? (typeof raw === 'object' && raw && 'reason' in raw ? String((raw as { reason: unknown }).reason) : null)
        ?? JSON.stringify(raw);
      setError(`${label} failed: ${msg} (status is ${finalStatus})`);
    }
    setBusy(null);
  }, [rtmsState]);

  return {
    phase,
    context,
    isInMeeting,
    meetingId,
    rtmsState,
    busy,
    error,
    startRtms:    () => runAction('start',  'STARTED', () => window.zoomSdk!.startRTMS()),
    stopRtms:     () => runAction('stop',   'STOPPED', () => window.zoomSdk!.stopRTMS()),
    pauseRtms:    () => runAction('pause',  'PAUSED',  () => window.zoomSdk!.pauseRTMS()),
    resumeRtms:   () => runAction('resume', 'STARTED', () => window.zoomSdk!.resumeRTMS()),

    sendMessageToChat: async (message: string) => {
      if (typeof window === 'undefined' || !window.zoomSdk?.sendMessageToChat) {
        return { ok: false as const, reason: 'sendMessageToChat is only available inside the Zoom client with the imchat:userapp scope granted.' };
      }
      if (phase !== 'ready') {
        return { ok: false as const, reason: `Zoom Apps SDK not ready (phase: ${phase}).` };
      }
      try {
        await window.zoomSdk.sendMessageToChat({ message });
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, reason: (e as Error).message ?? 'sendMessageToChat threw.' };
      }
    },

    startInClientAuth: async () => {
      if (typeof window === 'undefined' || !window.zoomSdk?.authorize) {
        return { ok: false as const, reason: 'In-client OAuth is only available inside the Zoom client.' };
      }
      if (phase !== 'ready') {
        return { ok: false as const, reason: `Zoom Apps SDK not ready (phase: ${phase}).` };
      }

      // Step 1: ask the backend for { state, codeChallenge } or short-circuit
      // if we're already signed in this session.
      let startResp: Response;
      try {
        startResp = await fetch('/auth/in-client/start', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return { ok: false as const, reason: `Could not reach /auth/in-client/start: ${(e as Error).message}` };
      }
      const startBody = await startResp.json().catch(() => ({}));
      if (!startResp.ok || !startBody?.success) {
        return { ok: false as const, reason: startBody?.error ?? `Backend rejected in-client start (${startResp.status}).` };
      }
      if (startBody.alreadySignedIn) {
        return { ok: true as const, alreadySignedIn: true };
      }

      const { state, codeChallenge } = startBody as { state: string; codeChallenge: string };

      // Step 2: register a one-shot onAuthorized listener, then call
      // zoomSdk.authorize(). The event's payload shape varies across SDK
      // versions (top-level vs. wrapped under .detail/.payload, `code` vs.
      // `authCode`), so we extract defensively. State validation is the
      // backend's job — we don't double-check it here.
      const eventPromise = new Promise<{ code: string }>((resolve, reject) => {
        let consumed = false;
        const timeoutId = setTimeout(() => {
          if (consumed) return;
          consumed = true;
          reject(new Error('In-client authorization timed out after 60s. The user may have cancelled the consent prompt.'));
        }, 60_000);

        const handler = (ev: unknown) => {
          if (consumed) return;
          consumed = true;
          clearTimeout(timeoutId);
          // Best-effort removal — not all SDK versions expose removeEventListener.
          try { window.zoomSdk?.removeEventListener?.('onAuthorized', handler); } catch { /* ignore */ }

          const eventCode = extractField(ev, ['code', 'authCode', 'authorization_code', 'authorizationCode']);
          if (!eventCode) {
            reject(new Error('onAuthorized event arrived without a code field.'));
            return;
          }
          resolve({ code: eventCode });
        };
        window.zoomSdk!.addEventListener('onAuthorized', handler);
      });

      try {
        await window.zoomSdk.authorize({ state, codeChallenge, codeChallengeMethod: 'plain' });
      } catch (e) {
        // Some SDK versions resolve via the event even when the promise rejects.
        // Don't fail synchronously — fall through to wait on the event.
        console.warn('[useZoomAppSdk] authorize() threw; waiting on onAuthorized event anyway:', e);
      }

      let event: { code: string };
      try {
        event = await eventPromise;
      } catch (e) {
        return { ok: false as const, reason: (e as Error).message };
      }

      // Step 3: hand the code back to the backend for the PKCE token
      // exchange. State validation happens server-side against the verifier
      // stored on the session.
      let completeResp: Response;
      try {
        completeResp = await fetch('/auth/in-client/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: event.code, state }),
        });
      } catch (e) {
        return { ok: false as const, reason: `Could not reach /auth/in-client/callback: ${(e as Error).message}` };
      }
      const completeBody = await completeResp.json().catch(() => ({}));
      if (!completeResp.ok || !completeBody?.success) {
        return { ok: false as const, reason: completeBody?.error ?? `Backend rejected in-client callback (${completeResp.status}).` };
      }

      return { ok: true as const };
    },

    dismissError: () => setError(null),
  };
}

/**
 * Pull a named field out of an opaque event object — checking the top level
 * first, then common wrapper keys (.detail, .payload, .data) that some Zoom
 * Apps SDK event payloads use.
 */
function extractField(ev: unknown, keys: string[]): string | undefined {
  if (!ev || typeof ev !== 'object') return undefined;
  const candidates: unknown[] = [ev];
  for (const wrap of ['detail', 'payload', 'data']) {
    const wrapped = (ev as Record<string, unknown>)[wrap];
    if (wrapped && typeof wrapped === 'object') candidates.push(wrapped);
  }
  for (const c of candidates) {
    for (const k of keys) {
      const v = (c as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  return undefined;
}
