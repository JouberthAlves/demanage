import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'positive' | 'negative' | 'amber';
  icon?: ReactNode;
  className?: string;
};

export function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-card/40 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
        className,
      )}
    >
      <div className='pointer-events-none absolute -right-6 -top-8 size-24 rounded-full bg-white/5 blur-2xl' />
      <div className='relative flex items-start justify-between gap-2'>
        <p className='text-sm text-muted-foreground'>{label}</p>
        {icon ? (
          <div className='text-muted-foreground opacity-80'>{icon}</div>
        ) : null}
      </div>
      <p
        className={cn(
          'relative mt-2 text-2xl font-semibold tracking-tight',
          tone === 'positive' && 'text-neon-green',
          tone === 'negative' && 'text-rose-400',
          tone === 'amber' && 'text-neon-amber',
        )}
      >
        {value}
      </p>
      {hint ? (
        <p
          className={cn(
            'relative mt-1 text-xs text-muted-foreground',
            tone === 'positive' && 'text-neon-green/80',
            tone === 'negative' && 'text-rose-400/80',
            tone === 'amber' && 'text-neon-amber/80',
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
