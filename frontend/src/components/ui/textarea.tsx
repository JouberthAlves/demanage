import * as React from 'react';

import { sanitizeAbnt2 } from '@/lib/abnt2';
import { cn } from '@/lib/utils';

function Textarea({
  className,
  onChange,
  abnt2 = true,
  ...props
}: React.ComponentProps<'textarea'> & {
  /** Filtra para caracteres do teclado ABNT2 (padrão: ligado). */
  abnt2?: boolean;
}) {
  return (
    <textarea
      data-slot='textarea'
      className={cn(
        'flex field-sizing-content min-h-16 w-full min-w-0 max-w-full resize-none break-words rounded-2xl border border-transparent bg-input/50 px-3 py-3 text-base [overflow-wrap:anywhere] transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
      onChange={(event) => {
        if (abnt2) {
          const sanitized = sanitizeAbnt2(event.target.value);
          if (sanitized !== event.target.value) {
            event.target.value = sanitized;
          }
        }
        onChange?.(event);
      }}
    />
  );
}

export { Textarea };
