import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type PageHeroProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
};

export function PageHero({
  eyebrow,
  title,
  description,
  children,
  className,
}: PageHeroProps) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-card/40',
        className,
      )}
    >
      <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,184,0,0.12),transparent_45%),radial-gradient(ellipse_at_bottom_right,rgba(52,211,153,0.1),transparent_40%)]' />
      <div className='relative grid min-w-0 gap-5 p-4 sm:gap-6 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-end'>
        <div className='min-w-0 space-y-2'>
          {eyebrow ? (
            <p className='text-sm text-muted-foreground'>{eyebrow}</p>
          ) : null}
          <h2 className='text-2xl font-semibold tracking-tight sm:text-3xl'>
            {title}
          </h2>
          {description ? (
            <p className='max-w-xl text-sm text-muted-foreground'>
              {description}
            </p>
          ) : null}
        </div>
        {children ? <div className='min-w-0'>{children}</div> : null}
      </div>
    </section>
  );
}
