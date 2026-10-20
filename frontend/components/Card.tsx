import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-ink-200 bg-white ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between border-b border-ink-200 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {subtitle && <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-500">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default'|'success'|'warning'|'danger'|'ai' }) {
  const tones: Record<string, string> = {
    default: 'bg-ink-100 text-ink-700',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger:  'bg-rose-50 text-rose-700',
    ai:      'bg-zoom/10 text-zoom-dark',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
