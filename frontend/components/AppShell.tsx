'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { SurfaceProvider, useSurface } from '@/lib/use-surface';

/**
 * App shell — chrome around every page.
 *
 * Three layout regimes, picked at runtime from useSurface():
 *   - wide        : permanent sidebar (240px) + main content
 *   - medium      : permanent sidebar but narrower (192px) + tighter padding
 *   - narrow      : no sidebar; hamburger opens a slide-in drawer; bottom of
 *                   the viewport is used for the menu so it never collides
 *                   with the meeting toolbar at the top of the panel
 *
 * Inside a meeting (surface.isInMeeting), navigation collapses further: the
 * top bar shows the active page title only; the drawer is still reachable
 * via the hamburger but defaults to closed.
 */

const NAV_ITEMS = [
  { href: '/',            label: 'Dashboard' },
  { href: '/live',        label: 'Live Meetings' },
  { href: '/suggestions', label: 'Suggested Tasks' },
  { href: '/tasks',       label: 'Open Tasks' },
  { href: '/completed',   label: 'Completed' },
  { href: '/meetings',    label: 'Meetings' },
  { href: '/changes',     label: 'What Changed' },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SurfaceProvider>
      <Shell>{children}</Shell>
    </SurfaceProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const surface = useSurface();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer when route changes (otherwise it stays open after nav).
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  const isNarrow = surface.size === 'narrow';
  const isWide   = surface.size === 'wide';

  const activeLabel = NAV_ITEMS.find(i => i.href === pathname)?.label ?? '';

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar: shown on narrow surfaces (replaces the sidebar) */}
      {isNarrow && (
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-3">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="rounded p-1.5 hover:bg-ink-100 text-ink-700"
          >
            <HamburgerIcon />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink-900 truncate">
              {activeLabel || 'Zoom AI Workflows'}
            </div>
            {surface.isInMeeting && (
              <div className="text-[10px] uppercase tracking-wider text-zoom-dark">
                In meeting
              </div>
            )}
          </div>
        </header>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Permanent sidebar: medium + wide only */}
        {!isNarrow && (
          <Sidebar
            pathname={pathname}
            collapsed={!isWide}
            badge={surface.isInMeeting ? 'In meeting' : undefined}
          />
        )}

        {/* Drawer overlay: narrow only */}
        {isNarrow && drawerOpen && (
          <>
            <div
              role="presentation"
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-40 bg-ink-900/30"
            />
            <div className="fixed left-0 top-0 z-50 h-full w-72 max-w-[85%] bg-white shadow-xl">
              <Sidebar
                pathname={pathname}
                collapsed={false}
                badge={surface.isInMeeting ? 'In meeting' : undefined}
                onItemClick={() => setDrawerOpen(false)}
              />
            </div>
          </>
        )}

        {/* Main content — padding adapts to surface size. `@container` makes
            the page content itself the query root so child components use
            @md: / @xl: based on content width (not viewport width). */}
        <main
          className={[
            'flex-1 min-w-0 min-h-0 @container',
            isNarrow ? 'p-4' : isWide ? 'p-8' : 'p-6',
            'max-w-5xl',
          ].join(' ')}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

// ── Sidebar component ──────────────────────────────────────────────────────

function Sidebar({
  pathname, collapsed, badge, onItemClick,
}: {
  pathname: string;
  collapsed: boolean;
  badge?: string;
  onItemClick?: () => void;
}) {
  return (
    <aside
      className={[
        'shrink-0 border-r border-ink-200 bg-white flex flex-col',
        collapsed ? 'w-48 px-3 py-5' : 'w-60 px-5 py-6',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink-900">Zoom AI Workflows</div>
          <div className="text-xs text-ink-500 mt-0.5">Continuous Meeting Chat</div>
        </div>
        {badge && (
          <span className="text-[10px] uppercase tracking-wider text-zoom-dark whitespace-nowrap">
            {badge}
          </span>
        )}
      </div>

      <nav className="mt-7 space-y-0.5 flex-1">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onItemClick}
              className={[
                'block rounded px-3 py-2 text-sm',
                active
                  ? 'bg-zoom/10 text-zoom-dark font-medium'
                  : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
              ].join(' ')}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 text-xs text-ink-500 leading-snug">
        Agentic AI Task Workflows Demo<br />
        Built by Zoom Developer Relations
      </div>
    </aside>
  );
}

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
