import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type SectionPanelProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function SectionPanel({
  title,
  description,
  actions,
  children,
  className,
}: SectionPanelProps) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-border bg-card/30 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-5',
        className,
      )}
    >
      {title || actions ? (
        <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div className='space-y-1'>
            {title ? (
              <h2 className='text-base font-medium tracking-tight'>{title}</h2>
            ) : null}
            {description ? (
              <p className='text-sm text-muted-foreground'>{description}</p>
            ) : null}
          </div>
          {actions ? <div className='shrink-0'>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
