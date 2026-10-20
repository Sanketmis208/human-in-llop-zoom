'use client';

/**
 * Tabs — a minimal, accessible, hash-syncable tab control.
 *
 * Reads/writes `location.hash` so deep links like `/#ai-actions` open the
 * right tab. Server-rendered children for the active tab are visible on
 * first paint; non-active tab content is hidden via CSS so React doesn't
 * need to re-mount on switch.
 */

import { useEffect, useState, type ReactNode } from 'react';

export type TabSpec = {
  id:       string;
  label:    string;
  badge?:   ReactNode;   // small count or pill rendered next to the label
  content:  ReactNode;
};

export function Tabs({ tabs, initialTabId }: { tabs: TabSpec[]; initialTabId?: string }) {
  const fallback = initialTabId && tabs.some(t => t.id === initialTabId)
    ? initialTabId
    : tabs[0]?.id;
  const [activeId, setActiveId] = useState<string>(fallback ?? '');

  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, '');
    if (fromHash && tabs.some(t => t.id === fromHash)) setActiveId(fromHash);

    function onHashChange() {
      const id = window.location.hash.replace(/^#/, '');
      if (id && tabs.some(t => t.id === id)) setActiveId(id);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [tabs]);

  function select(id: string) {
    setActiveId(id);
    if (typeof window !== 'undefined') {
      // Update hash without triggering a scroll jump.
      const url = new URL(window.location.href);
      url.hash = id;
      window.history.replaceState(null, '', url.toString());
    }
  }

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-ink-200" aria-label="Dashboard tabs">
        {tabs.map(t => {
          const active = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`tabpanel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(t.id)}
              className={
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition outline-none ' +
                (active
                  ? 'border-zoom text-zoom-dark'
                  : 'border-transparent text-ink-600 hover:text-ink-900 hover:border-ink-300 focus-visible:text-ink-900')
              }
            >
              <span className="inline-flex items-center gap-2">
                {t.label}
                {t.badge}
              </span>
            </button>
          );
        })}
      </div>

      {tabs.map(t => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            id={`tabpanel-${t.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${t.id}`}
            hidden={!active}
            className="pt-6"
          >
            {t.content}
          </div>
        );
      })}
    </div>
  );
}
