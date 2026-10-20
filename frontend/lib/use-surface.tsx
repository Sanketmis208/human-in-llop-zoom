'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useZoomAppSdk, type SdkPhase } from './use-zoom-app-sdk';

/**
 * Surface = "which Zoom container is hosting us right now?".
 * Drives layout choices that depend on the type of host, not just its width.
 */
export type SurfaceKind =
  | 'meeting'      // in-meeting Apps panel (often narrow, very tall)
  | 'team-chat'    // Team Chat webview (medium width)
  | 'main-client'  // App Home tab in the Zoom client (wider)
  | 'browser';     // local dev / no Zoom SDK (widest, devtools open)

/**
 * Size bucket derived from the *container's* actual width — not the device.
 * Three buckets are enough for layout decisions; anything more granular comes
 * from Tailwind's @container queries on the component itself.
 */
export type SurfaceSize = 'narrow' | 'medium' | 'wide';

export interface Surface {
  kind:        SurfaceKind;
  size:        SurfaceSize;
  width:       number;
  height:      number;
  aspectRatio: number;
  /** True when running inside a live Zoom meeting (Apps panel). */
  isInMeeting: boolean;
  /** True when SDK has finished probing context. Use to avoid layout flicker. */
  ready:       boolean;
}

const NARROW_MAX  = 640;   // ≤ this is "narrow" — Meeting Sidebar territory
const MEDIUM_MAX  = 1024;  // ≤ this is "medium" — Team Chat / collapsed client
                           // > MEDIUM_MAX is "wide" — Expanded view / browser

// ── Context ──────────────────────────────────────────────────────────────────

const SurfaceContext = createContext<Surface | null>(null);

export function useSurface(): Surface {
  const ctx = useContext(SurfaceContext);
  if (ctx) return ctx;
  // Outside the provider (SSR, isolated tests) we return a sensible "wide
  // browser" default so server-rendered HTML doesn't make narrow assumptions.
  return {
    kind: 'browser',
    size: 'wide',
    width: 1280, height: 800,
    aspectRatio: 1280 / 800,
    isInMeeting: false,
    ready: false,
  };
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function SurfaceProvider({ children }: { children: ReactNode }) {
  const sdk = useZoomAppSdk();
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Window resize → container size. We observe the viewport because the
  // outermost container is always full-bleed in our layout; if you nest
  // multiple containers later, switch this to a ResizeObserver on the relevant
  // ancestor.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const surface = useMemo<Surface>(() => {
    const w = size.w || 1280;
    const h = size.h || 800;
    return {
      kind:        deriveKind(sdk.phase, sdk.context),
      size:        deriveSize(w),
      width:       w,
      height:      h,
      aspectRatio: w / (h || 1),
      isInMeeting: sdk.context === 'inMeeting' || sdk.context === 'inWebinar',
      ready:       sdk.phase !== 'detecting',
    };
  }, [sdk.phase, sdk.context, size.w, size.h]);

  // Mirror the surface onto <body> data attributes so global CSS rules (and
  // Tailwind data-* variants) can react without prop drilling.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.zoomSurface = surface.kind;
    document.body.dataset.zoomSize    = surface.size;
    if (surface.isInMeeting) document.body.dataset.zoomInMeeting = 'true';
    else delete document.body.dataset.zoomInMeeting;
  }, [surface.kind, surface.size, surface.isInMeeting]);

  return <SurfaceContext.Provider value={surface}>{children}</SurfaceContext.Provider>;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function deriveKind(phase: SdkPhase, context: string | null): SurfaceKind {
  // SDK still probing or unavailable → assume plain browser. Avoids layout
  // flicker when the SDK init returns "browser" after a 200ms delay.
  if (phase === 'browser' || phase === 'detecting') return 'browser';
  if (context === 'inMeeting' || context === 'inWebinar') return 'meeting';
  // Team Chat surfaces report context 'inMainClient' too on some clients —
  // we treat any non-meeting non-browser context as the chat/main-client
  // family and let `size` decide layout density.
  if (context === 'inTeamChat')   return 'team-chat';
  if (context === 'inMainClient') return 'main-client';
  return 'browser';
}

function deriveSize(width: number): SurfaceSize {
  if (width <= NARROW_MAX)  return 'narrow';
  if (width <= MEDIUM_MAX)  return 'medium';
  return 'wide';
}
