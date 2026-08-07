import * as React from 'react';

import { sanitizeAbnt2 } from '@/lib/abnt2';
import { cn } from '@/lib/utils';

function Input({
  className,
  type,
  onChange,
  abnt2 = true,
  ...props
}: React.ComponentProps<'input'> & {
  /** Filtra para caracteres do teclado ABNT2 (padrão: ligado). */
  abnt2?: boolean;
}) {
  const isDateLike =
    type === 'date' ||
    type === 'datetime-local' ||
    type === 'time' ||
    type === 'month' ||
    type === 'week';
  const shouldSanitize =
    abnt2 && type !== 'file' && type !== 'hidden' && !isDateLike;

  return (
    <input
      type={type}
      data-slot='input'
      className={cn(
        'h-9 w-full min-w-0 rounded-3xl border border-transparent bg-input/50 px-3 py-1 text-base transition-[color,box-shadow,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        isDateLike &&
          '[color-scheme:dark] scheme-dark [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:invert',
        className,
      )}
      {...props}
      onChange={(event) => {
        if (shouldSanitize) {
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

export { Input };
